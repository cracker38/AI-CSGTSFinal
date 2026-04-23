from __future__ import annotations

import hashlib
import os
import re
import uuid
from datetime import datetime, timezone

from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.ai.skill_taxonomy import SKILL_KEYWORDS
from app.models.cv_document import CvDocument
from app.models.employee_profile import EmployeeProfile
from app.models.skill import Skill
from app.models.user import User
from app.models.user_skill import SkillSource, UserSkill


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _extract_text_from_pdf(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _extract_skills(text: str) -> list[str]:
    t = text.lower()
    found = []
    for kw in SKILL_KEYWORDS:
        if kw in t:
            found.append(kw)
    return sorted(set(found))


def _extract_education(text: str) -> list[str]:
    # Heuristic: capture lines containing degree keywords.
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    degree_words = ("bsc", "msc", "phd", "bachelor", "master", "degree", "university", "college")
    edu = [l for l in lines if any(w in l.lower() for w in degree_words)]
    return edu[:10]


def _extract_certifications(text: str) -> list[str]:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    cert_words = ("certified", "certification", "certificate", "coursera", "udemy", "aws", "azure", "google")
    certs = [l for l in lines if any(w in l.lower() for w in cert_words)]
    return certs[:15]


def _extract_experience_years(text: str) -> int | None:
    m = re.search(r"(\d{1,2})\+?\s+years? of experience", text.lower())
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


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

    raw_text = _extract_text_from_pdf(stored_path)
    skills = _extract_skills(raw_text)
    education = _extract_education(raw_text)
    certifications = _extract_certifications(raw_text)
    years_exp = _extract_experience_years(raw_text)

    extract = {
        "skills": skills,
        "education": education,
        "certifications": certifications,
        "experience_years": years_exp,
        "text_preview": _normalize_text(raw_text)[:2000],
    }

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
        ai_profile["suggested_skills"] = [s for s in skills if s != user.primary_skill.lower()][:15]
        ai_profile["primary_skill_validated"] = user.primary_skill.lower() in skills
        ai_profile["confidence"] = 0.6 if skills else 0.2
        profile.ai_profile = ai_profile

    # Persist skills into skill inventory.
    for s in skills:
        skill = db.query(Skill).filter(Skill.name == s).one_or_none()
        if not skill:
            skill = Skill(name=s)
            db.add(skill)
            db.flush()
        link = db.query(UserSkill).filter(UserSkill.user_id == user.id, UserSkill.skill_id == skill.id).one_or_none()
        if not link:
            db.add(UserSkill(user_id=user.id, skill_id=skill.id, level=2, source=SkillSource.cv))

    db.commit()
    db.refresh(doc)
    return doc
