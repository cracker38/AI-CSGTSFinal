from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.manager_project import (
    EmployeeProjectDailyReport,
    ManagerProject,
    ProjectAssignment,
    ProjectJobTitleRequirement,
    ProjectSkillRequirement,
    ProjectStatus,
)
from app.models.employee_profile import EmployeeProfile
from app.models.hr_action import HrAction
from app.models.master_data import JobTitleCatalog
from app.models.skill import Skill
from app.models.user import AccountStatus, User, UserRole
from app.models.user_skill import UserSkill
from app.services.skill_normalization import normalize_skill_name

router = APIRouter()


def _normalize_title(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _title_tokens(value: str | None) -> set[str]:
    return {token for token in _normalize_title(value).replace("/", " ").replace("-", " ").split(" ") if token}


def _title_match_score(candidate_title: str, required_titles: set[str]) -> float:
    if not required_titles:
        return 1.0
    candidate_norm = _normalize_title(candidate_title)
    if candidate_norm in required_titles:
        return 1.0
    candidate_tokens = _title_tokens(candidate_title)
    best = 0.0
    for required in required_titles:
        required_tokens = _title_tokens(required)
        if not required_tokens:
            continue
        overlap = len(candidate_tokens.intersection(required_tokens))
        score = overlap / max(1, len(required_tokens))
        if score > best:
            best = score
    return best


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _team_query(db: Session, manager_id: uuid.UUID):
    return db.query(User).filter(
        User.role == UserRole.employee,
        User.status == AccountStatus.active,
        User.manager_id == manager_id,
    )


def _workload_by_employee(db: Session, manager_id: uuid.UUID) -> dict[uuid.UUID, float]:
    rows = (
        db.query(ProjectAssignment.employee_id, ProjectAssignment.allocation_pct)
        .join(ManagerProject, ManagerProject.id == ProjectAssignment.project_id)
        .filter(ManagerProject.manager_id == manager_id, ManagerProject.status == ProjectStatus.active)
        .all()
    )
    totals: dict[uuid.UUID, float] = defaultdict(float)
    for employee_id, allocation in rows:
        totals[employee_id] += float(allocation or 0)
    return totals


@router.get("/overview")
def manager_overview(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    team = _team_query(db, manager.id).all()
    team_ids = [u.id for u in team]
    active_projects = (
        db.query(ManagerProject).filter(ManagerProject.manager_id == manager.id, ManagerProject.status == ProjectStatus.active).count()
    )
    workloads = _workload_by_employee(db, manager.id)
    overloaded = sum(1 for uid in team_ids if workloads.get(uid, 0.0) > 100.0)
    available = sum(1 for uid in team_ids if workloads.get(uid, 0.0) < 100.0)

    skills = (
        db.query(Skill.name, UserSkill.level)
        .join(UserSkill, UserSkill.skill_id == Skill.id)
        .filter(UserSkill.user_id.in_(team_ids) if team_ids else False)
        .all()
    )
    if skills:
        team_gap_score = round(sum(max(0, 3 - int(level)) for _, level in skills) / len(skills), 2)
    else:
        team_gap_score = 0.0

    skill_distribution = Counter([sname for sname, _ in skills]).most_common(8)
    workload_distribution = [
        {"name": u.full_name, "workload_pct": round(workloads.get(u.id, 0.0), 1)}
        for u in sorted(team, key=lambda x: x.full_name.lower())
    ]
    return {
        "kpis": {
            "total_team_members": len(team),
            "active_projects": active_projects,
            "team_skill_gap_score": team_gap_score,
            "available_employees": available,
            "overloaded_employees": overloaded,
        },
        "skill_distribution": [{"skill": k, "count": v} for k, v in skill_distribution],
        "workload_distribution": workload_distribution,
    }


@router.get("/team-members")
def team_members(
    skill: str | None = Query(default=None),
    availability: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    team = _team_query(db, manager.id).all()
    workloads = _workload_by_employee(db, manager.id)
    result = []
    for employee in team:
        user_skills = (
            db.query(Skill.name, UserSkill.level)
            .join(UserSkill, UserSkill.skill_id == Skill.id)
            .filter(UserSkill.user_id == employee.id)
            .all()
        )
        skills = [{"name": name, "level": level} for name, level in user_skills]
        workload = round(workloads.get(employee.id, 0.0), 1)
        availability_state = "available" if workload < 100 else "overloaded"
        performance = max(0, min(100, int(95 - workload * 0.35)))
        row = {
            "id": str(employee.id),
            "name": employee.full_name,
            "role": employee.job_title,
            "skills": skills,
            "availability": availability_state,
            "workload_pct": workload,
            "performance": performance,
        }
        result.append(row)

    if skill:
        result = [r for r in result if any(skill.lower() in s["name"].lower() for s in r["skills"])]
    if availability:
        result = [r for r in result if r["availability"] == availability]
    if q:
        sq = q.lower()
        result = [r for r in result if sq in r["name"].lower() or sq in r["role"].lower()]
    return result


@router.get("/skills/overview")
def skills_overview(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    team = _team_query(db, manager.id).all()
    team_ids = [u.id for u in team]
    skill_rows = (
        db.query(UserSkill.user_id, Skill.name, UserSkill.level)
        .join(Skill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id.in_(team_ids) if team_ids else False)
        .all()
    )
    by_employee: dict[uuid.UUID, dict[str, int]] = defaultdict(dict)
    by_skill_count: Counter = Counter()
    for uid, skill_name, level in skill_rows:
        by_employee[uid][skill_name] = int(level)
        by_skill_count[skill_name] += 1

    heatmap = []
    for member in team:
        row = {"employee": member.full_name}
        row.update(by_employee.get(member.id, {}))
        heatmap.append(row)

    total_members = max(len(team), 1)
    coverage = [
        {"skill": s, "coverage_pct": round((count / total_members) * 100, 1)}
        for s, count in by_skill_count.most_common()
    ]
    return {"heatmap": heatmap, "coverage": coverage}


@router.get("/skills/gaps")
def skills_gaps(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    projects = db.query(ManagerProject).filter(ManagerProject.manager_id == manager.id).all()
    project_ids = [p.id for p in projects]
    req_rows = (
        db.query(Skill.name, ProjectSkillRequirement.required_level)
        .join(Skill, Skill.id == ProjectSkillRequirement.skill_id)
        .filter(ProjectSkillRequirement.project_id.in_(project_ids) if project_ids else False)
        .all()
    )
    required_by_skill: dict[str, float] = defaultdict(float)
    for skill_name, required in req_rows:
        key = normalize_skill_name(skill_name)
        if key:
            required_by_skill[key] = max(required_by_skill[key], float(required))

    team = _team_query(db, manager.id).all()
    team_ids = [u.id for u in team]
    current_rows = (
        db.query(Skill.name, UserSkill.level)
        .join(UserSkill, UserSkill.skill_id == Skill.id)
        .filter(UserSkill.user_id.in_(team_ids) if team_ids else False)
        .all()
    )
    levels_by_skill: dict[str, list[int]] = defaultdict(list)
    for skill_name, lvl in current_rows:
        key = normalize_skill_name(skill_name)
        if key:
            levels_by_skill[key].append(int(lvl))

    items = []
    for skill_name, required in required_by_skill.items():
        current_avg = sum(levels_by_skill.get(skill_name, [0])) / max(1, len(levels_by_skill.get(skill_name, [])))
        gap = round(required - current_avg, 2)
        severity = "critical" if gap >= 2 else "moderate" if gap > 0 else "good"
        items.append(
            {
                "skill": skill_name,
                "required": round(required, 2),
                "current": round(current_avg, 2),
                "gap": gap,
                "severity": severity,
            }
        )
    return sorted(items, key=lambda x: x["gap"], reverse=True)


class ProjectSkillInput(BaseModel):
    skill_id: uuid.UUID
    required_level: int = Field(ge=1, le=5)
    weight: float = Field(ge=0.1, le=3.0, default=1.0)


class ProjectCreateInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=1000)
    deadline: date | None = None
    required_employees: int = Field(ge=1, le=100, default=1)
    status: ProjectStatus = ProjectStatus.draft
    requirements: list[ProjectSkillInput] = Field(min_length=1)
    required_job_titles: list[str] = Field(default_factory=list)


@router.post("/projects")
def create_project(
    payload: ProjectCreateInput,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    if not payload.required_job_titles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one required job title is required")
    active_job_titles = {
        jt for (jt,) in db.query(JobTitleCatalog.name).filter(JobTitleCatalog.active.is_(True)).all()
    }
    invalid_job_titles = [jt for jt in payload.required_job_titles if jt not in active_job_titles]
    if invalid_job_titles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown job title(s): {', '.join(invalid_job_titles)}",
        )
    # Allow planning in draft mode even when immediate capacity is unavailable.
    # Strict workforce-capacity checks apply only when creating directly as active.
    if payload.status == ProjectStatus.active:
        team = _team_query(db, manager.id).all()
        workloads = _workload_by_employee(db, manager.id)
        available_team = [u for u in team if workloads.get(u.id, 0.0) < 100]
        if len(available_team) < payload.required_employees:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Not enough available employees for required headcount",
            )
        available_job_titles = {_normalize_title(u.job_title) for u in available_team}
        missing_titles = [jt for jt in payload.required_job_titles if _normalize_title(jt) not in available_job_titles]
        if missing_titles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"No available employees for required job title(s): {', '.join(missing_titles)}",
            )

    project = ManagerProject(
        manager_id=manager.id,
        name=payload.name,
        description=payload.description,
        deadline=payload.deadline,
        required_employees=payload.required_employees,
        status=payload.status,
    )
    db.add(project)
    db.flush()
    for req in payload.requirements:
        db.add(
            ProjectSkillRequirement(
                project_id=project.id,
                skill_id=req.skill_id,
                required_level=req.required_level,
                weight=req.weight,
            )
        )
    for job_title in payload.required_job_titles:
        db.add(ProjectJobTitleRequirement(project_id=project.id, job_title=job_title))
    db.commit()
    return {"id": str(project.id), "ok": True}


@router.get("/projects")
def list_projects(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    projects = db.query(ManagerProject).filter(ManagerProject.manager_id == manager.id).order_by(ManagerProject.created_at.desc()).all()
    out = []
    for p in projects:
        assigned = db.query(ProjectAssignment).filter(ProjectAssignment.project_id == p.id).count()
        required_jobs = [
            row[0]
            for row in db.query(ProjectJobTitleRequirement.job_title)
            .filter(ProjectJobTitleRequirement.project_id == p.id)
            .all()
        ]
        out.append(
            {
                "id": str(p.id),
                "name": p.name,
                "description": p.description,
                "status": p.status.value,
                "deadline": p.deadline.isoformat() if p.deadline else None,
                "required_employees": p.required_employees,
                "assigned_employees": assigned,
                "required_job_titles": required_jobs,
            }
        )
    return out


@router.get("/projects/{project_id}/assignments")
def project_assignments(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    rows = (
        db.query(ProjectAssignment, User)
        .join(User, User.id == ProjectAssignment.employee_id)
        .filter(ProjectAssignment.project_id == project.id)
        .all()
    )
    return [
        {
            "employee_id": str(user.id),
            "employee": user.full_name,
            "allocation_pct": float(assignment.allocation_pct or 0),
        }
        for assignment, user in rows
    ]


@router.get("/projects/{project_id}/daily-reports")
def project_daily_reports_for_manager(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    rows = (
        db.query(EmployeeProjectDailyReport, User)
        .join(User, User.id == EmployeeProjectDailyReport.employee_id)
        .filter(EmployeeProjectDailyReport.project_id == project.id)
        .order_by(EmployeeProjectDailyReport.work_date.desc(), EmployeeProjectDailyReport.created_at.desc())
        .all()
    )
    return [
        {
            "report_id": str(report.id),
            "employee_id": str(employee.id),
            "employee": employee.full_name,
            "work_date": report.work_date.isoformat(),
            "hours_spent": float(report.hours_spent or 0),
            "progress_pct": float(report.progress_pct or 0),
            "status": report.status,
            "summary": report.summary,
            "blockers": report.blockers,
            "next_plan": report.next_plan,
            "updated_at": report.updated_at.isoformat() if report.updated_at else None,
        }
        for report, employee in rows
    ]


@router.get("/projects/{project_id}/match")
def match_employees(
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    req_rows = (
        db.query(ProjectSkillRequirement.skill_id, Skill.name, ProjectSkillRequirement.required_level, ProjectSkillRequirement.weight)
        .join(Skill, Skill.id == ProjectSkillRequirement.skill_id)
        .filter(ProjectSkillRequirement.project_id == project.id)
        .all()
    )
    required_titles = {
        row[0]
        for row in db.query(ProjectJobTitleRequirement.job_title)
        .filter(ProjectJobTitleRequirement.project_id == project.id)
        .all()
    }
    normalized_required_titles = {_normalize_title(title) for title in required_titles}
    has_requirements = len(req_rows) > 0
    total_weight = sum(float(weight) for _, _, _, weight in req_rows) if has_requirements else 1.0
    required_skill_ids = {skill_id for skill_id, _, _, _ in req_rows} if has_requirements else set()
    required_skill_names = {_normalize_title(name) for _, name, _, _ in req_rows} if has_requirements else set()
    workloads = _workload_by_employee(db, manager.id)
    team = _team_query(db, manager.id).all()
    matches: list[dict] = []
    for employee in team:
        title_score = _title_match_score(employee.job_title, normalized_required_titles)
        title_match = title_score >= 0.99
        department_match = _normalize_title(employee.department) == _normalize_title(manager.department)
        skill_rows = (
            db.query(UserSkill.skill_id, UserSkill.level, UserSkill.source)
            .filter(UserSkill.user_id == employee.id)
            .all()
        )
        current = {sid: int(level) for sid, level, _ in skill_rows}
        source_weight = {"manager": 1.0, "cv": 0.9, "ai": 0.75, "self": 0.65}
        evidence_conf = {
            sid: source_weight.get(str(source.value if hasattr(source, "value") else source), 0.7)
            for sid, _, source in skill_rows
        }
        weighted = 0.0
        total_gap = 0.0
        critical_skill_missing = False
        for skill_id, _, required_level, weight in req_rows:
            employee_level = current.get(skill_id, 0)
            ratio = employee_level / max(1, required_level)
            confidence = evidence_conf.get(skill_id, 0.5 if employee_level > 0 else 0.0)
            weighted += min(1.15, max(0.0, ratio)) * float(weight) * confidence
            total_gap += max(0, required_level - employee_level)
            if employee_level <= 0 and (required_level >= 4 or float(weight) >= 1.5):
                critical_skill_missing = True
        skill_score = (weighted / max(total_weight, 0.1)) * 100 if has_requirements else 55.0
        avg_evidence_conf = sum(evidence_conf.values()) / max(1, len(evidence_conf))
        workload = workloads.get(employee.id, 0.0)
        availability_score = _clamp01(1 - (workload / 100.0))
        assignment_rows = (
            db.query(ProjectAssignment.project_id, ManagerProject.status)
            .join(ManagerProject, ManagerProject.id == ProjectAssignment.project_id)
            .filter(ProjectAssignment.employee_id == employee.id)
            .all()
        )
        total_projects = len(assignment_rows)
        completed_projects = sum(1 for _, st in assignment_rows if st == ProjectStatus.completed)
        completion_score = completed_projects / max(1, total_projects)
        workload_reliability = _clamp01(1 - (workload / 120.0))
        performance_score = (completion_score * 0.75) + (workload_reliability * 0.25)
        similar_projects = (
            db.query(ProjectAssignment.project_id)
            .join(ProjectSkillRequirement, ProjectSkillRequirement.project_id == ProjectAssignment.project_id)
            .filter(
                ProjectAssignment.employee_id == employee.id,
                ProjectSkillRequirement.skill_id.in_(required_skill_ids) if required_skill_ids else False,
            )
            .distinct()
            .count()
        )
        project_similarity_score = similar_projects / max(1, total_projects)
        profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == employee.id).one_or_none()
        cert_values = []
        if profile and isinstance(profile.cv_extract, dict):
            cert_values = [str(x) for x in (profile.cv_extract.get("certifications") or [])]
        training_rows = (
            db.query(HrAction.payload)
            .filter(
                HrAction.target_user_id == employee.id,
                HrAction.action_type == "training_assign",
                HrAction.status.in_(["completed", "in_progress"]),
            )
            .all()
        )
        cert_text = " ".join(cert_values).lower()
        cv_skill_set = set()
        if profile and isinstance(profile.cv_extract, dict):
            cv_skill_set = {_normalize_title(s) for s in (profile.cv_extract.get("skills") or [])}
        experience_years = 0
        if profile and isinstance(profile.cv_extract, dict):
            experience_years = int(profile.cv_extract.get("experience_years") or 0)
        training_skills = {
            _normalize_title((row[0] or {}).get("target_skill"))
            for row in training_rows
            if isinstance(row[0], dict)
        }
        cert_hits = sum(1 for rs in required_skill_names if rs and (rs in cert_text or rs in training_skills))
        cert_score = cert_hits / max(1, len(required_skill_names)) if has_requirements else 0.0
        cv_hits = sum(1 for rs in required_skill_names if rs and rs in cv_skill_set)
        cv_score = cv_hits / max(1, len(required_skill_names)) if has_requirements else 0.0
        experience_depth_score = _clamp01(experience_years / 8.0)
        gap_penalty = _clamp01((total_gap / max(1, len(req_rows))) / 5.0) if has_requirements else 0.0
        primary_skill_match = (
            (_normalize_title(employee.primary_skill) in required_skill_names) if has_requirements else True
        )
        experience_score = (project_similarity_score * 0.7) + (experience_depth_score * 0.3)
        score = (
            (skill_score / 100.0) * 0.4
            + experience_score * 0.15
            + availability_score * 0.15
            + performance_score * 0.1
            + cert_score * 0.05
            + cv_score * 0.03
            + experience_depth_score * 0.02
            - gap_penalty * 0.1
        ) * 100.0
        score = score * (0.85 + (avg_evidence_conf * 0.15))
        hard_rule_flags: list[str] = []
        if not department_match:
            hard_rule_flags.append("department_mismatch")
        if normalized_required_titles and _normalize_title(employee.job_title) not in normalized_required_titles:
            hard_rule_flags.append("job_title_mismatch")
        if has_requirements and not primary_skill_match:
            hard_rule_flags.append("primary_skill_mismatch")
        if workload >= 100:
            hard_rule_flags.append("employee_overloaded")
        if has_requirements and critical_skill_missing:
            hard_rule_flags.append("critical_skill_missing")
        if hard_rule_flags:
            score = 0.0
        recommendation = "Ready for assignment"
        if hard_rule_flags:
            recommendation = "Blocked by hard rules"
        elif total_gap > 0:
            recommendation = "Assignable with mentoring/training support"
        fit_class = "Reject"
        if score >= 85:
            fit_class = "Best Fit"
        elif score >= 70:
            fit_class = "Good Fit"
        elif score >= 50:
            fit_class = "Risky"
        matches.append(
            {
                "employee_id": str(employee.id),
                "employee": employee.full_name,
                "match_pct": round(score, 1),
                "skill_match_pct": round(skill_score, 1),
                "title_match_pct": round(title_score * 100, 1),
                "gap": round(total_gap, 2),
                "availability": workload < 100,
                "workload_pct": round(workload, 1),
                "job_title": employee.job_title,
                "eligible": len(hard_rule_flags) == 0,
                "eligibility_reason": ", ".join(hard_rule_flags) if hard_rule_flags else None,
                "recommendation": recommendation,
                "fit_class": fit_class,
                "hard_rule_flags": hard_rule_flags,
                "experience_score": round(experience_score * 100, 1),
                "availability_score": round(availability_score * 100, 1),
                "performance_score": round(performance_score * 100, 1),
                "evidence_confidence": round(avg_evidence_conf * 100, 1),
                "cert_score": round(cert_score * 100, 1),
                "cv_score": round(cv_score * 100, 1),
                "experience_depth_score": round(experience_depth_score * 100, 1),
                "gap_penalty": round(gap_penalty * 100, 1),
                "department_match": department_match,
                "primary_skill_match": primary_skill_match,
            }
        )
    return sorted(matches, key=lambda x: (x["eligible"], x["match_pct"]), reverse=True)


class AssignmentInput(BaseModel):
    employee_id: uuid.UUID
    allocation_pct: float = Field(ge=1, le=100, default=100)


@router.post("/projects/{project_id}/assign")
def assign_employee(
    project_id: uuid.UUID,
    payload: AssignmentInput,
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> dict:
    project = db.query(ManagerProject).filter(ManagerProject.id == project_id, ManagerProject.manager_id == manager.id).one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    required_titles = {
        row[0]
        for row in db.query(ProjectJobTitleRequirement.job_title)
        .filter(ProjectJobTitleRequirement.project_id == project.id)
        .all()
    }
    normalized_required_titles = {_normalize_title(title) for title in required_titles}
    employee = _team_query(db, manager.id).filter(User.id == payload.employee_id).one_or_none()
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not in your team")
    if normalized_required_titles and _normalize_title(employee.job_title) not in normalized_required_titles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Employee job title '{employee.job_title}' is not in project required job titles",
        )
    current = _workload_by_employee(db, manager.id).get(employee.id, 0.0)
    if current >= 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Employee is already overloaded")
    existing = (
        db.query(ProjectAssignment)
        .filter(ProjectAssignment.project_id == project.id, ProjectAssignment.employee_id == employee.id)
        .one_or_none()
    )
    if existing:
        existing.allocation_pct = payload.allocation_pct
    else:
        db.add(ProjectAssignment(project_id=project.id, employee_id=employee.id, allocation_pct=payload.allocation_pct))
    if project.status == ProjectStatus.draft:
        project.status = ProjectStatus.active
    db.commit()
    return {"ok": True}


@router.get("/workload")
def workload(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    team = _team_query(db, manager.id).all()
    workloads = _workload_by_employee(db, manager.id)
    return [
        {
            "employee_id": str(u.id),
            "employee": u.full_name,
            "workload_pct": round(workloads.get(u.id, 0.0), 1),
            "availability": "available" if workloads.get(u.id, 0.0) < 100 else "overloaded",
        }
        for u in sorted(team, key=lambda x: x.full_name.lower())
    ]


@router.get("/performance")
def performance(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    team = _team_query(db, manager.id).all()
    workloads = _workload_by_employee(db, manager.id)
    now = datetime.now(timezone.utc)
    items = []
    for u in team:
        workload_pct = workloads.get(u.id, 0.0)
        completion_rate = max(0, min(100, int(96 - workload_pct * 0.4)))
        perf = max(0, min(100, int(completion_rate * 0.9 + 8)))
        items.append(
            {
                "employee_id": str(u.id),
                "employee": u.full_name,
                "performance_score": perf,
                "task_completion_rate": completion_rate,
                "skill_improvement": round(min(100, 40 + (now.month * 2) - workload_pct * 0.1), 1),
            }
        )
    return sorted(items, key=lambda x: x["performance_score"], reverse=True)


@router.get("/alerts")
def alerts(
    db: Session = Depends(get_db),
    manager: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    workloads = _workload_by_employee(db, manager.id)
    team = _team_query(db, manager.id).all()
    out = []
    for u in team:
        workload_pct = workloads.get(u.id, 0.0)
        if workload_pct > 100:
            out.append({"type": "overload", "severity": "critical", "message": f"{u.full_name} is overloaded ({workload_pct:.1f}%)."})
        elif workload_pct > 85:
            out.append({"type": "overload", "severity": "moderate", "message": f"{u.full_name} nearing overload ({workload_pct:.1f}%)."})
        if workload_pct < 10:
            out.append({"type": "capacity", "severity": "info", "message": f"{u.full_name} has low utilization."})

    for gap in skills_gaps(db, manager):
        if gap["severity"] in ("critical", "moderate"):
            out.append(
                {
                    "type": "skill_gap",
                    "severity": gap["severity"],
                    "message": f"Skill shortage in {gap['skill']} (gap {gap['gap']}).",
                }
            )
    active_projects = db.query(ManagerProject).filter(
        ManagerProject.manager_id == manager.id,
        ManagerProject.status.in_([ProjectStatus.active, ProjectStatus.draft]),
    ).all()
    today = date.today()
    for p in active_projects:
        team_rows = db.query(ProjectAssignment.employee_id).filter(ProjectAssignment.project_id == p.id).all()
        for (employee_id,) in team_rows:
            latest_report = (
                db.query(EmployeeProjectDailyReport.work_date, User.full_name)
                .join(User, User.id == EmployeeProjectDailyReport.employee_id)
                .filter(
                    EmployeeProjectDailyReport.project_id == p.id,
                    EmployeeProjectDailyReport.employee_id == employee_id,
                )
                .order_by(EmployeeProjectDailyReport.work_date.desc())
                .first()
            )
            if not latest_report:
                employee = db.query(User.full_name).filter(User.id == employee_id).first()
                out.append(
                    {
                        "type": "missing_daily_report",
                        "severity": "moderate",
                        "message": f"{employee[0] if employee else 'Employee'} has no daily report for project {p.name}.",
                    }
                )
                continue
            days_since = (today - latest_report[0]).days
            if days_since >= 2:
                out.append(
                    {
                        "type": "overdue_daily_report",
                        "severity": "moderate" if days_since < 4 else "critical",
                        "message": f"{latest_report[1]} last reported {days_since} day(s) ago on project {p.name}.",
                    }
                )
    return out


@router.get("/skills")
def skills_list(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.manager)),
) -> list[dict]:
    rows = db.query(Skill).order_by(Skill.name.asc()).all()
    return [{"id": str(s.id), "name": s.name} for s in rows]


@router.get("/job-titles")
def job_titles_list(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.manager)),
) -> list[str]:
    return [
        name for (name,) in db.query(JobTitleCatalog.name).filter(JobTitleCatalog.active.is_(True)).order_by(JobTitleCatalog.name.asc()).all()
    ]
