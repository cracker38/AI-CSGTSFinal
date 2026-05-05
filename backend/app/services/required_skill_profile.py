"""Single source for deterministic required-skill profiles and importance weights."""

from __future__ import annotations

from app.models.user import User
from app.services.skill_normalization import normalize_skill_name

# Importance tiers (weighted_gap impact = gap × weight for gap > 0).
_W_PRIMARY_DOMAIN = 1.85  # Role anchor — highest penalty when missing / low
_W_ROLE_STACK = 1.35  # Job-title-derived technical stack
_W_COMMUNICATION = 1.25
_W_BASELINE_PM = 1.0


def required_skill_profile_with_weights(user: User) -> tuple[dict[str, int], dict[str, float]]:
    """
    Canonical required levels + per-skill weights for weighted gap prioritization.

    Levels are ints 1–5-ish; starter rules documented in-code for MVP.
    Enterprise: replace with role/department/project profile tables.
    """
    levels: dict[str, int] = {}
    weights: dict[str, float] = {}

    ps = normalize_skill_name(user.primary_skill or "")
    if ps:
        levels[ps] = max(levels.get(ps, 0), 3)
        weights[ps] = max(weights.get(ps, 0), _W_PRIMARY_DOMAIN)

    levels["communication"] = max(levels.get("communication", 0), 2)
    weights["communication"] = max(weights.get("communication", 0), _W_COMMUNICATION)

    levels["project management"] = max(levels.get("project management", 0), 1)
    weights["project management"] = max(weights.get("project management", 0), _W_BASELINE_PM)

    jt = (user.job_title or "").lower()
    extras: dict[str, int] = {}
    if "data" in jt or "analyst" in jt:
        extras.update({"python": 3, "sql": 3, "pandas": 2, "machine learning": 2})
    if "engineer" in jt or "developer" in jt:
        extras.update({"git": 2, "docker": 1, "sql": max(2, extras.get("sql", 0))})
    if "manager" in jt:
        extras.update({"agile": 2, "jira": 2})

    for skill, lvl in extras.items():
        ck = normalize_skill_name(skill)
        if not ck:
            continue
        levels[ck] = max(levels.get(ck, 0), int(lvl))
        # Do not downgrade primary/domain weight if this skill is also primary
        weights[ck] = max(weights.get(ck, 0), _ROLE_STACK)

    return levels, weights
