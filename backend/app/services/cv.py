from __future__ import annotations

import hashlib
import os
import re
import uuid
from datetime import datetime, timezone

from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.ai.cv_deep_parser import build_deep_cv_extract
from app.models.cv_document import CvDocument
from app.models.employee_profile import EmployeeProfile
from app.models.skill import Skill
from app.models.user import User
from app.models.user_skill import SkillSource, UserSkill
from app.services.employee_intel import sync_ai_cv_story
from app.services.required_skill_profile import required_skill_levels_for
from app.services.skill_normalization import normalize_skill_name


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _extract_text_from_pdf(pdf_path: str) -> tuple[str, dict]:
    """Return full text and metadata; never raises — callers use flags for empty/error PDFs."""
    meta: dict = {"pdf_ok": True, "pdf_error": None, "pages": 0, "empty_text": False}
    try:
        reader = PdfReader(pdf_path)
        meta["pages"] = len(reader.pages)
        parts: list[str] = []
        for page in reader.pages:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                parts.append("")
        raw = "\n".join(parts)
        if not raw.strip():
            meta["empty_text"] = True
        return raw, meta
    except Exception as e:
        meta["pdf_ok"] = False
        meta["pdf_error"] = str(e)[:500]
        return "", meta


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _level_from_nlp_confidence(confidence: float) -> int:
    """Map calibrated mention confidence to inventory level (1–5 scale)."""
    if confidence >= 0.88:
        return 4
    if confidence >= 0.78:
        return 3
    return 2


def _compute_context_alignment(
    *,
    extracted_skills: list[str],
    selected_primary_skill: str,
    selected_job_title: str,
    selected_department: str,
) -> dict:
    normalized = {normalize_skill_name(s) for s in extracted_skills if normalize_skill_name(s)}
    req_levels, req_weights = required_skill_levels_for(
        selected_primary_skill,
        selected_job_title,
        selected_department,
    )
    req_keys = set(req_levels.keys())
    overlap = normalized & req_keys
    weighted_total = sum(float(req_weights.get(k, 1.0)) for k in req_keys) or 1.0
    weighted_hit = sum(float(req_weights.get(k, 1.0)) for k in overlap)
    weighted_pct = round((weighted_hit / weighted_total) * 100.0, 1)
    primary_norm = normalize_skill_name(selected_primary_skill)
    missing_ranked = sorted(
        [k for k in req_keys if k not in normalized],
        key=lambda k: float(req_weights.get(k, 1.0)),
        reverse=True,
    )
    return {
        "selected_primary_skill": selected_primary_skill,
        "selected_job_title": selected_job_title,
        "selected_department": selected_department,
        "required_skill_count": len(req_keys),
        "required_skill_overlap": len(overlap),
        "required_skill_overlap_pct": round((len(overlap) / max(1, len(req_keys))) * 100.0, 1),
        "weighted_role_alignment_pct": weighted_pct,
        "primary_skill_in_cv": bool(primary_norm and primary_norm in normalized),
        "missing_priority_skills": missing_ranked[:10],
    }


def raw_cv_text_for_user(db: Session, user_id: uuid.UUID) -> str:
    """Line-preserving résumé text for deep parsing (PDF extract preferred)."""
    doc = (
        db.query(CvDocument)
        .filter(CvDocument.user_id == user_id)
        .order_by(CvDocument.created_at.desc())
        .first()
    )
    if doc and doc.stored_path:
        raw, _ = _extract_text_from_pdf(doc.stored_path)
        if raw.strip():
            return raw[:80000]
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).one_or_none()
    cv = (profile.cv_extract if profile and isinstance(profile.cv_extract, dict) else {}) or {}
    preview = str(cv.get("text_preview") or "").strip()
    return preview[:80000]


def cv_extract_for_user(
    db: Session,
    user: User,
    profile: EmployeeProfile | None,
    *,
    persist_upgrade: bool = True,
) -> dict:
    """Return stored deep extract, upgrading legacy uploads once when PDF is available."""
    cv = (profile.cv_extract if profile and isinstance(profile.cv_extract, dict) else {}) or {}
    pipeline = (cv.get("nlp") or {}).get("pipeline")
    if pipeline == "cv_deep_nlp_v4" and cv.get("skills_detail"):
        return cv
    raw = raw_cv_text_for_user(db, user.id)
    if len(raw.strip()) < 40:
        return cv
    upgraded = build_deep_cv_extract(raw)
    if cv.get("pdf"):
        upgraded["pdf"] = cv["pdf"]
    if persist_upgrade and profile is not None:
        profile.cv_extract = upgraded
        ai_profile = dict(profile.ai_profile or {})
        doc_conf = float((upgraded.get("nlp") or {}).get("document_confidence") or 0.0)
        skills = upgraded.get("skills") or []
        ai_profile["confidence"] = doc_conf if skills else ai_profile.get("confidence", 0.25)
        ai_profile["nlp_pipeline"] = (upgraded.get("nlp") or {}).get("pipeline") or "cv_deep_nlp_v4"
        profile.ai_profile = ai_profile
        db.add(profile)
        db.commit()
        sync_ai_cv_story(db, profile, user)
    return upgraded


