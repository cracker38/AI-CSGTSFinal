from __future__ import annotations

from app.ai.cv_skill_nlp import extract_skill_mentions


def test_extract_skill_mentions_finds_ml_stack() -> None:
    text = """
    Skills: Python, Pandas, machine learning, SQL, Docker.\n
    Also comfortable with Scrum and Agile delivery.
    """
    ms = extract_skill_mentions(text)
    canon = {m.canonical for m in ms}
    assert "python" in canon
    assert "pandas" in canon
    assert "machine learning" in canon
    assert "sql" in canon
    assert "docker" in canon


def test_unicode_normalization_does_not_break_matches() -> None:
    nbsp_skills = "Technical\u00a0skills: React, TypeScript,\u200b Node"
    ms = extract_skill_mentions(nbsp_skills)
    canon = {m.canonical for m in ms}
    assert "react" in canon
    assert "typescript" in canon
    assert "node" in canon
