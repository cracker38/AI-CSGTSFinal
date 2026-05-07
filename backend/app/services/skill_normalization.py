"""Canonical skill names for consistent gap math and inventories (no duplicate variants)."""

from __future__ import annotations

import re

# Explicit aliases → canonical token (already lowercased, single-space).
_SKILL_ALIASES: dict[str, str] = {
    # ML / analytics
    "ml": "machine learning",
    "machine-learning": "machine learning",
    "deep learning": "deep learning",
    "dl": "deep learning",
    "nlp models": "nlp",
    "tensor flow": "tensorflow",
    "sci kit learn": "scikit-learn",
    # Web / languages
    "js": "javascript",
    "ts": "typescript",
    "node.js": "node",
    "nodejs": "node",
    "reactjs": "react",
    "react.js": "react",
    "vue.js": "vue",
    "vuejs": "vue",
    "angular.js": "angular",
    "angularjs": "angular",
    "go lang": "golang",
    "graphql api": "graphql",
    "restful api": "rest api",
    "rest apis": "rest api",
    # Data stores
    "postgres": "postgresql",
    "postgres sql": "postgresql",
    "psql": "postgresql",
    "mongo": "mongodb",
    "mongo db": "mongodb",
    # PM
    "pm": "project management",
    "proj. mgmt": "project management",
    "proj management": "project management",
    # DevOps
    "k8s": "kubernetes",
    "ci cd": "ci/cd",
    "cicd": "ci/cd",
    # Cloud
    "amazon web services": "aws",
    "ms azure": "azure",
    "google cloud": "gcp",
    "google cloud platform": "gcp",
    # BI
    "powerbi": "power bi",
    "power-bi": "power bi",
    # Search / streaming
    "elastic search": "elasticsearch",
    # NLP
    "natural language processing": "nlp",
    # Scrum
    "scrum master skills": "scrum",
}


def normalize_skill_name(name: str | None) -> str:
    """Normalize for lookup: lowercase, collapse whitespace; map known aliases."""
    if name is None:
        return ""
    s = re.sub(r"\s+", " ", str(name).strip().lower())
    if not s:
        return ""
    return _SKILL_ALIASES.get(s, s)


def normalize_skill_level_map(levels_by_name: dict[str, int]) -> dict[str, int]:
    """Merge duplicate synonyms by taking max level per canonical skill."""
    out: dict[str, int] = {}
    for raw_name, lvl in levels_by_name.items():
        key = normalize_skill_name(raw_name)
        if not key:
            continue
        out[key] = max(out.get(key, 0), int(lvl))
    return out


def explain_normalization(skill: str) -> str:
    """Short note for dashboards / transparency."""
    return f"Skill name normalized to `{skill}` for consistent gap comparisons across CV, catalogs, and job rules."
