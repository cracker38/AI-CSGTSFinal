"""
Classical ML signals (already in dependencies): TF–IDF + cosine similarity
between résumé text and a synthesized target-role vocabulary document.

Uses scikit-learn only — no pretrained deep models, no hallucinated outputs.
Gracefully returns None when text is unusable or sklearn fails.
"""

from __future__ import annotations

from collections.abc import Mapping

_HAVE_SKLEARN = True
try:  # pragma: no branch cover for import-only
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
except ImportError:  # pragma: no cover
    _HAVE_SKLEARN = False


def _role_boilerplate(required_skills_with_levels: Mapping[str, int]) -> str:
    """Expand required skills into a pseudo-document proportional to urgency."""
    parts: list[str] = []
    for skill, lvl in required_skills_with_levels.items():
        s = str(skill or "").strip()
        if not s:
            continue
        times = max(1, min(int(lvl), 4))
        parts.extend([s] * times)
    return " ".join(parts)


def cv_role_semantic_similarity(cv_text: str | None, required_skills_with_levels: Mapping[str, int] | None) -> float | None:
    """
    Cosine similarity in TF–IDF space between CV text and a role profile string.

    Returns a float in approx [0, 1], or None if unavailable / inconclusive.
    """
    if not _HAVE_SKLEARN:
        return None
    if not cv_text or not isinstance(cv_text, str) or len(cv_text.strip()) < 24:
        return None
    if not required_skills_with_levels:
        return None

    role_doc = _role_boilerplate(required_skills_with_levels)
    if len(role_doc.strip()) < 8:
        return None

    doc_cv = cv_text.strip()[:80_000]
    try:
        vectorizer = TfidfVectorizer(
            lowercase=True,
            strip_accents="unicode",
            ngram_range=(1, 2),
            max_features=2048,
            min_df=1,
            token_pattern=r"(?u)\b[a-zA-Z#+][a-zA-Z0-9#/+.\-_%]*\b",
        )
        matrix = vectorizer.fit_transform([doc_cv, role_doc])
        if matrix.shape[0] != 2 or matrix.shape[1] == 0:
            return None
        raw = cosine_similarity(matrix[0:1], matrix[1:2])[0, 0]
        if raw != raw or raw < -1e-9:  # NaN guard
            return None
        return round(float(max(0.0, min(1.0, raw))), 4)
    except Exception:
        return None


def blended_alignment_pct(gap_math_score_pct: float, semantic_cosine: float | None, *, semantic_weight: float = 0.45) -> float:
    """Blend deterministic gap-derived score [0–100] with semantic cosine similarity [0–1]."""
    g = float(gap_math_score_pct)
    if semantic_cosine is None:
        return round(max(0.0, min(100.0, g)), 1)
    sw = float(semantic_weight)
    sw = max(0.0, min(1.0, sw))
    sem_pct = semantic_cosine * 100.0
    blended = (1.0 - sw) * g + sw * sem_pct
    return round(max(0.0, min(100.0, blended)), 1)
