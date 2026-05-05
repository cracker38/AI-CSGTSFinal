from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.ai.gap import compute_skill_gaps
from app.api.deps import require_roles
from app.db.session import get_db
from app.models.cv_document import CvDocument
from app.models.skill import Skill
from app.models.user import AccountStatus, User, UserRole
from app.models.user_skill import UserSkill
from app.services.required_skill_profile import required_skill_profile_with_weights
from app.services.skill_normalization import normalize_skill_level_map


router = APIRouter()


@router.get("/org/skills/distribution")
def org_skill_distribution(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    rows = (
        db.query(Skill.name, func.count(UserSkill.id))
        .join(UserSkill, Skill.id == UserSkill.skill_id)
        .join(User, User.id == UserSkill.user_id)
        .filter(User.status == AccountStatus.active, User.role == UserRole.employee)
        .group_by(Skill.name)
        .order_by(func.count(UserSkill.id).desc())
        .limit(50)
        .all()
    )
    return {"top_skills": [{"skill": name, "count": int(c)} for (name, c) in rows]}


@router.get("/org/skill-gaps/top")
def org_top_skill_gaps(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    # Aggregate numeric gaps across employees based on deterministic required-profile rules.
    users = db.query(User).filter(User.status == AccountStatus.active, User.role == UserRole.employee).all()
    if not users:
        return {"top_gaps": [], "note": "No active employees yet."}

    # Preload current skills for all users.
    skill_rows = (
        db.query(UserSkill.user_id, Skill.name, UserSkill.level)
        .join(Skill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id.in_([u.id for u in users]))
        .all()
    )
    current_raw: dict[str, dict[str, int]] = {}
    for user_id, skill_name, level in skill_rows:
        current_raw.setdefault(str(user_id), {})[skill_name] = int(level)
    current_map = {uid: normalize_skill_level_map(raw) for uid, raw in current_raw.items()}

    gap_totals: dict[str, int] = {}
    weighted_totals: dict[str, float] = {}
    for u in users:
        required, wts = required_skill_profile_with_weights(u)
        current = current_map.get(str(u.id), {})
        gaps = compute_skill_gaps(current=current, required=required, importance_weights=wts, confidence_base=0.65)
        for g in gaps:
            if g.gap > 0:
                gap_totals[g.skill] = gap_totals.get(g.skill, 0) + int(g.gap)
                weighted_totals[g.skill] = weighted_totals.get(g.skill, 0.0) + float(g.weighted_gap_impact)

    top = sorted(weighted_totals.items(), key=lambda x: x[1], reverse=True)[:20]
    return {
        "top_gaps": [
            {"skill": s, "total_gap": int(gap_totals.get(s, 0)), "weighted_gap_impact": round(v, 2)} for (s, v) in top
        ],
        "engine": {"version": "2.0", "prioritized_by": "weighted_gap_impact"},
    }


@router.get("/org/kpis")
def org_kpis(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.hr_admin, UserRole.system_admin)),
) -> dict:
    total_users = db.query(func.count(User.id)).scalar() or 0
    pending = db.query(func.count(User.id)).filter(User.status == AccountStatus.pending_approval).scalar() or 0
    active = db.query(func.count(User.id)).filter(User.status == AccountStatus.active).scalar() or 0
    disabled = db.query(func.count(User.id)).filter(User.status == AccountStatus.disabled).scalar() or 0

    by_role_rows = db.query(User.role, func.count(User.id)).group_by(User.role).all()
    users_by_role = {r.value: int(c) for (r, c) in by_role_rows}

    total_skills = db.query(func.count(Skill.id)).scalar() or 0
    total_cvs = db.query(func.count(CvDocument.id)).scalar() or 0

    return {
        "total_users": int(total_users),
        "pending_users": int(pending),
        "active_users": int(active),
        "disabled_users": int(disabled),
        "users_by_role": users_by_role,
        "total_skills": int(total_skills),
        "total_cv_documents": int(total_cvs),
    }

