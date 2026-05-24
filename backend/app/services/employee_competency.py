"""Shared CV competency analysis for employee gaps, training, and dashboard intel."""

from __future__ import annotations

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
from app.models.employee_profile import EmployeeProfile
from app.models.user import User
from app.services.skill_normalization import normalize_skill_name

_SOURCE_WEIGHT = {"manager": 1.0, "cv": 0.92, "ai": 0.78, "self": 0.58}


def _quality_tier(structure_score: float, doc_confidence: float, char_count: int) -> str:
    composite = structure_score * 0.55 + doc_confidence * 0.45
    if char_count < 120:
        return "minimal"
    if composite >= 0.72 and char_count >= 1200:
        return "strong"
    if composite >= 0.48:
        return "moderate"
    return "weak"


def _quality_score(structure: dict, doc_confidence: float, mention_count: int) -> float:
    return round(
        min(
            100.0,
            doc_confidence * 35.0
            + float(structure.get("structure_score") or 0) * 30.0
            + min(1.0, int(structure.get("bullet_count") or 0) / 10.0) * 15.0
            + min(1.0, int(structure.get("section_count") or 0) / 3.0) * 10.0
            + min(1.0, mention_count / 8.0) * 10.0,
        ),
        1,
    )


def _inferred_level_from_mention(mention: SkillMention | None, *, in_experience: bool) -> int:
    if mention is None:
        return 0
    level = 2
    if mention.confidence >= 0.88:
        level = 4
    elif mention.confidence >= 0.75:
        level = 3
    if in_experience:
        level = min(5, level + 1)
    elif not mention.in_skills_section:
        level = max(1, level - 1)
    return level


@dataclass(frozen=True)
class EmployeeCvCompetency:
    cv_text: str
    mention_by_skill: dict[str, SkillMention]
    structure: dict
    doc_confidence: float
    quality_tier: str
    quality_score: float
    exp_span: tuple[int, int] | None
    avg_mention_confidence: float
    work_history_skills: frozenset[str]


def build_employee_cv_competency(db: Session, user: User, profile: EmployeeProfile | None) -> EmployeeCvCompetency:
    from app.services.cv import cv_extract_for_user, cv_text_for_user

    cv_extract = cv_extract_for_user(db, user, profile) if profile else {}
    cv_text = cv_text_for_user(db, user.id)
    mentions = extract_skill_mentions(cv_text) if cv_text else []
    if not mentions and cv_extract.get("skills_detail"):
        for row in cv_extract.get("skills_detail") or []:
            if not isinstance(row, dict):
                continue
            skill = normalize_skill_name(str(row.get("skill") or ""))
            if not skill:
                continue
            conf = float(row.get("confidence") or 0.55)
            if row.get("in_experience_section") or row.get("mentioned_in_work_history"):
                conf = min(0.96, conf + 0.1)
            mentions.append(
                SkillMention(
                    canonical=skill,
                    confidence=conf,
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
    avg_conf = sum(m.confidence for m in mentions) / len(mentions) if mentions else 0.0
    tier = _quality_tier(structure["structure_score"], doc_confidence, structure["char_count"])
    q_score = _quality_score(structure, doc_confidence, len(mentions))
    work_history = frozenset(
        normalize_skill_name(str(row.get("skill") or ""))
        for row in (cv_extract.get("skills_detail") or [])
        if isinstance(row, dict)
        and (row.get("mentioned_in_work_history") or row.get("in_experience_section"))
        and normalize_skill_name(str(row.get("skill") or ""))
    )
    return EmployeeCvCompetency(
        cv_text=cv_text,
        mention_by_skill=mention_by_skill,
        structure=structure,
        doc_confidence=doc_confidence,
        quality_tier=tier,
        quality_score=q_score,
        exp_span=exp_span,
        avg_mention_confidence=round(avg_conf, 3),
        work_history_skills=work_history,
    )


def employee_context_document(user: User, profile: EmployeeProfile, cv_text: str) -> str:
    ai = profile.ai_profile or {}
    cv = profile.cv_extract or {}
    exp_lines = []
    for entry in (cv.get("experience") or [])[:6]:
        if not isinstance(entry, dict):
            continue
        title = entry.get("title") or ""
        company = entry.get("company") or ""
        dates = entry.get("dates") or ""
        if title or company:
            exp_lines.append(f"{title} {company} {dates}".strip())
        exp_lines.extend((entry.get("highlights") or [])[:3])
    parts = [
        user.job_title or "",
        user.department or "",
        user.primary_skill or "",
        ai.get("target_job_title") or "",
        str(cv.get("profile_summary") or "")[:2000],
        " ".join(exp_lines)[:12000],
        cv_text[:80000] if cv_text else (cv.get("text_preview") or "")[:4000],
        " ".join(str(s) for s in (cv.get("skills") or []) if str(s).strip()),
        " ".join(str(c) for c in (cv.get("certifications") or []) if str(c).strip()),
    ]
    return " ".join(p.strip() for p in parts if p and str(p).strip())


def skill_cv_evidence(competency: EmployeeCvCompetency, skill: str) -> dict:
    canon = normalize_skill_name(skill)
    mention = competency.mention_by_skill.get(canon)
    in_exp = mention_in_span(mention, competency.exp_span) if mention else False
    if not in_exp and canon in competency.work_history_skills:
        in_exp = True
    return {
        "skill": canon,
        "in_cv": mention is not None,
        "cv_confidence": round(mention.confidence, 3) if mention else 0.0,
        "in_experience_section": in_exp,
        "in_skills_section": bool(mention and mention.in_skills_section),
        "cv_inferred_level": _inferred_level_from_mention(mention, in_experience=in_exp),
    }


def effective_skill_level(
    inventory_level: int,
    *,
    source: str | None,
    competency: EmployeeCvCompetency,
    skill: str,
) -> tuple[int, dict]:
    evidence = skill_cv_evidence(competency, skill)
    cv_level = int(evidence["cv_inferred_level"])
    inv = int(inventory_level or 0)
    if inv > 0 and cv_level > 0:
        effective = max(inv, int(round(inv * 0.42 + cv_level * 0.58)))
    elif cv_level > 0:
        effective = cv_level
    else:
        effective = inv
    src_w = _SOURCE_WEIGHT.get(source or "self", 0.65)
    evidence["inventory_level"] = inv
    evidence["effective_level"] = effective
    evidence["evidence_weight"] = round(src_w * (0.5 + float(evidence["cv_confidence"]) * 0.5), 3)
    return effective, evidence


def competency_summary_dict(competency: EmployeeCvCompetency) -> dict:
    return {
        "cv_text_length": len(competency.cv_text),
        "quality_tier": competency.quality_tier,
        "quality_score": competency.quality_score,
        "document_confidence_pct": round(competency.doc_confidence * 100, 1),
        "avg_mention_confidence_pct": round(competency.avg_mention_confidence * 100, 1),
        "skills_detected": len(competency.mention_by_skill),
        "structure": competency.structure,
        "engine": "cv_nlp_competency_v3",
    }
