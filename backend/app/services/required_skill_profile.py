"""Single source for deterministic required-skill profiles and importance weights."""

from __future__ import annotations

from app.models.user import User
from app.services.skill_normalization import normalize_skill_name

# Importance tiers (weighted_gap impact = gap × weight for gap > 0).
_W_PRIMARY_DOMAIN = 1.85  # Role anchor — highest penalty when missing / low
_W_ROLE_STACK = 1.35  # Job-title-derived technical stack
_W_COMMUNICATION = 1.25
_W_BASELINE_PM = 1.0


def required_skill_levels_for(
    primary_skill: str | None,
    job_title: str | None,
    department: str | None = None,
) -> tuple[dict[str, int], dict[str, float]]:
    """Required skill targets + weights for an arbitrary role lens (e.g., career target vs. HR job title)."""
    levels: dict[str, int] = {}
    weights: dict[str, float] = {}

    ps = normalize_skill_name(primary_skill or "")
    if ps:
        levels[ps] = max(levels.get(ps, 0), 3)
        weights[ps] = max(weights.get(ps, 0), _W_PRIMARY_DOMAIN)

    levels["communication"] = max(levels.get("communication", 0), 2)
    weights["communication"] = max(weights.get("communication", 0), _W_COMMUNICATION)

    levels["project management"] = max(levels.get("project management", 0), 1)
    weights["project management"] = max(weights.get("project management", 0), _W_BASELINE_PM)

    jt = (job_title or "").lower()
    dept = (department or "").lower()
    extras: dict[str, int] = {}
    if "data" in jt or "analyst" in jt:
        extras.update({"python": 3, "sql": 3, "pandas": 2, "machine learning": 2})
    if "engineer" in jt or "developer" in jt:
        extras.update({"git": 2, "docker": 1, "sql": max(2, extras.get("sql", 0))})
    if "manager" in jt:
        extras.update({"agile": 2, "jira": 2})
    if "hr" in jt or "human resource" in jt:
        extras.update({"recruitment": 3, "people analytics": 2})

    # Department lens enriches role stack so employees with same title but
    # different departments receive different required profiles.
    if "engineering" in dept or "technology" in dept or "it" == dept:
        extras.update({"system design": max(2, extras.get("system design", 0)), "git": max(2, extras.get("git", 0))})
    if "data" in dept or "analytics" in dept:
        extras.update({"sql": max(3, extras.get("sql", 0)), "statistics": 2, "data visualization": 2})
    if "hr" in dept or "people" in dept:
        extras.update({"communication": max(3, extras.get("communication", 0)), "recruitment": max(2, extras.get("recruitment", 0))})
    if "finance" in dept:
        extras.update({"excel": 3, "financial analysis": 2, "risk management": 2})
    if "marketing" in dept:
        extras.update({"digital marketing": 3, "seo": 2, "content strategy": 2})

    for skill, lvl in extras.items():
        ck = normalize_skill_name(skill)
        if not ck:
            continue
        levels[ck] = max(levels.get(ck, 0), int(lvl))
        weights[ck] = max(weights.get(ck, 0), _W_ROLE_STACK)

    return levels, weights


def required_skill_profile_with_weights(user: User) -> tuple[dict[str, int], dict[str, float]]:
    """
    Canonical required levels + per-skill weights for weighted gap prioritization.

    Levels are ints 1–5-ish; starter rules documented in-code for MVP.
    Enterprise: replace with role/department/project profile tables.
    """
    return required_skill_levels_for(user.primary_skill, user.job_title, user.department)
