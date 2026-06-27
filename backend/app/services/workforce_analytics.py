"""HR workforce metrics from live database records (no synthetic demo formulas)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ai.gap import compute_skill_gaps
from app.ai.sklearn_signals import blended_alignment_pct, cv_role_semantic_similarity
from app.models.employee_profile import EmployeeProfile
from app.core.currency import CURRENCY_CODE
from app.models.manager_project import EmployeeProjectDailyReport, ManagerProject, ProjectAssignment, ProjectStatus
from app.models.master_data import JobTitleCatalog
from app.models.skill import Skill
from app.models.user import AccountStatus, User, UserRole
from app.models.user_skill import UserSkill
from app.services.required_skill_profile import required_skill_levels_for, required_skill_profile_with_weights
from app.services.skill_normalization import normalize_skill_level_map, normalize_skill_name
from app.services.training_catalog import courses_for_skill


def _training_progress_for_user(db: Session, user_id: uuid.UUID) -> tuple[float, int, int]:
    rows = (
        db.query(HrAction)
        .filter(HrAction.target_user_id == user_id, HrAction.action_type == "training_assign")
        .all()
    )
    if not rows:
        return 0.0, 0, 0
    pcts: list[float] = []
    completed = 0
    for row in rows:
        payload = row.payload or {}
        pct = float(payload.get("progress_pct") or 0)
        pcts.append(min(100.0, max(0.0, pct)))
        if row.status == "completed" or pct >= 100:
            completed += 1
    return round(sum(pcts) / len(pcts), 2), len(rows), completed


def _project_success_for_user(db: Session, user_id: uuid.UUID) -> tuple[float, int]:
    assignments = (
        db.query(ProjectAssignment.project_id)
        .filter(ProjectAssignment.employee_id == user_id)
        .all()
    )
    if not assignments:
        return 0.0, 0
    progress_values: list[float] = []
    for (project_id,) in assignments:
        latest = (
            db.query(EmployeeProjectDailyReport.progress_pct)
            .filter(
                EmployeeProjectDailyReport.project_id == project_id,
                EmployeeProjectDailyReport.employee_id == user_id,
            )
            .order_by(EmployeeProjectDailyReport.work_date.desc())
            .first()
        )
        if latest is not None:
            progress_values.append(float(latest[0] or 0))
    if not progress_values:
        return 0.0, len(assignments)
    return round(sum(progress_values) / len(progress_values), 2), len(assignments)


def _role_alignment_pct(
    db: Session,
    user: User,
    profile: EmployeeProfile | None,
    current: dict[str, int],
    required: dict[str, int],
    weights: dict[str, float],
) -> float:
    gaps = compute_skill_gaps(
        current=current,
        required=required,
        importance_weights=weights,
        confidence_base=0.65,
    )
    w_imp = sum(g.weighted_gap_impact for g in gaps) / max(1, len(gaps))
    gap_math = round(max(0.0, min(100.0, 100.0 - w_imp * 8.0)), 1)
    cv = (profile.cv_extract or {}) if profile else {}
    cv_text = " ".join(
        [
            (cv.get("text_preview") or "")[:4000],
            " ".join(str(s) for s in (cv.get("skills") or [])),
        ]
    ).strip()
    cosine = cv_role_semantic_similarity(cv_text if len(cv_text) >= 24 else None, required)
    return blended_alignment_pct(gap_math, cosine, semantic_weight=0.4)


def build_talent_pipeline_row(
    db: Session,
    user: User,
    profile: EmployeeProfile | None,
    current: dict[str, int],
    required: dict[str, int],
    weights: dict[str, float],
) -> dict:
    training_avg, training_count, training_done = _training_progress_for_user(db, user.id)
    alignment = _role_alignment_pct(db, user, profile, current, required, weights)
    gaps = [g for g in compute_skill_gaps(current=current, required=required, importance_weights=weights) if g.gap > 0]
    high_gaps = sum(1 for g in gaps if g.severity == "high")
    promotion_score = round(
        0.45 * alignment + 0.35 * training_avg + 0.20 * max(0.0, 100.0 - high_gaps * 12.0),
        2,
    )
    return {
        "user_id": str(user.id),
        "employee": user.full_name,
        "department": user.department,
        "skill_growth": round(alignment, 2),
        "training_completion_pct": training_avg,
        "trainings_total": training_count,
        "trainings_completed": training_done,
        "open_skill_gaps": len(gaps),
        "promotion_readiness_score": promotion_score,
        "high_potential": promotion_score >= 65 and len(gaps) <= 3,
        "engine": "workforce_db_sklearn_v1",
    }


def build_performance_support_row(
    db: Session,
    user: User,
    profile: EmployeeProfile | None,
    current: dict[str, int],
    required: dict[str, int],
    weights: dict[str, float],
) -> dict:
    training_avg, _, training_done = _training_progress_for_user(db, user.id)
    project_success, project_count = _project_success_for_user(db, user.id)
    gaps = compute_skill_gaps(current=current, required=required, importance_weights=weights)
    avg_current = sum(current.values()) / max(1, len(current)) if current else 0.0
    avg_required = sum(required.values()) / max(1, len(required)) if required else 0.0
    gap_to_required = round(max(0.0, avg_required - avg_current), 2)
    closed_skills = sum(1 for g in gaps if g.gap <= 0)
    skill_improvement = round((closed_skills / max(1, len(gaps))) * 100.0, 2)
    performance_score = round((project_success + skill_improvement + training_avg) / 3.0, 2)
    return {
        "user_id": str(user.id),
        "employee": user.full_name,
        "department": user.department,
        "project_success": project_success,
        "projects_tracked": project_count,
        "skill_improvement": skill_improvement,
        "skills_meeting_target": closed_skills,
        "training_completion": training_avg,
        "trainings_completed": training_done,
        "performance_score": performance_score,
        "gap_to_required": gap_to_required,
        "engine": "workforce_db_v1",
    }


def estimate_program_cost(skill: str, gap_total: int, employees_needing: int) -> int:
    """Estimated program cost in FRW (Rwanda Franc)."""
    catalog = courses_for_skill(normalize_skill_name(skill))
    if catalog:
        weeks = catalog[0].duration_weeks
        return int(max(150, weeks * 45 * max(1, employees_needing)))
    return int(max(150, gap_total * 90))


def employee_current_skills(db: Session, user_id: uuid.UUID) -> dict[str, int]:
    rows = (
        db.query(Skill.name, UserSkill.level)
        .join(UserSkill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id == user_id)
        .all()
    )
    return normalize_skill_level_map({name: int(level) for (name, level) in rows})


def team_weighted_gap_score(db: Session, employees: list[User]) -> float:
    if not employees:
        return 0.0
    impacts: list[float] = []
    for e in employees:
        current = employee_current_skills(db, e.id)
        required, weights = required_skill_profile_with_weights(e)
        gaps = compute_skill_gaps(
            current=current,
            required=required,
            importance_weights=weights,
            confidence_base=0.65,
        )
        impacts.append(sum(g.weighted_gap_impact for g in gaps) / max(1, len(gaps)))
    return round(sum(impacts) / len(impacts), 2)


def manager_employee_performance(
    db: Session,
    employee: User,
    workload_pct: float,
) -> dict:
    training_avg, _, training_done = _training_progress_for_user(db, employee.id)
    project_success, project_count = _project_success_for_user(db, employee.id)
    current = employee_current_skills(db, employee.id)
    required, weights = required_skill_profile_with_weights(employee)
    gaps = compute_skill_gaps(current=current, required=required, importance_weights=weights)
    closed = sum(1 for g in gaps if g.gap <= 0)
    skill_improvement = round((closed / max(1, len(gaps))) * 100.0, 2)
    if project_count > 0 or training_done > 0:
        performance_score = round((project_success + skill_improvement + training_avg) / 3.0, 1)
        completion_rate = project_success
    else:
        performance_score = round(max(0.0, min(100.0, 100.0 - workload_pct * 0.5)), 1)
        completion_rate = 0.0
    return {
        "performance_score": performance_score,
        "task_completion_rate": completion_rate,
        "skill_improvement": skill_improvement,
        "training_completion_pct": training_avg,
        "projects_tracked": project_count,
    }


def count_active_projects(db: Session) -> int:
    return int(
        db.query(func.count(ManagerProject.id))
        .filter(ManagerProject.status == ProjectStatus.active)
        .scalar()
        or 0
    )


def count_compliance_expiring_soon(db: Session, *, within_days: int = 30) -> int:
    today = date.today()
    limit_date = today + timedelta(days=within_days)
    rows = (
        db.query(EmployeeProfile)
        .join(User, User.id == EmployeeProfile.user_id)
        .filter(User.role == UserRole.employee, User.status == AccountStatus.active)
        .all()
    )
    expiring = 0
    for profile in rows:
        renewals = (profile.ai_profile or {}).get("hr_compliance_renewals") or []
        renewal_map = {
            str(r.get("certification") or "").strip(): r.get("valid_until")
            for r in renewals
            if r.get("certification") and r.get("valid_until")
        }
        certs = (profile.cv_extract or {}).get("certifications") or []
        if certs:
            label = str(certs[0])[:120]
            raw = renewal_map.get(label)
            if raw:
                try:
                    if date.fromisoformat(str(raw)) <= limit_date:
                        expiring += 1
                except ValueError:
                    pass
        elif renewal_map.get("None"):
            try:
                if date.fromisoformat(str(renewal_map["None"])) <= limit_date:
                    expiring += 1
            except ValueError:
                pass
    return expiring


def training_completion_roi(db: Session) -> float:
    rows = db.query(HrAction).filter(HrAction.action_type == "training_assign").all()
    if not rows:
        return 0.0
    completed = 0
    for row in rows:
        pct = float((row.payload or {}).get("progress_pct") or 0)
        if row.status == "completed" or pct >= 100:
            completed += 1
    return round(completed / len(rows), 4)


def suggest_job_title_for_skill(db: Session, skill: str) -> str | None:
    canon = normalize_skill_name(skill)
    if not canon:
        return None
    titles = db.query(JobTitleCatalog).filter(JobTitleCatalog.active.is_(True)).all()
    best_name: str | None = None
    best_rank = -1.0
    for jt in titles:
        req, wts = required_skill_levels_for(canon, jt.name, None)
        if canon not in req:
            continue
        rank = float(req.get(canon, 0)) * float(wts.get(canon, 1.0))
        if rank > best_rank:
            best_rank = rank
            best_name = jt.name
    return best_name


def _committed_training_spend(db: Session) -> int:
    """Sum estimated_cost (FRW) stored on real hr_actions training_assign rows."""
    rows = db.query(HrAction).filter(HrAction.action_type == "training_assign").all()
    total = 0.0
    for row in rows:
        raw = (row.payload or {}).get("estimated_cost")
        if raw is not None and str(raw).strip() != "":
            try:
                total += float(raw)
            except (TypeError, ValueError):
                pass
    return int(round(total))


def _training_assignments_stats(db: Session) -> dict:
    rows = db.query(HrAction).filter(HrAction.action_type == "training_assign").all()
    active = completed = 0
    by_skill: dict[str, dict] = {}
    for row in rows:
        payload = row.payload or {}
        skill = normalize_skill_name(str(payload.get("target_skill") or ""))
        if skill not in by_skill:
            by_skill[skill] = {"assignment_count": 0, "committed_spend": 0}
        by_skill[skill]["assignment_count"] += 1
        raw = payload.get("estimated_cost")
        if raw is not None:
            try:
                by_skill[skill]["committed_spend"] += int(float(raw))
            except (TypeError, ValueError):
                pass
        pct = float(payload.get("progress_pct") or 0)
        if row.status == "completed" or pct >= 100:
            completed += 1
        elif row.status in ("assigned", "in_progress"):
            active += 1
    return {
        "total_assignments": len(rows),
        "active_assignments": active,
        "completed_assignments": completed,
        "by_skill": by_skill,
    }


def build_hr_training_planning(db: Session, employees: list[User], current_map: dict, required_map: dict) -> dict:
    """HR training tab: org gap recommendations + committed spend from hr_actions only."""
    gap_skill_totals: dict[str, int] = {}
    for e in employees:
        current = current_map.get(str(e.id), {})
        required = required_map.get(str(e.id), {})
        for skill, req_level in required.items():
            gap = max(0, int(req_level) - int(current.get(skill, 0)))
            if gap > 0:
                gap_skill_totals[skill] = gap_skill_totals.get(skill, 0) + gap

    assign_stats = _training_assignments_stats(db)
    by_skill_assign = assign_stats["by_skill"]

    ranked = sorted(gap_skill_totals.items(), key=lambda x: x[1], reverse=True)[:12]
    programs: list[dict] = []
    recommended_total = 0
    for skill, gap_total in ranked:
        canon = normalize_skill_name(skill)
        catalog = courses_for_skill(canon)
        official = catalog[0] if catalog else None
        employees_needing = sum(
            1
            for e in employees
            if max(
                0,
                int(required_map.get(str(e.id), {}).get(skill, 0))
                - int(current_map.get(str(e.id), {}).get(skill, 0)),
            )
            > 0
        )
        suggested_cost = estimate_program_cost(canon, gap_total, employees_needing)
        recommended_total += suggested_cost
        skill_assign = by_skill_assign.get(canon, {})
        programs.append(
            {
                "program_name": official.title if official else f"{canon.replace('-', ' ').title()} upskilling",
                "target_skill": canon,
                "provider": official.provider if official else None,
                "official_url": official.url if official else None,
                "org_gap_units": int(gap_total),
                "employees_needing": int(employees_needing),
                "suggested_investment": int(suggested_cost),
                "active_assignments": int(skill_assign.get("assignment_count") or 0),
                "committed_spend": int(skill_assign.get("committed_spend") or 0),
            }
        )

    committed = _committed_training_spend(db)
    completion_rate = training_completion_roi(db)

    return {
        "budget": {
            "currency": CURRENCY_CODE,
            "committed_spend": committed,
            "recommended_investment": int(recommended_total),
            "uncommitted_recommendation": int(max(0, recommended_total - committed)),
        },
        "programs": programs,
        "training_completion_rate_pct": round(completion_rate * 100.0, 1),
        "assignment_stats": {
            "total": assign_stats["total_assignments"],
            "active": assign_stats["active_assignments"],
            "completed": assign_stats["completed_assignments"],
        },
        "engine": "org_gaps_official_catalog_live_assignments_v2",
    }
