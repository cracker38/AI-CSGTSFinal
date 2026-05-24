"""HR compliance: suggested and assigned certification requirements from CV + role profile."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.models.employee_profile import EmployeeProfile
from app.models.user import User
from app.services.required_skill_profile import required_skill_profile_with_weights
from app.services.skill_normalization import normalize_skill_name


def _cv_cert_labels(profile: EmployeeProfile | None) -> set[str]:
    if not profile:
        return set()
    raw = (profile.cv_extract or {}).get("certifications") or []
    return {str(c).strip().lower() for c in raw if str(c).strip()}


def suggest_required_certifications(db: Session, user: User, profile: EmployeeProfile | None) -> list[dict]:
    """Suggest certifications HR may require, derived from CV, role, department, and skill gaps."""
    cv_certs = _cv_cert_labels(profile)
    ai = (profile.ai_profile if profile and isinstance(profile.ai_profile, dict) else {}) or {}
    role_ctx = ai.get("role_context_alignment") if isinstance(ai.get("role_context_alignment"), dict) else {}
    missing_skills = list(role_ctx.get("missing_priority_skills") or [])

    if profile:
        required, _ = required_skill_profile_with_weights(user)
        cv_skills = {
            normalize_skill_name(str(s))
            for s in (profile.cv_extract or {}).get("skills") or []
            if normalize_skill_name(str(s))
        }
        for skill in required:
            if skill not in cv_skills and skill not in missing_skills:
                missing_skills.append(skill)

    jt = (user.job_title or "").lower()
    dept = (user.department or "").lower()
    ps = normalize_skill_name(user.primary_skill) or (user.primary_skill or "").lower()
    exp = (user.experience_level or "").lower()

    rules: list[tuple[str, str, str]] = [
        ("aws" in ps or "cloud" in jt or "devops" in jt, "AWS Certified Cloud Practitioner", "Cloud / DevOps role or primary skill"),
        ("azure" in ps or "azure" in jt, "Microsoft Azure Fundamentals (AZ-900)", "Azure-aligned role profile"),
        ("security" in jt or "security" in ps, "CompTIA Security+", "Security-focused job title or primary skill"),
        ("data" in jt or "analyst" in jt, "Google Data Analytics Professional Certificate", "Data analyst job title"),
        ("project" in jt or "manager" in jt, "Google Project Management Professional Certificate", "Project management job title"),
        ("python" in ps or "developer" in jt or "software" in jt, "Python Institute PCAP Certification", "Developer profile with Python primary skill"),
        ("java" in ps, "Oracle Certified Professional: Java SE Developer", "Java primary skill on HR record"),
        ("network" in jt or "network" in ps, "Cisco CCNA", "Networking role indicators"),
        (dept == "it" and exp in {"junior", "entry", "beginner"}, "CompTIA A+", "IT department entry-level experience band"),
    ]

    out: list[dict] = []
    seen: set[str] = set()
    for match, cert_name, reason in rules:
        if not match:
            continue
        key = cert_name.lower()
        if key in seen or key in cv_certs:
            continue
        seen.add(key)
        out.append({"name": cert_name, "reason": reason, "source": "role_cv_rules"})

    for skill in missing_skills[:5]:
        label = skill.replace("-", " ").title()
        cert_name = f"{label} Professional Certificate"
        key = cert_name.lower()
        if key in seen or key in cv_certs:
            continue
        seen.add(key)
        out.append(
            {
                "name": cert_name,
                "reason": f"Priority skill gap for {user.job_title or 'role'} ({skill})",
                "source": "skill_gap_profile",
            }
        )

    return out[:10]


def active_hr_required_certifications(profile: EmployeeProfile | None) -> list[dict]:
    if not profile:
        return []
    ai = profile.ai_profile if isinstance(profile.ai_profile, dict) else {}
    rows = list(ai.get("hr_required_certifications") or [])
    return [r for r in rows if isinstance(r, dict) and r.get("status", "pending") != "fulfilled"]


def assign_hr_required_certification(
    profile: EmployeeProfile,
    *,
    required_certification: str,
    due_date: date | None,
    note: str | None,
    assigned_by: uuid.UUID,
) -> dict:
    ai = dict(profile.ai_profile or {})
    rows = list(ai.get("hr_required_certifications") or [])
    entry = {
        "id": str(uuid.uuid4()),
        "required_certification": required_certification.strip()[:500],
        "due_date": due_date.isoformat() if due_date else None,
        "note": (note or "").strip()[:2000] or None,
        "assigned_at": datetime.now(timezone.utc).isoformat(),
        "assigned_by": str(assigned_by),
        "status": "pending",
    }
    rows.append(entry)
    ai["hr_required_certifications"] = rows[-50:]
    profile.ai_profile = ai
    return entry
