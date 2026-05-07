from __future__ import annotations

from app.ai.sklearn_signals import blended_alignment_pct, cv_role_semantic_similarity


def test_cv_role_semantic_similarity_positive_on_matching_text() -> None:
    cv = """
    Jane Doe · Data Scientist
    Experienced with python, pandas, machine learning pipelines, sql, and scikit-learn
    model evaluation in agile teams.
    """
    required = {"python": 3, "sql": 3, "machine learning": 3, "pandas": 2, "scikit-learn": 2}
    sim = cv_role_semantic_similarity(cv, required)
    assert sim is not None
    assert sim > 0.15


def test_cv_role_semantic_similarity_none_on_short_text() -> None:
    assert cv_role_semantic_similarity("short", {"python": 3}) is None


def test_blended_alignment_percent_falls_back_without_semantic() -> None:
    assert blended_alignment_pct(72.0, None, semantic_weight=0.45) == 72.0


def test_blended_alignment_percent_uses_semantic() -> None:
    out = blended_alignment_pct(40.0, 0.8, semantic_weight=0.5)
    assert out == 60.0
