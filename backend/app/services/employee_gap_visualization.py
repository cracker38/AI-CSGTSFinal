"""Official per-employee skill gap bundle for visualization (inventory + HR role profile + CV evidence)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.ai.gap import GapItem, compute_skill_gaps, recommend_actions
from app.ai.sklearn_signals import blended_alignment_pct, cv_role_semantic_similarity
from app.models.employee_profile import EmployeeProfile
from app.models.skill import Skill
from app.models.user import User
from app.models.user_skill import UserSkill
from app.services.employee_competency import (
    build_employee_cv_competency,
    competency_summary_for_employee,
    effective_skill_level,
    employee_context_document,
    training_verified_skill_levels,
)
from app.services.required_skill_profile import required_skill_profile_with_weights
from app.services.skill_normalization import normalize_skill_level_map, normalize_skill_name


def _skill_source_map(db: Session, user_id) -> dict[str, str]:
    rows = (
        db.query(Skill.name, UserSkill.source)
        .join(UserSkill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id == user_id)
        .all()
    )
    return {
        normalize_skill_name(str(name)): str(source.value if hasattr(source, "value") else source)
        for name, source in rows
    }


def _enrich_gap_row(
    g: GapItem,
    *,
    evidence_source: str | None,
    cv_evidence: dict,
    effective_level: int,
) -> dict:
    return {
        "skill": g.skill,
        "required_level": g.required_level,
        "current_level": g.current_level,
        "effective_level": effective_level,
        "gap": g.gap,
        "effective_gap": max(0, int(g.required_level) - int(effective_level)),
        "severity": g.severity,
        "confidence": g.confidence,
        "explanation": g.explanation,
        "importance_weight": g.importance_weight,
        "weighted_gap": g.weighted_gap,
        "weighted_gap_impact": g.weighted_gap_impact,
        "evidence_source": evidence_source or ("missing" if g.current_level == 0 else "unknown"),
        "in_cv": cv_evidence.get("in_cv", False),
        "cv_confidence_pct": round(float(cv_evidence.get("cv_confidence") or 0) * 100, 1),
        "in_experience_section": cv_evidence.get("in_experience_section", False),
        "cv_inferred_level": cv_evidence.get("cv_inferred_level", 0),
        "training_verified": cv_evidence.get("training_verified", False),
        "status": "gap" if g.gap > 0 else "meets_or_exceeds",
        "competency_note": _gap_competency_note(g, cv_evidence, effective_level),
    }


def _gap_competency_note(g: GapItem, cv_evidence: dict, effective_level: int) -> str:
    if g.gap <= 0:
        if cv_evidence.get("training_verified"):
            return "Meets HR target — competency validated through completed training."
        return "Meets HR target in validated inventory."
    if cv_evidence.get("training_verified") and effective_level > g.current_level:
        return (
            f"Training completed — effective level {effective_level} (inventory {g.current_level}) "
            f"vs required {g.required_level}; gap closing with verified learning."
        )
    if not cv_evidence.get("in_cv"):
        return "Gap not substantiated in résumé text — prioritize training or update CV."
    if cv_evidence.get("in_experience_section"):
        return f"Skill evidenced in work experience (CV confidence {int(float(cv_evidence.get('cv_confidence', 0)) * 100)}%) — close level gap with targeted training."
    return f"Skill listed on CV (confidence {int(float(cv_evidence.get('cv_confidence', 0)) * 100)}%) but inventory level {g.current_level} vs required {g.required_level}."


def build_employee_skill_gap_visualization(db: Session, user: User, profile: EmployeeProfile) -> dict:
    rows = (
        db.query(Skill.name, UserSkill.level)
        .join(UserSkill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id == user.id)
        .all()
    )
    current = normalize_skill_level_map({name: int(level) for (name, level) in rows})
    required, importance_weights = required_skill_profile_with_weights(user)
    gap_items = compute_skill_gaps(
        current=current,
        required=required,
        importance_weights=importance_weights,
        confidence_base=0.65,
    )

    sources = _skill_source_map(db, user.id)
    competency = build_employee_cv_competency(db, user, profile)
    training_verified = training_verified_skill_levels(profile)
    enriched_gaps = []
    for g in gap_items:
        eff, cv_ev = effective_skill_level(
            current.get(g.skill, 0),
            source=sources.get(g.skill),
            competency=competency,
            skill=g.skill,
            training_verified_level=training_verified.get(g.skill),
        )
        enriched_gaps.append(
            _enrich_gap_row(
                g,
                evidence_source=sources.get(g.skill),
                cv_evidence=cv_ev,
                effective_level=eff,
            )
        )

    chart_rows = sorted(
        [
            {
                "skill": g["skill"],
                "skill_label": g["skill"].replace("-", " ").title()[:28],
                "required": g["required_level"],
                "current": g["current_level"],
                "effective": g["effective_level"],
                "gap": g["gap"],
                "weighted_impact": g["weighted_gap_impact"],
                "severity": g["severity"],
                "cv_confidence_pct": g["cv_confidence_pct"],
            }
            for g in enriched_gaps
        ],
        key=lambda r: (r["weighted_impact"], r["gap"]),
        reverse=True,
    )

    gaps_positive = [g for g in enriched_gaps if g["gap"] > 0]
    cv_evidence_gaps = [g for g in gaps_positive if g["in_cv"]]
    experience_gaps = [g for g in gaps_positive if g["in_experience_section"]]

    context_doc = employee_context_document(user, profile, competency.cv_text)
    role_cosine = cv_role_semantic_similarity(
        context_doc if len(context_doc) >= 24 else None,
        required,
    )
    gap_math_alignment = round(
        max(0.0, min(100.0, 100.0 - (sum(g["weighted_gap_impact"] for g in enriched_gaps) / max(1, len(enriched_gaps))) * 8.0)),
        1,
    )
    alignment_score = blended_alignment_pct(gap_math_alignment, role_cosine, semantic_weight=0.45)

    return {
        "role_context": {
            "employee_name": user.full_name,
            "job_title": user.job_title,
            "department": user.department,
            "primary_skill": user.primary_skill,
            "experience_level": user.experience_level,
            "profile_source": "hr_employee_record",
            "required_profile_rule": "primary_skill + job_title + department stack (canonical)",
        },
        "cv_competency": competency_summary_for_employee(db, user, profile, competency),
        "required_profile": required,
        "current_profile": current,
        "importance_weights": importance_weights,
        "summary": {
            "skills_in_scope": len(enriched_gaps),
            "skills_with_gap": len(gaps_positive),
            "skills_meeting_target": len(enriched_gaps) - len(gaps_positive),
            "high_severity_gaps": sum(1 for g in gaps_positive if g["severity"] == "high"),
            "medium_severity_gaps": sum(1 for g in gaps_positive if g["severity"] == "medium"),
            "low_severity_gaps": sum(1 for g in gaps_positive if g["severity"] == "low"),
            "total_weighted_impact": round(sum(g["weighted_gap_impact"] for g in gaps_positive), 2),
            "avg_gap": round(sum(g["gap"] for g in gaps_positive) / max(1, len(gaps_positive)), 2)
            if gaps_positive
            else 0.0,
            "alignment_score_pct": alignment_score,
            "role_semantic_similarity_pct": int(round(role_cosine * 100)) if role_cosine is not None else None,
            "gaps_with_cv_evidence": len(cv_evidence_gaps),
            "gaps_in_experience_section": len(experience_gaps),
            "competency_quality_tier": competency.quality_tier,
            "competency_quality_score": competency_summary_for_employee(db, user, profile, competency).get(
                "quality_score", competency.quality_score
            ),
        },
        "chart": chart_rows,
        "gaps": enriched_gaps,
        "priority_gaps": [g for g in enriched_gaps if g["gap"] > 0][:15],
        "recommendations": recommend_actions(gap_items),
        "explainability": {
            "rule": (
                "Required levels come from your official HR record (primary skill, job title, department). "
                "Current levels blend validated inventory with CV NLP evidence (confidence, experience section, inferred level)."
            ),
            "weighted_gaps": "weighted_gap_impact = max(0, required − current) × importance_weight.",
            "visualization": "Chart compares required vs inventory; effective level incorporates résumé depth where detected.",
        },
        "engine": {
            "version": "employee_gap_viz_4_cv_competency",
            "weighted_gap_engine": True,
            "sklearn_role_similarity": role_cosine is not None,
            "cv_competency_engine": True,
        },
    }
