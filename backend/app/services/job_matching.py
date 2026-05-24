"""Project–employee matching with deep CV understanding (NLP evidence + TF–IDF semantics)."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.ai.cv_skill_nlp import (
    SkillMention,
    analyze_cv_structure,
    document_nlp_confidence,
    experience_section_range,
    extract_skill_mentions,
    mention_in_span,
)
from app.ai.sklearn_signals import cv_role_semantic_similarity
from app.models.employee_profile import EmployeeProfile
from app.models.hr_action import HrAction
from app.models.manager_project import (
    ManagerProject,
    ProjectAssignment,
    ProjectJobTitleRequirement,
    ProjectSkillRequirement,
    ProjectStatus,
)
from app.models.skill import Skill
from app.models.user import User
from app.models.user_skill import UserSkill
from app.services.cv import cv_text_for_user
from app.services.skill_normalization import normalize_skill_name

_HAVE_SKLEARN = True
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
except ImportError:
    _HAVE_SKLEARN = False

_SOURCE_WEIGHT = {"manager": 1.0, "cv": 0.92, "ai": 0.78, "self": 0.58}


def _normalize_title(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _title_tokens(value: str | None) -> set[str]:
    return {token for token in _normalize_title(value).replace("/", " ").replace("-", " ").split(" ") if token}


def title_match_score(candidate_title: str, required_titles: set[str]) -> float:
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


@dataclass(frozen=True)
class ProjectRequirements:
    skill_rows: list[tuple[uuid.UUID, str, int, float]]
    required_titles: set[str]
    normalized_titles: set[str]
    skill_names: set[str]
    skill_ids: set[uuid.UUID]
    total_weight: float
    has_requirements: bool
    requirement_document: str
    skills_with_levels: dict[str, int]


def _build_requirements(
    db: Session,
    project: ManagerProject,
) -> ProjectRequirements:
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
    normalized_titles = {_normalize_title(title) for title in required_titles}
    skill_names = {_normalize_title(name) for _, name, _, _ in req_rows}
    skill_ids = {skill_id for skill_id, _, _, _ in req_rows}
    total_weight = sum(float(weight) for _, _, _, weight in req_rows) if req_rows else 1.0
    skills_with_levels: dict[str, int] = {}
    doc_parts = [
        project.name or "",
        project.description or "",
        " ".join(required_titles),
    ]
    for _, name, level, weight in req_rows:
        canon = normalize_skill_name(name) or _normalize_title(name)
        skills_with_levels[canon] = max(skills_with_levels.get(canon, 0), int(level))
        repeat = max(1, min(int(level), 4))
        w = max(1, int(round(float(weight))))
        doc_parts.extend([canon.replace("-", " ")] * repeat * w)
    return ProjectRequirements(
        skill_rows=req_rows,
        required_titles=required_titles,
        normalized_titles=normalized_titles,
        skill_names=skill_names,
        skill_ids=skill_ids,
        total_weight=total_weight,
        has_requirements=len(req_rows) > 0,
        requirement_document=" ".join(p for p in doc_parts if p and str(p).strip()),
        skills_with_levels=skills_with_levels,
    )


def _project_semantic_similarity(cv_text: str, requirement_document: str) -> float | None:
    if not _HAVE_SKLEARN:
        return None
    cv = (cv_text or "").strip()
    req = (requirement_document or "").strip()
    if len(cv) < 80 or len(req) < 12:
        return None
    try:
        vectorizer = TfidfVectorizer(
            lowercase=True,
            strip_accents="unicode",
            ngram_range=(1, 2),
            max_features=4096,
            min_df=1,
            token_pattern=r"(?u)\b[a-zA-Z#+][a-zA-Z0-9#/+.\-_%]*\b",
        )
        matrix = vectorizer.fit_transform([cv[:80000], req[:12000]])
        if matrix.shape[1] == 0:
            return None
        raw = cosine_similarity(matrix[0:1], matrix[1:2])[0, 0]
        if raw != raw:
            return None
        return round(float(max(0.0, min(1.0, raw))), 4)
    except Exception:
        return None


def _cv_inferred_level(mention: SkillMention | None, *, in_experience: bool) -> int:
    if mention is None:
        return 0
    level = 2
    if mention.confidence >= 0.88:
        level = 4
    elif mention.confidence >= 0.75:
        level = 3
    if in_experience:
        level = min(5, level + 1)
    elif mention.in_skills_section:
        level = min(5, level)
    else:
        level = max(1, level - 1)
    return level


def _cv_quality_tier(structure_score: float, doc_confidence: float, char_count: int) -> str:
    composite = structure_score * 0.55 + doc_confidence * 0.45
    if char_count < 120:
        return "minimal"
    if composite >= 0.72 and char_count >= 1200:
        return "strong"
    if composite >= 0.48:
        return "moderate"
    return "weak"


def _employee_cv_bundle(db: Session, employee: User, profile: EmployeeProfile | None) -> dict:
    cv_text = cv_text_for_user(db, employee.id)
    cv_extract = (profile.cv_extract if profile and isinstance(profile.cv_extract, dict) else {}) or {}
    mentions = extract_skill_mentions(cv_text) if cv_text else []
    if not mentions and cv_extract.get("skills_detail"):
        # Rehydrate lightweight mentions from stored extract when PDF text unavailable.
        for row in cv_extract.get("skills_detail") or []:
            if not isinstance(row, dict):
                continue
            skill = normalize_skill_name(str(row.get("skill") or ""))
            if skill:
                mentions.append(
                    SkillMention(
                        canonical=skill,
                        confidence=float(row.get("confidence") or 0.55),
                        keyword_matched=str(row.get("keyword_matched") or skill),
                        span_start=0,
                        span_end=0,
                        in_skills_section=bool(row.get("in_skills_section")),
                    )
                )
    mention_by_skill = {m.canonical: m for m in mentions}
    structure = analyze_cv_structure(cv_text)
    nlp_meta = cv_extract.get("nlp") if isinstance(cv_extract.get("nlp"), dict) else {}
    doc_confidence = float(
        nlp_meta.get("document_confidence")
        if nlp_meta.get("document_confidence") is not None
        else document_nlp_confidence(mentions, len(cv_text))
    )
    exp_span = experience_section_range(cv_text) if cv_text else None
    quality_tier = _cv_quality_tier(structure["structure_score"], doc_confidence, structure["char_count"])
    quality_score = round(
        min(
            100.0,
            (
                doc_confidence * 35.0
                + structure["structure_score"] * 30.0
                + min(1.0, structure["bullet_count"] / 10.0) * 15.0
                + min(1.0, structure["section_count"] / 3.0) * 10.0
                + min(1.0, len(mentions) / 8.0) * 10.0
            ),
        ),
        1,
    )
    return {
        "cv_text": cv_text,
        "cv_extract": cv_extract,
        "mentions": mentions,
        "mention_by_skill": mention_by_skill,
        "structure": structure,
        "doc_confidence": doc_confidence,
        "exp_span": exp_span,
        "quality_tier": quality_tier,
        "quality_score": quality_score,
    }


def _registration_cv_intel(ai_profile: dict | None) -> dict:
    ai = ai_profile if isinstance(ai_profile, dict) else {}
    role_ctx = ai.get("role_context_alignment") if isinstance(ai.get("role_context_alignment"), dict) else {}
    confidence = ai.get("confidence")
    return {
        "pipeline": ai.get("nlp_pipeline") or "taxonomy_regex_v1",
        "parser_confidence": round(float(confidence), 3) if confidence is not None else None,
        "parser_confidence_pct": round(float(confidence) * 100.0, 1) if confidence is not None else None,
        "primary_skill_validated": ai.get("primary_skill_validated"),
        "role_context_alignment": role_ctx,
        "suggested_skills": (ai.get("suggested_skills") or [])[:12],
    }


def _compute_project_skill_breakdown(
    *,
    skill_rows: list[tuple[uuid.UUID, str, int, float]],
    current: dict[uuid.UUID, int],
    mention_by_skill: dict,
    exp_span,
    source_by_skill: dict[uuid.UUID, str],
) -> tuple[dict, list[dict]]:
    breakdown: list[dict] = []
    cv_overlap: set[str] = set()
    weighted_total = 0.0
    weighted_hit = 0.0
    inventory_hits = 0

    for skill_id, name, required_level, weight in skill_rows:
        canon = normalize_skill_name(name) or _normalize_title(name)
        inventory_level = int(current.get(skill_id, 0))
        mention = mention_by_skill.get(canon)
        in_exp = mention_in_span(mention, exp_span) if mention else False
        cv_level = _cv_inferred_level(mention, in_experience=in_exp)
        if inventory_level > 0 and cv_level > 0:
            effective = max(inventory_level, int(round(inventory_level * 0.45 + cv_level * 0.55)))
        elif cv_level > 0:
            effective = cv_level
        else:
            effective = inventory_level
        gap = max(0, int(required_level) - effective)
        w = float(weight)
        weighted_total += w
        if effective >= int(required_level):
            weighted_hit += w
        if mention:
            cv_overlap.add(canon)
        if inventory_level >= int(required_level):
            inventory_hits += 1
        breakdown.append(
            {
                "skill": canon,
                "required_level": int(required_level),
                "weight": w,
                "inventory_level": inventory_level,
                "cv_level": cv_level,
                "effective_level": effective,
                "gap": gap,
                "cv_evidence": bool(mention),
                "in_experience": in_exp,
                "source": source_by_skill.get(skill_id, "self"),
            }
        )

    missing_ranked = sorted(
        [row["skill"] for row in breakdown if row["gap"] > 0],
        key=lambda s: next((r["weight"] for r in breakdown if r["skill"] == s), 1.0),
        reverse=True,
    )
    return (
        {
            "required_skill_count": len(skill_rows),
            "cv_skill_overlap": len(cv_overlap),
            "cv_skill_overlap_pct": round((len(cv_overlap) / max(1, len(skill_rows))) * 100.0, 1),
            "inventory_coverage_pct": round((inventory_hits / max(1, len(skill_rows))) * 100.0, 1),
            "weighted_project_alignment_pct": round((weighted_hit / max(weighted_total, 0.1)) * 100.0, 1),
            "missing_priority_skills": missing_ranked[:10],
        },
        breakdown,
    )


def _build_match_analysis_bullets(
    *,
    employee: User,
    project: ManagerProject,
    project_context: dict,
    cv_intel: dict,
    department_match: bool,
    title_score: float,
    semantic_pct: float | None,
    cv_bundle: dict,
    req: ProjectRequirements,
    cv_hits: list[dict],
) -> list[str]:
    bullets: list[str] = []
    reg_align = cv_intel.get("role_context_alignment") or {}
    if isinstance(reg_align, dict) and reg_align.get("weighted_role_alignment_pct") is not None:
        bullets.append(
            f"Registration HR profile alignment {reg_align['weighted_role_alignment_pct']}% "
            f"({reg_align.get('required_skill_overlap', 0)}/{reg_align.get('required_skill_count', 0)} skills vs declared role)."
        )
    if project.department:
        bullets.append(
            f"Project department: {project.department} — employee is in "
            f"{employee.department or 'unknown'} ({'match' if department_match else 'mismatch'})."
        )
    if req.required_titles:
        titles = ", ".join(sorted(req.required_titles))
        bullets.append(f"Required job title(s): {titles} — title fit {int(round(title_score * 100))}%.")
    if req.has_requirements:
        bullets.append(
            f"Project weighted skill alignment {project_context.get('weighted_project_alignment_pct', 0)}% "
            f"({project_context.get('cv_skill_overlap', 0)}/{project_context.get('required_skill_count', 0)} skills evidenced in CV)."
        )
    if semantic_pct is not None:
        bullets.append(f"Résumé semantic similarity to project brief: {semantic_pct:.0f}% (TF–IDF).")
    if cv_intel.get("parser_confidence_pct") is not None:
        bullets.append(f"Registration NLP parser confidence: {cv_intel['parser_confidence_pct']:.0f}%.")
    if cv_intel.get("primary_skill_validated") is True:
        bullets.append("Declared primary skill is validated in uploaded CV text.")
    elif cv_intel.get("primary_skill_validated") is False:
        bullets.append("Declared primary skill was not found verbatim in CV — verify during interview.")
    if req.has_requirements:
        evidenced = sum(1 for h in cv_hits if h.get("cv_confidence", 0) > 0)
        bullets.append(f"{evidenced}/{len(req.skill_rows)} required project skills substantiated in CV NLP pass.")
    if cv_bundle.get("quality_tier"):
        bullets.append(f"CV structure tier: {cv_bundle['quality_tier']} ({cv_bundle.get('quality_score', 0):.0f}% quality score).")
    return bullets[:8]


def _score_cv_skill_evidence(
    req: ProjectRequirements,
    cv_bundle: dict,
) -> tuple[float, list[dict], float]:
    """Weighted evidence that required skills are substantiated in the CV (not just inventory)."""
    if not req.has_requirements:
        return 55.0, [], 0.0
    mention_by_skill = cv_bundle["mention_by_skill"]
    exp_span = cv_bundle["exp_span"]
    hits: list[dict] = []
    weighted = 0.0
    experience_hits = 0
    for _, name, required_level, weight in req.skill_rows:
        canon = normalize_skill_name(name) or _normalize_title(name)
        mention = mention_by_skill.get(canon)
        in_exp = mention_in_span(mention, exp_span) if mention else False
        inferred = _cv_inferred_level(mention, in_experience=in_exp)
        if mention:
            ratio = min(1.15, inferred / max(1, int(required_level)))
            conf = mention.confidence * (1.08 if in_exp else (1.0 if mention.in_skills_section else 0.82))
            weighted += ratio * float(weight) * conf
            if in_exp:
                experience_hits += 1
            hits.append(
                {
                    "skill": canon,
                    "cv_confidence": round(mention.confidence, 3),
                    "in_experience": in_exp,
                    "in_skills_section": mention.in_skills_section,
                    "inferred_level": inferred,
                }
            )
        else:
            hits.append({"skill": canon, "cv_confidence": 0.0, "in_experience": False, "in_skills_section": False, "inferred_level": 0})
    score = (weighted / max(req.total_weight, 0.1)) * 100.0
    exp_ratio = experience_hits / max(1, len(req.skill_rows))
    return round(score, 1), hits, round(exp_ratio, 3)


def match_employees_for_project(
    db: Session,
    *,
    project: ManagerProject,
    manager: User,
    team: list[User],
    workloads: dict[uuid.UUID, float],
) -> list[dict]:
    req = _build_requirements(db, project)
    matches: list[dict] = []

    for employee in team:
        profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == employee.id).one_or_none()
        cv_bundle = _employee_cv_bundle(db, employee, profile)
        cv_text = cv_bundle["cv_text"]
        cv_extract = cv_bundle["cv_extract"]

        title_score = title_match_score(employee.job_title, req.normalized_titles)
        project_department = (project.department or "").strip() or (manager.department or "")
        department_match = (
            not project_department
            or _normalize_title(employee.department) == _normalize_title(project_department)
        )

        skill_rows = (
            db.query(UserSkill.skill_id, UserSkill.level, UserSkill.source)
            .filter(UserSkill.user_id == employee.id)
            .all()
        )
        current = {sid: int(level) for sid, level, _ in skill_rows}
        source_by_skill: dict[uuid.UUID, str] = {
            sid: str(source.value if hasattr(source, "value") else source) for sid, _, source in skill_rows
        }

        mention_by_skill = cv_bundle["mention_by_skill"]
        exp_span = cv_bundle["exp_span"]
        ai_profile = (profile.ai_profile if profile and isinstance(profile.ai_profile, dict) else {}) or {}
        cv_intel = _registration_cv_intel(ai_profile)
        project_context, skill_breakdown = _compute_project_skill_breakdown(
            skill_rows=req.skill_rows,
            current=current,
            mention_by_skill=mention_by_skill,
            exp_span=exp_span,
            source_by_skill=source_by_skill,
        )
        project_alignment_pct = float(project_context.get("weighted_project_alignment_pct") or 0.0)
        weighted_inventory = 0.0
        total_gap = 0.0
        critical_skill_missing = False
        for skill_id, name, required_level, weight in req.skill_rows:
            inventory_level = current.get(skill_id, 0)
            canon = normalize_skill_name(name) or _normalize_title(name)
            mention = mention_by_skill.get(canon)
            cv_level = _cv_inferred_level(mention, in_experience=mention_in_span(mention, exp_span) if mention else False)
            source = source_by_skill.get(skill_id, "self")
            src_w = _SOURCE_WEIGHT.get(source, 0.65)
            if inventory_level > 0 and cv_level > 0:
                effective = max(inventory_level, int(round(inventory_level * 0.45 + cv_level * 0.55)))
            elif cv_level > 0:
                effective = cv_level
            else:
                effective = inventory_level
            ratio = effective / max(1, int(required_level))
            mention_conf = mention.confidence if mention else (0.45 if inventory_level > 0 else 0.0)
            evidence = src_w * (0.55 + mention_conf * 0.45)
            weighted_inventory += min(1.15, max(0.0, ratio)) * float(weight) * evidence
            total_gap += max(0, int(required_level) - effective)
            if effective <= 0 and (int(required_level) >= 4 or float(weight) >= 1.5):
                critical_skill_missing = True

        skill_score = (weighted_inventory / max(req.total_weight, 0.1)) * 100 if req.has_requirements else 55.0
        cv_evidence_score, cv_hits, exp_skill_ratio = _score_cv_skill_evidence(req, cv_bundle)

        role_cosine = cv_role_semantic_similarity(cv_text, req.skills_with_levels)
        project_cosine = _project_semantic_similarity(cv_text, req.requirement_document)
        semantic_values = [v for v in (role_cosine, project_cosine) if v is not None]
        semantic_avg = sum(semantic_values) / len(semantic_values) if semantic_values else None
        semantic_pct = round(semantic_avg * 100.0, 1) if semantic_avg is not None else None

        cert_values = [str(x) for x in (cv_extract.get("certifications") or [])]
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
        training_skills = {
            _normalize_title((row[0] or {}).get("target_skill"))
            for row in training_rows
            if isinstance(row[0], dict)
        }
        cert_hits = sum(1 for rs in req.skill_names if rs and (rs in cert_text or rs in training_skills))
        cert_score = cert_hits / max(1, len(req.skill_names)) if req.has_requirements else 0.0

        experience_years = int(cv_extract.get("experience_years") or 0)
        if experience_years <= 0 and cv_text:
            m = re.search(r"(\d{1,2})\+?\s+years?", cv_text.lower())
            if m:
                experience_years = int(m.group(1))
        experience_depth_score = _clamp01(experience_years / 8.0)

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
                ProjectSkillRequirement.skill_id.in_(req.skill_ids) if req.skill_ids else False,
            )
            .distinct()
            .count()
        )
        project_similarity_score = similar_projects / max(1, total_projects)
        experience_score = (project_similarity_score * 0.65) + (experience_depth_score * 0.35)

        gap_penalty = _clamp01((total_gap / max(1, len(req.skill_rows))) / 5.0) if req.has_requirements else 0.0
        primary_skill_match = (
            (_normalize_title(employee.primary_skill) in req.skill_names) if req.has_requirements else True
        )

        semantic_component = (semantic_avg or 0.0) * 100.0
        quality_component = cv_bundle["quality_score"]
        cv_component = cv_evidence_score

        score = (
            (skill_score / 100.0) * 0.26
            + (cv_component / 100.0) * 0.25
            + (semantic_component / 100.0) * 0.20
            + (project_alignment_pct / 100.0) * 0.08
            + (quality_component / 100.0) * 0.07
            + experience_score * 0.06
            + (title_score) * 0.04
            + availability_score * 0.02
            + performance_score * 0.01
            + cert_score * 0.01
            - gap_penalty * 0.12
        ) * 100.0

        avg_mention_conf = (
            sum(m.confidence for m in cv_bundle["mentions"]) / len(cv_bundle["mentions"])
            if cv_bundle["mentions"]
            else 0.0
        )
        score = score * (0.82 + min(0.18, avg_mention_conf * 0.18 + cv_bundle["doc_confidence"] * 0.12))

        hard_rule_flags: list[str] = []
        if project_department and not department_match:
            hard_rule_flags.append("department_mismatch")
        if req.normalized_titles and _normalize_title(employee.job_title) not in req.normalized_titles:
            hard_rule_flags.append("job_title_mismatch")
        if req.has_requirements and not primary_skill_match:
            hard_rule_flags.append("primary_skill_mismatch")
        if workload >= 100:
            hard_rule_flags.append("employee_overloaded")
        if req.has_requirements and critical_skill_missing:
            hard_rule_flags.append("critical_skill_missing")
        if cv_bundle["quality_tier"] == "minimal" and req.has_requirements:
            hard_rule_flags.append("cv_too_sparse")

        raw_match_pct = round(max(0.0, min(100.0, score)), 1)
        eligible = len(hard_rule_flags) == 0

        analysis_bullets = _build_match_analysis_bullets(
            employee=employee,
            project=project,
            project_context=project_context,
            cv_intel=cv_intel,
            department_match=department_match,
            title_score=title_score,
            semantic_pct=semantic_pct,
            cv_bundle=cv_bundle,
            req=req,
            cv_hits=cv_hits,
        )

        recommendation = f"Recommended for {project.name}: strong project–CV alignment and eligible for assignment."
        if hard_rule_flags:
            recommendation = (
                f"Not recommended for {project.name} until blockers are resolved "
                f"({', '.join(h.replace('_', ' ') for h in hard_rule_flags)})."
            )
        elif total_gap > 0:
            recommendation = (
                f"Conditionally recommended for {project.name}: core fit present; "
                f"address {int(total_gap)} weighted skill gap point(s) via mentoring or training."
            )
        elif cv_bundle["quality_tier"] == "weak":
            recommendation = (
                f"Proceed with caution on {project.name}: inventory aligns but CV evidence is thin — validate in interview."
            )

        fit_class = "Reject"
        if raw_match_pct >= 85:
            fit_class = "Best Fit"
        elif raw_match_pct >= 70:
            fit_class = "Good Fit"
        elif raw_match_pct >= 50:
            fit_class = "Risky"

        highlights: list[str] = []
        if cv_bundle["quality_tier"] == "strong":
            highlights.append(f"Strong CV structure ({cv_bundle['quality_score']:.0f}% quality score)")
        elif cv_bundle["quality_tier"] == "weak":
            highlights.append(f"Thin CV — limited sections and evidence ({cv_bundle['quality_score']:.0f}% quality)")
        elif cv_bundle["quality_tier"] == "minimal":
            highlights.append("CV text too sparse for reliable deep matching")
        if semantic_pct is not None:
            highlights.append(f"Project semantic similarity {semantic_pct:.0f}% (TF–IDF)")
        if req.has_requirements:
            evidenced = sum(1 for h in cv_hits if h.get("cv_confidence", 0) > 0)
            highlights.append(f"{evidenced}/{len(req.skill_rows)} required skills evidenced in CV text")
            if exp_skill_ratio > 0:
                highlights.append(f"{int(exp_skill_ratio * 100)}% of required skills appear in experience section")
        if avg_mention_conf > 0:
            highlights.append(f"Avg CV skill confidence {avg_mention_conf * 100:.0f}%")
        if project_alignment_pct > 0:
            highlights.append(f"Project weighted skill alignment {project_alignment_pct:.0f}%")

        matches.append(
            {
                "employee_id": str(employee.id),
                "employee": employee.full_name,
                "match_pct": raw_match_pct,
                "skill_match_pct": round(skill_score, 1),
                "project_alignment_pct": round(project_alignment_pct, 1),
                "title_match_pct": round(title_score * 100, 1),
                "gap": round(total_gap, 2),
                "availability": workload < 100,
                "workload_pct": round(workload, 1),
                "job_title": employee.job_title,
                "department": employee.department,
                "primary_skill": employee.primary_skill,
                "experience_level": employee.experience_level,
                "eligible": eligible,
                "eligibility_reason": ", ".join(hard_rule_flags) if hard_rule_flags else None,
                "recommendation": recommendation,
                "fit_class": fit_class,
                "hard_rule_flags": hard_rule_flags,
                "experience_score": round(experience_score * 100, 1),
                "availability_score": round(availability_score * 100, 1),
                "performance_score": round(performance_score * 100, 1),
                "evidence_confidence": round((avg_mention_conf or cv_bundle["doc_confidence"]) * 100, 1),
                "cert_score": round(cert_score * 100, 1),
                "cv_score": round(cv_evidence_score, 1),
                "cv_semantic_pct": semantic_pct,
                "cv_quality_pct": cv_bundle["quality_score"],
                "cv_quality_tier": cv_bundle["quality_tier"],
                "cv_document_confidence_pct": round(cv_bundle["doc_confidence"] * 100, 1),
                "experience_depth_score": round(experience_depth_score * 100, 1),
                "gap_penalty": round(gap_penalty * 100, 1),
                "department_match": department_match,
                "primary_skill_match": primary_skill_match,
                "cv_skill_hits": cv_hits[:8],
                "highlights": highlights[:5],
                "analysis_bullets": analysis_bullets,
                "cv_intel": cv_intel,
                "project_context": {
                    **project_context,
                    "project_department": project_department,
                    "required_job_titles": sorted(req.required_titles),
                },
                "skill_breakdown": skill_breakdown,
                "engine": "registration_cv_nlp_project_v3",
            }
        )

    return sorted(matches, key=lambda x: (x["eligible"], x["match_pct"]), reverse=True)


def build_project_match_report(
    db: Session,
    *,
    project: ManagerProject,
    manager: User,
    team: list[User],
    workloads: dict[uuid.UUID, float],
) -> dict:
    req = _build_requirements(db, project)
    skill_requirements = [
        {"skill": name, "required_level": int(level), "weight": float(weight)}
        for _, name, level, weight in req.skill_rows
    ]
    candidates = match_employees_for_project(
        db, project=project, manager=manager, team=team, workloads=workloads
    )
    eligible_count = sum(1 for row in candidates if row.get("eligible"))
    best_match_pct = max((float(row.get("match_pct") or 0) for row in candidates), default=0.0)
    return {
        "project": {
            "id": str(project.id),
            "name": project.name,
            "department": (project.department or "").strip(),
            "description": project.description or "",
            "required_job_titles": sorted(req.required_titles),
            "required_employees": int(project.required_employees or 1),
            "skill_requirements": skill_requirements,
            "status": project.status.value if hasattr(project.status, "value") else str(project.status),
        },
        "analysis_profile": {
            "pipeline": "taxonomy_regex_v1",
            "engine": "registration_cv_nlp_project_v3",
            "signals": [
                "registration_cv_intel",
                "project_department_and_titles",
                "weighted_project_skills",
                "tfidf_semantic",
                "inventory_and_cv_gap",
            ],
        },
        "candidates": candidates,
        "summary": {
            "team_size": len(team),
            "candidates_ranked": len(candidates),
            "eligible_count": eligible_count,
            "best_match_pct": round(best_match_pct, 1),
        },
    }
