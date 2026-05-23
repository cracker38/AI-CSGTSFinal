"""Per-employee training recommendations from skill gaps + official catalog + CV-aware ML ranking."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.ai.gap import GapItem, compute_skill_gaps
from app.ai.sklearn_signals import cv_role_semantic_similarity
from app.models.employee_profile import EmployeeProfile
from app.models.hr_action import HrAction
from app.models.skill import Skill
from app.models.user import User
from app.models.user_skill import UserSkill
from app.services.employee_competency import (
    build_employee_cv_competency,
    effective_skill_level,
    employee_context_document,
    skill_cv_evidence,
)
from app.services.required_skill_profile import required_skill_profile_with_weights
from app.services.skill_normalization import normalize_skill_level_map, normalize_skill_name
from app.services.training_catalog import OFFICIAL_COURSE_CATALOG, OfficialCourse, courses_for_skill

_HAVE_SKLEARN = True
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
except ImportError:
    _HAVE_SKLEARN = False

_SOURCE_WEIGHT = {"manager": 1.0, "cv": 0.92, "ai": 0.78, "self": 0.58}


def _skill_source_map(db: Session, user_id) -> dict[str, str]:
    rows = (
        db.query(Skill.name, UserSkill.source)
        .join(UserSkill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id == user_id)
        .all()
    )
    out: dict[str, str] = {}
    for name, source in rows:
        out[normalize_skill_name(str(name))] = str(source.value if hasattr(source, "value") else source)
    return out


def _fallback_course(skill: str) -> OfficialCourse:
    tokens = {t for t in skill.replace("-", " ").split() if len(t) > 2}
    best: OfficialCourse = OFFICIAL_COURSE_CATALOG[0]
    best_score = -1
    for course in OFFICIAL_COURSE_CATALOG:
        hay = " ".join([course.title, course.description, " ".join(course.target_skills)]).lower()
        score = sum(1 for t in tokens if t in hay)
        for ts in course.target_skills:
            if ts in skill or skill in ts:
                score += 3
        if score > best_score:
            best_score = score
            best = course
    return best


def _active_enrolled_skills(db: Session, user_id) -> set[str]:
    rows = (
        db.query(HrAction)
        .filter(
            HrAction.target_user_id == user_id,
            HrAction.action_type == "training_assign",
            HrAction.status.in_(["assigned", "in_progress"]),
        )
        .all()
    )
    skills: set[str] = set()
    for row in rows:
        skill = normalize_skill_name(str((row.payload or {}).get("target_skill") or ""))
        if skill:
            skills.add(skill)
    return skills


def _rank_course_for_gap(
    *,
    employee_context: str,
    gap: GapItem,
    candidates: list[OfficialCourse],
) -> tuple[OfficialCourse, float]:
    if not candidates:
        raise ValueError("no candidates")
    if len(candidates) == 1:
        return candidates[0], 0.75

    if not _HAVE_SKLEARN:
        candidates = sorted(candidates, key=lambda c: (-c.duration_weeks, c.title))
        return candidates[0], 0.7

    docs = [employee_context[:80_000], gap.skill, gap.explanation]
    for c in candidates:
        docs.append(f"{c.title} {c.provider} {c.description} {' '.join(c.target_skills)}")
    try:
        vectorizer = TfidfVectorizer(
            lowercase=True,
            strip_accents="unicode",
            ngram_range=(1, 2),
            max_features=1024,
            min_df=1,
            token_pattern=r"(?u)\b[a-zA-Z#+][a-zA-Z0-9#/+.\-_%]*\b",
        )
        matrix = vectorizer.fit_transform(docs)
        if matrix.shape[1] == 0:
            return candidates[0], 0.7
        ctx_vec = matrix[0:1]
        best_course = candidates[0]
        best_score = -1.0
        for idx, course in enumerate(candidates):
            course_vec = matrix[3 + idx : 4 + idx]
            raw = float(cosine_similarity(ctx_vec, course_vec)[0, 0])
            if raw != raw:
                continue
            if raw > best_score:
                best_score = raw
                best_course = course
        return best_course, max(0.0, min(1.0, best_score))
    except Exception:
        return candidates[0], 0.7


def _level_fit(course: OfficialCourse, gap: GapItem) -> str:
    if gap.gap >= 3:
        return "advanced" if course.level == "advanced" else course.level
    if gap.current_level == 0:
        return "beginner" if course.level == "beginner" else course.level
    return course.level


def _projected_reduction(
    gap: GapItem,
    *,
    cv_hit: bool,
    in_experience: bool,
    cv_confidence: float,
    cert_hit: bool,
    match_pct: float,
) -> float:
    base = 28.0 + gap.gap * 14.0 + min(20.0, gap.weighted_gap_impact * 4.0)
    if cv_hit:
        base += 6.0 + cv_confidence * 12.0
    if in_experience:
        base += 8.0
    if cert_hit:
        base += 6.0
    base += (match_pct - 60.0) * 0.15
    return round(min(95.0, max(15.0, base)), 1)


def build_employee_training_recommendations(
    db: Session,
    user: User,
    profile: EmployeeProfile,
    *,
    max_recommendations: int = 20,
) -> dict:
    rows = (
        db.query(Skill.name, UserSkill.level)
        .join(UserSkill, Skill.id == UserSkill.skill_id)
        .filter(UserSkill.user_id == user.id)
        .all()
    )
    current = normalize_skill_level_map({name: int(level) for (name, level) in rows})
    required, importance_weights = required_skill_profile_with_weights(user)
    gaps = compute_skill_gaps(
        current=current,
        required=required,
        importance_weights=importance_weights,
        confidence_base=0.65,
    )

    competency = build_employee_cv_competency(db, user, profile)
    cv_extract = profile.cv_extract or {}
    cert_text = " ".join([str(c) for c in (cv_extract.get("certifications") or [])]).lower()
    skill_sources = _skill_source_map(db, user.id)
    enrolled_skills = _active_enrolled_skills(db, user.id)
    employee_context = employee_context_document(user, profile, competency.cv_text)
    role_cosine = cv_role_semantic_similarity(
        employee_context if len(employee_context) >= 24 else None,
        required,
    )

    recs: list[dict] = []
    used_course_ids: set[str] = set()

    for gap in gaps:
        if gap.gap <= 0:
            continue
        skill = normalize_skill_name(gap.skill)
        if not skill or skill in enrolled_skills:
            continue

        candidates = [c for c in courses_for_skill(skill) if c.course_id not in used_course_ids]
        catalog_fallback = False
        if not candidates:
            fallback = _fallback_course(skill)
            if fallback.course_id in used_course_ids:
                continue
            candidates = [fallback]
            catalog_fallback = True

        course, semantic_score = _rank_course_for_gap(
            employee_context=employee_context,
            gap=gap,
            candidates=candidates,
        )
        used_course_ids.add(course.course_id)

        source = skill_sources.get(skill, "self")
        evidence_confidence = _SOURCE_WEIGHT.get(source, 0.65)
        cv_ev = skill_cv_evidence(competency, skill)
        cv_conf = float(cv_ev.get("cv_confidence") or 0)
        cv_relevance = cv_conf
        cert_relevance = 1.0 if skill and skill in cert_text else 0.0
        _, eff_meta = effective_skill_level(
            gap.current_level,
            source=source,
            competency=competency,
            skill=skill,
        )

        gap_priority = round(gap.weighted_gap_impact, 2)
        match_pct = round(
            min(
                99.0,
                48.0
                + gap.gap * 8.0
                + gap_priority * 3.5
                + semantic_score * 24.0
                + evidence_confidence * 10.0
                + cv_relevance * 14.0
                + (8.0 if cv_ev.get("in_experience_section") else 0.0)
                + cert_relevance * 4.0,
            ),
            1,
        )

        rationale_parts = [
            f"Required level {gap.required_level} vs your current {gap.current_level} (gap {gap.gap}).",
            f"Priority weight {gap.importance_weight:.2f} → weighted impact {gap.weighted_gap_impact:.2f}.",
            (
                f"Official program from {course.provider} for «{skill}»."
                if not catalog_fallback
                else f"Nearest official {course.provider} program for «{skill}»."
            ),
            f"Inventory source: {source}.",
        ]
        if cv_ev.get("in_cv"):
            if cv_ev.get("in_experience_section"):
                rationale_parts.append(
                    f"Résumé evidences this skill in work experience (confidence {int(cv_conf * 100)}%) — course closes the verified level gap."
                )
            else:
                rationale_parts.append(
                    f"Skill on résumé (confidence {int(cv_conf * 100)}%) but not in experience section — training validates competency."
                )
        else:
            rationale_parts.append("Skill not detected in résumé — highest priority to build evidence.")
        if cert_relevance:
            rationale_parts.append("Related certification on file — course deepens demonstrated competency.")
        if role_cosine is not None:
            rationale_parts.append(f"Role TF–IDF alignment: {int(round(role_cosine * 100))}%.")

        recs.append(
            {
                "course": course.title,
                "course_id": course.course_id,
                "provider": course.provider,
                "official_url": course.url,
                "is_official": True,
                "skill": skill,
                "required_level": gap.required_level,
                "current_level": gap.current_level,
                "effective_level": eff_meta.get("effective_level"),
                "gap": gap.gap,
                "severity": gap.severity,
                "priority_score": gap_priority,
                "match_pct": match_pct,
                "mode": course.delivery_mode,
                "certification": course.certification,
                "duration_weeks": course.duration_weeks,
                "recommended_level": _level_fit(course, gap),
                "evidence_confidence_pct": round(evidence_confidence * 100, 1),
                "cert_relevance_pct": round(cert_relevance * 100, 1),
                "cv_relevance_pct": round(cv_relevance * 100, 1),
                "cv_in_experience": bool(cv_ev.get("in_experience_section")),
                "semantic_match_pct": round(semantic_score * 100, 1),
                "projected_gap_reduction_pct": _projected_reduction(
                    gap,
                    cv_hit=bool(cv_ev.get("in_cv")),
                    in_experience=bool(cv_ev.get("in_experience_section")),
                    cv_confidence=cv_conf,
                    cert_hit=bool(cert_relevance),
                    match_pct=match_pct,
                ),
                "rationale": " ".join(rationale_parts),
                "engine": "gap_catalog_cv_competency_v2",
            }
        )

    recs.sort(key=lambda r: (r["priority_score"], r["match_pct"], r["gap"]), reverse=True)
    return {
        "recommendations": recs[:max_recommendations],
        "cv_competency": {
            "quality_tier": competency.quality_tier,
            "quality_score": competency.quality_score,
            "document_confidence_pct": round(competency.doc_confidence * 100, 1),
            "skills_detected": len(competency.mention_by_skill),
            "role_semantic_similarity_pct": int(round(role_cosine * 100)) if role_cosine is not None else None,
        },
        "engine": "employee_training_cv_competency_v2",
    }