def cv_text_for_user(db: Session, user_id: uuid.UUID) -> str:
    """Best available résumé text for ML matching (full extract, else PDF, else preview)."""
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user_id).one_or_none()
    cv = (profile.cv_extract if profile and isinstance(profile.cv_extract, dict) else {}) or {}
    stored_ml = str(cv.get("text_for_ml") or "").strip()
    if len(stored_ml) >= 400:
        return stored_ml[:80000]
    doc = (
        db.query(CvDocument)
        .filter(CvDocument.user_id == user_id)
        .order_by(CvDocument.created_at.desc())
        .first()
    )
    if doc and doc.stored_path:
        raw, _ = _extract_text_from_pdf(doc.stored_path)
        pdf_text = _normalize_text(raw)
        if len(pdf_text.strip()) >= 80:
            return pdf_text[:80000]
    preview = str(cv.get("text_preview") or "").strip()
    return preview[:80000]


def save_and_process_cv(
    db: Session,
    *,
    user: User,
    original_filename: str,
    pdf_bytes: bytes,
    upload_dir: str,
) -> CvDocument:
    os.makedirs(upload_dir, exist_ok=True)
    sha = _sha256_bytes(pdf_bytes)
    stored_name = f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex}.pdf"
    stored_path = os.path.join(upload_dir, stored_name)
    with open(stored_path, "wb") as f:
        f.write(pdf_bytes)

    raw_text, pdf_meta = _extract_text_from_pdf(stored_path)
    extract = build_deep_cv_extract(raw_text)
    extract["pdf"] = pdf_meta

    skills = extract.get("skills") or []
    skills_detail = extract.get("skills_detail") or []
    doc_conf = float((extract.get("nlp") or {}).get("document_confidence") or 0.0)

    doc = CvDocument(
        user_id=user.id,
        original_filename=original_filename,
        stored_path=stored_path,
        sha256=sha,
        extract=extract,
    )
    db.add(doc)

    # Upsert employee profile enrichment.
    profile = db.query(EmployeeProfile).filter(EmployeeProfile.user_id == user.id).one_or_none()
    if profile:
        profile.cv_extract = extract
        # AI profile enrichment (starter rules)
        ai_profile = dict(profile.ai_profile or {})
        role_context = _compute_context_alignment(
            extracted_skills=skills,
            selected_primary_skill=user.primary_skill,
            selected_job_title=user.job_title,
            selected_department=user.department,
        )
        pk = normalize_skill_name(user.primary_skill)
        ai_profile["suggested_skills"] = [s for s in skills if s and s != pk][:15]
        ai_profile["primary_skill_validated"] = role_context["primary_skill_in_cv"] if pk else False
        ai_profile["confidence"] = doc_conf if skills else (0.25 if raw_text.strip() else 0.15)
        ai_profile["nlp_pipeline"] = (extract.get("nlp") or {}).get("pipeline") or "cv_deep_nlp_v4"
        ai_profile["role_context_alignment"] = role_context
        ai_profile["profile_personalization_key"] = (
            f"{normalize_skill_name(user.primary_skill)}|{user.job_title.strip().lower()}|{user.department.strip().lower()}"
        )
        profile.ai_profile = ai_profile
        sync_ai_cv_story(db, profile, user)

    conf_by_skill = {
        str(row.get("skill")): float(row.get("confidence") or 0.7)
        for row in skills_detail
        if isinstance(row, dict) and row.get("skill")
    }

    # Persist skills into skill inventory (canonical naming).
    for s in skills:
        cn = normalize_skill_name(s)
        if not cn:
            continue
        skill = db.query(Skill).filter(Skill.name == cn).one_or_none()
        if not skill:
            skill = Skill(name=cn)
            db.add(skill)
            db.flush()
        link = db.query(UserSkill).filter(UserSkill.user_id == user.id, UserSkill.skill_id == skill.id).one_or_none()
        if not link:
            lvl = _level_from_nlp_confidence(conf_by_skill.get(cn, 0.7))
            db.add(UserSkill(user_id=user.id, skill_id=skill.id, level=lvl, source=SkillSource.cv))

    db.commit()
    db.refresh(doc)
    return doc
