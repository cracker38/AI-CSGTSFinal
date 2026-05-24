from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ai.gap import compute_skill_gaps
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.employee_profile import EmployeeProfile
from app.models.hr_action import HrAction
from app.models.manager_project import EmployeeProjectDailyReport, ManagerProject, ProjectAssignment, ProjectStatus
from app.models.master_data import JobTitleCatalog
from app.models.skill import Skill
from app.models.user import User, UserRole
from app.models.user_skill import SkillSource, UserSkill
from app.schemas.hr_action import HrActionPublic, MaterialReadingProgressUpdate, TrainingAssignmentProgressUpdate
from app.services.training_catalog import resolve_official_course_link
from app.services.training_assignments import (
    apply_material_reading_progress,
    apply_training_assignment_update,
    end_training_session,
    ensure_training_attendance_defaults,
    refresh_stale_training_sessions,
    start_training_session,
    training_assignment_to_progress_item,
    training_session_heartbeat,
)
from app.services.training_materials import get_material_download_path
from app.services.cv import save_and_process_cv
from app.services.employee_gap_visualization import build_employee_skill_gap_visualization
from app.services.employee_intel import build_employee_dashboard_intel, build_story_bullets, sync_ai_cv_story
from app.services.career_paths import build_employee_career_paths
from app.services.training_recommendations import build_employee_training_recommendations
from app.services.required_skill_profile import required_skill_profile_with_weights
from app.services.skill_normalization import normalize_skill_level_map, normalize_skill_name


router = APIRouter()


def _employee_profile_or_ensure(db: Session, user: User) -> EmployeeProfile:
    """
    Employees must always have an employee_profiles row for analytics payloads.
    Some legacy inserts only created User rows — auto-materialize missing profiles.
    """
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user.id).one_or_none()
    if profile:
        return profile
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee profile not found")
    profile = EmployeeProfile(user_id=user.id, headline=None, cv_extract={}, ai_profile={})
    db.add(profile)
    try:
        db.commit()
        db.refresh(profile)
        return profile
    except IntegrityError:
        db.rollback()
        profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user.id).one_or_none()
        if profile:
            return profile
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not initialize employee profile")


