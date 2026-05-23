"""Career path matching from master job-title catalog + ML role similarity (real data)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.ai.gap import compute_skill_gaps
from app.ai.sklearn_signals import blended_alignment_pct, cv_role_semantic_similarity
from app.models.employee_profile import EmployeeProfile
from app.models.master_data import JobTitleCatalog
from app.models.skill import Skill
from app.models.user import User
from app.models.user_skill import UserSkill
from app.services.required_skill_profile import required_skill_levels_for
from app.services.skill_normalization import normalize_skill_level_map


def build_employee_career_paths(db: Session, user: User, profile: EmployeeProfile) -> list[dict]:
    rows = (
        db.query(Skill.name, UserSkill.level)
        .join(UserSkill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id == user.id)
        .all()
    )
    current = normalize_skill_level_map({name: int(level) for (name, level) in rows})

    cv = profile.cv_extract or {}
    cv_text = " ".join(
        [
            (cv.get("text_preview") or "")[:4000],
            " ".join(str(s) for s in (cv.get("skills") or []) if str(s).strip()),
        ]
    ).strip()

    job_titles = (
        db.query(JobTitleCatalog)
        .filter(JobTitleCatalog.active.is_(True))
        .order_by(JobTitleCatalog.name.asc())
        .limit(40)
        .all()
    )
    if not job_titles:
        job_titles_names = [user.job_title] if user.job_title else []
    else:
        job_titles_names = [j.name for j in job_titles]

    out: list[dict] = []
    for title in job_titles_names:
        if not title or not str(title).strip():
            continue
        required, weights = required_skill_levels_for(user.primary_skill, title, user.department)
        gaps = compute_skill_gaps(
            current=current,
            required=required,
            importance_weights=weights,
            confidence_base=0.65,
        )
        w_imp = sum(g.weighted_gap_impact for g in gaps) / max(1, len(gaps))
        gap_math = round(max(0.0, min(100.0, 100.0 - w_imp * 8.0)), 1)
        cosine = cv_role_semantic_similarity(cv_text if len(cv_text) >= 24 else None, required)
        match_pct = blended_alignment_pct(gap_math, cosine, semantic_weight=0.45)
        missing = [g.skill for g in gaps if g.gap > 0][:8]
        out.append(
            {
                "role": title,
                "career_match_pct": match_pct,
                "required_skills": required,
                "missing_skills": missing,
                "semantic_similarity_pct": int(round(cosine * 100)) if cosine is not None else None,
                "is_current_hr_title": title.strip().lower() == (user.job_title or "").strip().lower(),
                "engine": "catalog_required_profile_sklearn_v1",
            }
        )

    out.sort(key=lambda x: x["career_match_pct"], reverse=True)
    return out[:25]