def _assigned_project_or_404(db: Session, employee_id, project_id: uuid.UUID) -> tuple[ManagerProject, ProjectAssignment]:
    row = (
        db.query(ManagerProject, ProjectAssignment)
        .join(ProjectAssignment, ProjectAssignment.project_id == ManagerProject.id)
        .filter(ManagerProject.id == project_id, ProjectAssignment.employee_id == employee_id)
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assigned project not found")
    return row


@router.get("/my-skill-gaps")
def my_skill_gaps(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    # STRICT: employee dashboard analytics are employee-only.
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    return build_employee_skill_gap_visualization(db, user, profile)


@router.get("/employee/overview")
def employee_overview(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    total_fields = 9
    filled = sum(
        1
        for v in [
            user.full_name,
            user.email,
            user.phone_number,
            user.department,
            user.job_title,
            user.primary_skill,
            user.country,
            user.experience_level,
            profile.headline,
        ]
        if v and str(v).strip()
    )
    skills = db.query(UserSkill).filter(UserSkill.user_id == user.id).all()
    skill_score = round(sum(int(s.level) for s in skills) / max(1, len(skills)), 2)
    current_levels = normalize_skill_level_map(
        {
            n: int(l)
            for (n, l) in db.query(Skill.name, UserSkill.level)
            .join(UserSkill, Skill.id == UserSkill.skill_id)
            .filter(UserSkill.user_id == user.id)
            .all()
        }
    )
    req_lv, req_w = required_skill_profile_with_weights(user)
    gaps = compute_skill_gaps(
        current=current_levels,
        required=req_lv,
        importance_weights=req_w,
        confidence_base=0.65,
    )
    gap_score = round(sum(max(0, g.gap) for g in gaps) / max(1, len(gaps)), 2)
    weighted_gap_score = round(sum(g.weighted_gap_impact for g in gaps) / max(1, len(gaps)), 2)
    refresh_stale_training_sessions(db, user.id)
    active_trainings = (
        db.query(HrAction)
        .filter(HrAction.target_user_id == user.id, HrAction.action_type == "training_assign", HrAction.status.in_(["assigned", "in_progress"]))
        .count()
    )
    actively_learning = 0
    for row in (
        db.query(HrAction)
        .filter(HrAction.target_user_id == user.id, HrAction.action_type == "training_assign", HrAction.status.in_(["assigned", "in_progress"]))
        .all()
    ):
        st_learning = (row.payload or {}).get("learning_state")
        if st_learning == "in_session":
            actively_learning += 1
    ai = profile.ai_profile or {}
    notifications = list(ai.get("employee_notifications") or [])
    assigned_projects_count = db.query(ProjectAssignment).filter(ProjectAssignment.employee_id == user.id).count()
    active_assigned_projects = (
        db.query(ProjectAssignment)
        .join(ManagerProject, ManagerProject.id == ProjectAssignment.project_id)
        .filter(
            ProjectAssignment.employee_id == user.id,
            ManagerProject.status.in_([ProjectStatus.active, ProjectStatus.draft]),
        )
        .count()
    )
    completed_training_rows = (
        db.query(HrAction)
        .filter(
            HrAction.target_user_id == user.id,
            HrAction.action_type == "training_assign",
            HrAction.status == "completed",
        )
        .all()
    )
    completed_trainings_count = len(completed_training_rows)
    verified_learning_seconds_total = sum(
        int((row.payload or {}).get("total_learning_seconds") or 0) for row in completed_training_rows
    )
    profile_growth_index = None
    if isinstance(ai.get("profile_growth_index"), (int, float)):
        profile_growth_index = round(float(ai["profile_growth_index"]), 2)
    return {
        "welcome_name": user.full_name,
        "profile_completion_pct": round((filled / total_fields) * 100, 2),
        "skill_strength_score": skill_score,
        "skill_gap_score": gap_score,
        "weighted_gap_impact_score": weighted_gap_score,
        "active_trainings": active_trainings,
        "actively_learning_now": actively_learning,
        "notifications_count": len(notifications),
        "assigned_projects_count": assigned_projects_count,
        "active_assigned_projects": active_assigned_projects,
        "completed_trainings_count": completed_trainings_count,
        "verified_learning_hours": round(verified_learning_seconds_total / 3600.0, 2),
        "profile_growth_index": profile_growth_index,
        "cv_skills_detected_count": len((profile.cv_extract or {}).get("skills") or []),
        "career_target_job_title": ai.get("target_job_title"),
        "shortlisted_projects_count": len(ai.get("selected_project_ids") or []),
    }


@router.get("/employee/dashboard-intel")
def employee_dashboard_intel(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    return build_employee_dashboard_intel(db, user, profile)


@router.put("/employee/career-preferences")
def put_employee_career_preferences(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    profile = _employee_profile_or_ensure(db, user)
    ai_existing = dict(profile.ai_profile or {})

    if "target_job_title" in payload:
        raw_target = payload.get("target_job_title")
        if raw_target is None:
            target = None
        elif isinstance(raw_target, str):
            trimmed = raw_target.strip()
            target = trimmed[:120] if trimmed else None
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_job_title must be a string or null")

        if target:
            hit = (
                db.query(JobTitleCatalog.id)
                .filter(JobTitleCatalog.name == target, JobTitleCatalog.active.is_(True))
                .first()
            )
            if not hit:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Target job title must exist in the active master job-title catalog.",
                )
    else:
        target = ai_existing.get("target_job_title")

    if "selected_project_ids" in payload:
        raw_ids = payload.get("selected_project_ids") or []
        if not isinstance(raw_ids, list):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="selected_project_ids must be a list")
        selected: list[str] = []
        for item in raw_ids[:24]:
            try:
                pu = uuid.UUID(str(item))
            except ValueError:
                continue
            if db.query(ManagerProject.id).filter(ManagerProject.id == pu).first():
                sid = str(pu)
                if sid not in selected:
                    selected.append(sid)
    else:
        selected = list(ai_existing.get("selected_project_ids") or [])

    ai = dict(ai_existing)
    ai["target_job_title"] = target
    ai["selected_project_ids"] = selected
    profile.ai_profile = ai
    sync_ai_cv_story(db, profile, user)
    db.add(profile)
    db.commit()
    return {"ok": True, "saved": {"target_job_title": target, "selected_project_ids": selected}}


@router.post("/employee/cv")
async def employee_cv_reupload(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    cv: UploadFile = File(...),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    ctype = (cv.content_type or "").lower()
    if ctype not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CV must be a PDF")
    pdf_bytes = await cv.read()
    if len(pdf_bytes) > 8 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CV too large (max 8MB)")
    upload_dir = os.path.join(os.getcwd(), "uploads")
    save_and_process_cv(
        db,
        user=user,
        original_filename=cv.filename or "cv.pdf",
        pdf_bytes=pdf_bytes,
        upload_dir=upload_dir,
    )
    return {"ok": True}


@router.get("/employee/projects")
def employee_projects(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    rows = (
        db.query(ProjectAssignment, ManagerProject, User.full_name)
        .join(ManagerProject, ManagerProject.id == ProjectAssignment.project_id)
        .join(User, User.id == ManagerProject.manager_id)
        .filter(ProjectAssignment.employee_id == user.id)
        .order_by(ManagerProject.created_at.desc())
        .all()
    )
    out = []
    for assignment, project, manager_name in rows:
        latest = (
            db.query(EmployeeProjectDailyReport)
            .filter(
                EmployeeProjectDailyReport.project_id == project.id,
                EmployeeProjectDailyReport.employee_id == user.id,
            )
            .order_by(EmployeeProjectDailyReport.work_date.desc(), EmployeeProjectDailyReport.created_at.desc())
            .first()
        )
        report_days = (
            db.query(EmployeeProjectDailyReport)
            .filter(
                EmployeeProjectDailyReport.project_id == project.id,
                EmployeeProjectDailyReport.employee_id == user.id,
            )
            .count()
        )
        progress_pct = float(latest.progress_pct) if latest else 0.0
        out.append(
            {
                "project_id": str(project.id),
                "name": project.name,
                "description": project.description,
                "status": project.status.value if hasattr(project.status, "value") else str(project.status),
                "deadline": project.deadline.isoformat() if project.deadline else None,
                "manager_name": manager_name,
                "allocation_pct": float(assignment.allocation_pct or 0),
                "days_reported": report_days,
                "current_progress_pct": round(progress_pct, 1),
                "last_report_date": latest.work_date.isoformat() if latest else None,
                "last_report_status": latest.status if latest else None,
            }
        )
    return out


@router.get("/employee/projects/{project_id}/daily-reports")
def employee_project_daily_reports(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    _assigned_project_or_404(db, user.id, project_id)
    rows = (
        db.query(EmployeeProjectDailyReport)
        .filter(
            EmployeeProjectDailyReport.project_id == project_id,
            EmployeeProjectDailyReport.employee_id == user.id,
        )
        .order_by(EmployeeProjectDailyReport.work_date.desc(), EmployeeProjectDailyReport.created_at.desc())
        .all()
    )
    return [
        {
            "id": str(r.id),
            "work_date": r.work_date.isoformat(),
            "hours_spent": float(r.hours_spent),
            "progress_pct": float(r.progress_pct),
            "status": r.status,
            "summary": r.summary,
            "blockers": r.blockers,
            "next_plan": r.next_plan,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


@router.post("/employee/projects/{project_id}/daily-reports")
def upsert_employee_project_daily_report(
    project_id: uuid.UUID,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    project, _ = _assigned_project_or_404(db, user.id, project_id)

    work_date_raw = str(payload.get("work_date") or "").strip()
    if work_date_raw:
        try:
            work_date = date.fromisoformat(work_date_raw)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="work_date must be YYYY-MM-DD")
    else:
        work_date = datetime.now(timezone.utc).date()

    summary = str(payload.get("summary") or "").strip()
    if not summary:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="summary is required")
    blockers = str(payload.get("blockers") or "").strip()
    next_plan = str(payload.get("next_plan") or "").strip()
    status_value = str(payload.get("status") or "in_progress").strip().lower()
    if status_value not in {"in_progress", "blocked", "completed"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="status must be in_progress, blocked, or completed")
    hours_spent = float(payload.get("hours_spent") or 0)
    progress_pct = float(payload.get("progress_pct") or 0)
    if hours_spent < 0 or hours_spent > 24:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="hours_spent must be between 0 and 24")
    if progress_pct < 0 or progress_pct > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="progress_pct must be between 0 and 100")

    row = (
        db.query(EmployeeProjectDailyReport)
        .filter(
            EmployeeProjectDailyReport.project_id == project_id,
            EmployeeProjectDailyReport.employee_id == user.id,
            EmployeeProjectDailyReport.work_date == work_date,
        )
        .one_or_none()
    )
    if row:
        row.hours_spent = hours_spent
        row.progress_pct = progress_pct
        row.status = status_value
        row.summary = summary[:1200]
        row.blockers = blockers[:1200]
        row.next_plan = next_plan[:1200]
    else:
        db.add(
            EmployeeProjectDailyReport(
                project_id=project_id,
                employee_id=user.id,
                work_date=work_date,
                hours_spent=hours_spent,
                progress_pct=progress_pct,
                status=status_value,
                summary=summary[:1200],
                blockers=blockers[:1200],
                next_plan=next_plan[:1200],
            )
        )
    # Keep project state aligned with employee delivery updates.
    if status_value == "completed" or progress_pct >= 100:
        project.status = ProjectStatus.completed
    elif project.status == ProjectStatus.draft:
        project.status = ProjectStatus.active
    db.add(project)
    db.commit()
    return {"ok": True}


@router.get("/employee/profile")
def employee_profile(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    cv_extract = profile.cv_extract or {}
    ai = profile.ai_profile or {}
    nlp = cv_extract.get("nlp") or {}
    story_h, story_sub, analysis_bullets = build_story_bullets(db, user, profile)
    return {
        "basic": {
            "name": user.full_name,
            "email": user.email,
            "phone": user.phone_number,
            "department": user.department,
            "job_title": user.job_title,
            "country": user.country,
            "experience_level": user.experience_level,
            "primary_skill": user.primary_skill,
            "headline": profile.headline or "",
        },
        "career_preferences": {
            "target_job_title": ai.get("target_job_title"),
            "selected_project_ids": list(ai.get("selected_project_ids") or []),
        },
        "cv_intel": {
            "story_headline": story_h,
            "story_subtitle": story_sub,
            "analysis_bullets": analysis_bullets,
            "suggested_skills": (ai.get("suggested_skills") or [])[:15],
            "primary_skill_validated": ai.get("primary_skill_validated"),
            "parser_confidence": ai.get("confidence"),
            "pipeline": ai.get("nlp_pipeline") or nlp.get("pipeline"),
            "role_context_alignment": ai.get("role_context_alignment") or {},
        },
        "cv_preview": {
            "skills": (cv_extract.get("skills") or [])[:20],
            "certifications": (cv_extract.get("certifications") or [])[:20],
            "experience": (cv_extract.get("experience") or [])[:20],
        },
        "experience_timeline": (cv_extract.get("experience") or [])[:20],
    }


@router.put("/employee/profile")
def update_employee_profile(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    basic = payload.get("basic") or {}
    allowed_user_fields = {"phone_number", "country", "primary_skill"}
    for key in allowed_user_fields:
        if key in basic and isinstance(basic[key], str) and basic[key].strip():
            setattr(user, key, basic[key].strip())
    if "headline" in basic:
        profile.headline = str(basic.get("headline") or "")[:200]
    db.add(user)
    db.add(profile)
    db.commit()
    return {"ok": True}


@router.get("/employee/skills")
def employee_skills(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    rows = (
        db.query(UserSkill, Skill)
        .join(Skill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id == user.id)
        .order_by(Skill.name.asc())
        .all()
    )
    return [
        {
            "id": str(us.id),
            "skill_id": str(s.id),
            "skill": s.name,
            "level": int(us.level),
            "last_updated": us.updated_at.isoformat(),
        }
        for us, s in rows
    ]


@router.post("/employee/skills")
def add_employee_skill(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    skill_name = normalize_skill_name(str(payload.get("skill") or "").strip())
    level = int(payload.get("level") or 1)
    if not skill_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Skill is required")
    if level < 1 or level > 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Level must be between 1 and 4")
    skill = db.query(Skill).filter(Skill.name == skill_name).one_or_none()
    if not skill:
        skill = Skill(name=skill_name, category="general")
        db.add(skill)
        db.flush()
    existing = db.query(UserSkill).filter(UserSkill.user_id == user.id, UserSkill.skill_id == skill.id).one_or_none()
    if existing:
        existing.level = level
        existing.source = SkillSource.self
    else:
        db.add(UserSkill(user_id=user.id, skill_id=skill.id, level=level, source=SkillSource.self))
    db.commit()
    return {"ok": True}


@router.patch("/employee/skills/{user_skill_id}")
def update_employee_skill(
    user_skill_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    try:
        row_id = uuid.UUID(user_skill_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid skill row id")
    row = db.query(UserSkill).filter(UserSkill.id == row_id, UserSkill.user_id == user.id).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill row not found")
    level = int(payload.get("level") or row.level)
    if level < 1 or level > 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Level must be between 1 and 4")
    row.level = level
    row.source = SkillSource.self
    db.commit()
    return {"ok": True}


@router.delete("/employee/skills/{user_skill_id}")
def delete_employee_skill(
    user_skill_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    try:
        row_id = uuid.UUID(user_skill_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid skill row id")
    row = db.query(UserSkill).filter(UserSkill.id == row_id, UserSkill.user_id == user.id).one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill row not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/employee/self-assessment")
def get_self_assessment(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    ai = profile.ai_profile or {}
    return list(ai.get("self_assessments") or [])


@router.post("/employee/self-assessment")
def submit_self_assessment(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    skill = normalize_skill_name(str(payload.get("skill") or "").strip())
    self_score = int(payload.get("self_score") or 0)
    confidence = int(payload.get("confidence") or 0)
    years = float(payload.get("years") or 0)
    if not skill or self_score < 1 or self_score > 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid self assessment input")
    manager_score = int(payload.get("manager_score") or self_score)
    final_skill_score = round((self_score + manager_score) / 2, 2)
    profile = _employee_profile_or_ensure(db, user)
    ai = dict(profile.ai_profile or {})
    assessments = list(ai.get("self_assessments") or [])
    assessments = [a for a in assessments if a.get("skill") != skill]
    assessments.append(
        {
            "skill": skill,
            "self_score": self_score,
            "confidence": confidence,
            "experience_years": years,
            "manager_score": manager_score,
            "final_skill_score": final_skill_score,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    ai["self_assessments"] = assessments
    profile.ai_profile = ai
    db.add(profile)
    db.commit()
    return {"ok": True, "final_skill_score": final_skill_score}


@router.get("/employee/training-recommendations")
def training_recommendations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    return build_employee_training_recommendations(db, user, profile)


@router.get("/employee/training-progress")
def training_progress(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    refresh_stale_training_sessions(db, user.id)
    rows = (
        db.query(HrAction)
        .filter(HrAction.target_user_id == user.id, HrAction.action_type == "training_assign")
        .order_by(HrAction.updated_at.desc())
        .all()
    )
    active, completed, pending = [], [], []
    for r in rows:
        item = training_assignment_to_progress_item(r)
        if r.status == "completed":
            completed.append(item)
        elif r.status in ("cancelled", "rejected"):
            continue
        elif r.status == "pending":
            pending.append(item)
        else:
            active.append(item)
    return {"pending_requests": pending, "active_courses": active, "completed_courses": completed}


@router.patch("/employee/training-assignments/{action_id}", response_model=HrActionPublic)
def employee_update_training_assignment(
    action_id: uuid.UUID,
    body: TrainingAssignmentProgressUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HrAction:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign" or action.target_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    try:
        return apply_training_assignment_update(
            db,
            action,
            body,
            skill_source_on_complete=SkillSource.self,
            require_active_session_for_progress_change=True,
            require_minimum_verified_time_to_complete=True,
            require_full_progress_for_completion=True,
            allow_progress_pct_auto_complete=False,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/employee/training-assignments/{action_id}/material-progress", response_model=HrActionPublic)
def employee_training_material_progress(
    action_id: uuid.UUID,
    body: MaterialReadingProgressUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HrAction:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign" or action.target_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    try:
        return apply_material_reading_progress(db, action, body)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/employee/training-assignments/{action_id}/course-material")
def employee_download_training_course_material(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign" or action.target_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    if action.status == "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Course content is available after HR approves your enrollment request.")
    upload_root = os.path.join(os.getcwd(), "uploads")
    path, fname, media_type = get_material_download_path(action, upload_root)
    return FileResponse(path, filename=fname, media_type=media_type)


@router.post("/employee/training-assignments/{action_id}/session/start", response_model=HrActionPublic)
def employee_start_training_session(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HrAction:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign" or action.target_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    try:
        return start_training_session(db, action)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/employee/training-assignments/{action_id}/session/end", response_model=HrActionPublic)
def employee_end_training_session(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HrAction:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign" or action.target_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    try:
        return end_training_session(db, action)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/employee/training-assignments/{action_id}/heartbeat", response_model=HrActionPublic)
def employee_training_session_heartbeat(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> HrAction:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    action = db.query(HrAction).filter(HrAction.id == action_id).one_or_none()
    if not action or action.action_type != "training_assign" or action.target_user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training assignment not found")
    try:
        return training_session_heartbeat(db, action)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/employee/training-enroll")
def training_enroll(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    course = str(payload.get("course") or "").strip()
    skill = normalize_skill_name(str(payload.get("skill") or "").strip())
    if not course or not skill:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="course and skill are required")
    provider = str(payload.get("provider") or "").strip() or None
    official_url = str(payload.get("official_url") or "").strip() or None
    course_id = str(payload.get("course_id") or "").strip() or None

    existing = (
        db.query(HrAction)
        .filter(
            HrAction.target_user_id == user.id,
            HrAction.action_type == "training_assign",
            HrAction.status.in_(["pending", "assigned", "in_progress"]),
        )
        .all()
    )
    for row in existing:
        payload_row = row.payload or {}
        same_course = str(payload_row.get("program_name") or "").strip().lower() == course.lower()
        same_skill = normalize_skill_name(str(payload_row.get("target_skill") or "")) == skill
        if same_course or same_skill:
            if row.status == "pending":
                return {
                    "ok": True,
                    "status": "pending",
                    "request_id": str(row.id),
                    "message": "You already have a pending HR request for this training.",
                }
            return {
                "ok": True,
                "status": row.status,
                "request_id": str(row.id),
                "message": "You are already enrolled in this training. Open Training progress to continue.",
            }

    now_iso = datetime.now(timezone.utc).isoformat()
    link_meta = resolve_official_course_link(
        catalog_course_id=course_id,
        program_name=course,
        target_skill=skill,
        official_url=official_url,
        provider=provider,
    )
    action = HrAction(
        target_user_id=user.id,
        created_by_id=user.id,
        action_type="training_assign",
        status="pending",
        note="Employee enrollment request from recommendations",
        payload=ensure_training_attendance_defaults(
            {
                "program_name": course,
                "target_skill": skill,
                "source": "employee_enrollment_request",
                "provider": link_meta.get("provider") or provider,
                "official_url": link_meta.get("official_url"),
                "catalog_course_id": link_meta.get("catalog_course_id") or course_id,
                "requested_at": now_iso,
                "progress_pct": 0,
            }
        ),
    )
    db.add(action)
    db.commit()
    db.refresh(action)
    return {
        "ok": True,
        "status": "pending",
        "request_id": str(action.id),
        "message": "Enrollment request sent to HR. You can track status under Training progress.",
    }


@router.get("/employee/career-paths")
def career_paths(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    return build_employee_career_paths(db, user, profile)


@router.get("/employee/goals")
def get_goals(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    return list((profile.ai_profile or {}).get("employee_goals") or [])


@router.post("/employee/goals")
def save_goal(
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    title = str(payload.get("title") or "").strip()
    status_value = str(payload.get("status") or "Not started")
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Goal title required")
    profile = _employee_profile_or_ensure(db, user)
    ai = dict(profile.ai_profile or {})
    goals = list(ai.get("employee_goals") or [])
    goals = [g for g in goals if g.get("title") != title]
    goals.append({"title": title, "status": status_value, "updated_at": datetime.now(timezone.utc).isoformat()})
    ai["employee_goals"] = goals
    profile.ai_profile = ai
    db.add(profile)
    db.commit()
    return {"ok": True}


@router.get("/employee/notifications")
def notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    profile = _employee_profile_or_ensure(db, user)
    ai = dict(profile.ai_profile or {})
    saved = list(ai.get("employee_notifications") or [])
    if saved:
        return saved
    generated = []
    for g in my_skill_gaps(db=db, user=user).get("gaps", []):
        if g.get("gap", 0) > 1:
            generated.append(
                {
                    "type": "skill_gap_warning",
                    "message": f"Gap detected in {g['skill']} (gap {g['gap']}).",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )
    generated.append(
        {
            "type": "training_available",
            "message": "New training recommendations are available for your profile.",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    assigned_rows = (
        db.query(ProjectAssignment, ManagerProject)
        .join(ManagerProject, ManagerProject.id == ProjectAssignment.project_id)
        .filter(
            ProjectAssignment.employee_id == user.id,
            ManagerProject.status.in_([ProjectStatus.active, ProjectStatus.draft]),
        )
        .all()
    )
    today = datetime.now(timezone.utc).date()
    for assignment, project in assigned_rows:
        latest = (
            db.query(EmployeeProjectDailyReport.work_date)
            .filter(
                EmployeeProjectDailyReport.project_id == assignment.project_id,
                EmployeeProjectDailyReport.employee_id == user.id,
            )
            .order_by(EmployeeProjectDailyReport.work_date.desc())
            .first()
        )
        if not latest:
            generated.append(
                {
                    "type": "daily_report_due",
                    "message": f"Submit your first daily report for project '{project.name}'.",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            continue
        days_since = (today - latest[0]).days
        if days_since >= 2:
            generated.append(
                {
                    "type": "daily_report_overdue",
                    "message": f"Daily report overdue for project '{project.name}' ({days_since} day(s) since last report).",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
            )
    ai["employee_notifications"] = generated[:20]
    profile.ai_profile = ai
    db.add(profile)
    db.commit()
    return generated[:20]
