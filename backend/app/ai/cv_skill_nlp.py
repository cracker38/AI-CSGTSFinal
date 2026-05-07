"""
Professional CV skill extraction: boundary-aware matching, section awareness,
and calibrated confidence — without hallucinating skills outside the taxonomy.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.ai.skill_taxonomy import SKILL_KEYWORDS
from app.services.skill_normalization import normalize_skill_name

# Section headers that often precede skill lists (case-insensitive).
_SKILLS_SECTION_HEADERS = re.compile(
    r"(?im)^\s*("
    r"skills?|technical\s+skills?|core\s+competencies?|competencies?|"
    r"technologies?|tech\s+stack|tools?\s*(and|&)?\s*technologies?|"
    r"expertise|qualifications?|profile\s+highlights?"
    r")\s*[:.\-–—]?\s*$"
)

# Soft limit: window after a header where matches get a confidence boost.
_SECTION_WINDOW_CHARS = 4500


def _phrase_pattern(keyword: str) -> re.Pattern[str]:
    """Whole-phrase / token-safe patterns; avoids matching substrings inside unrelated words."""
    k = keyword.strip().lower()
    if k == "ci/cd":
        return re.compile(r"(?i)\bci\s*/\s*cd\b")
    if k == "scikit-learn":
        return re.compile(r"(?i)scikit\s*[- ]\s*learn\b")
    if " " in k:
        parts = r"\s+".join(re.escape(w) for w in k.split())
        return re.compile(rf"(?i)(?<![\w/+-]){parts}(?![\w/+-])")
    # Single token; hyphenated tokens (e.g. devops) use word-ish boundaries
    return re.compile(rf"(?i)(?<![\w/+-]){re.escape(k)}(?![\w/+-])")


def _skills_section_range(text: str) -> tuple[int, int] | None:
    """Return [start, end) character span most likely containing the skills block."""
    m = _SKILLS_SECTION_HEADERS.search(text)
    if not m:
        return None
    start = m.start()
    end = min(len(text), start + _SECTION_WINDOW_CHARS)
    return (start, end)


def _overlaps(existing: list[tuple[int, int]], a: int, b: int) -> bool:
    for x, y in existing:
        if a < y and b > x:
            return True
    return False


@dataclass(frozen=True)
class SkillMention:
    canonical: str
    confidence: float
    keyword_matched: str
    span_start: int
    span_end: int
    in_skills_section: bool


def _sanitize_extract_input(text: str) -> str:
    """Normalize invisible unicode / odd spaces so NLP hits stay stable."""
    if not text:
        return ""
    t = (
        text.replace("\u00a0", " ")
        .replace("\u200b", "")
        .replace("\ufeff", "")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )
    return t


def extract_skill_mentions(text: str) -> list[SkillMention]:
    """
    Find taxonomy-backed skills with regex boundaries and section-aware confidence.
    Longer keywords are tried first so multi-word phrases win over shared substrings.
    """
    text = _sanitize_extract_input(text)
    if not text or len(text.strip()) < 12:
        return []

    section = _skills_section_range(text)
    ordered = sorted(SKILL_KEYWORDS, key=lambda x: (len(x), x), reverse=True)
    claimed: list[tuple[int, int]] = []
    mentions: list[SkillMention] = []

    for kw in ordered:
        pat = _phrase_pattern(kw)
        for m in pat.finditer(text):
            a, b = m.span()
            if _overlaps(claimed, a, b):
                continue
            raw = m.group(0).strip()
            canon = normalize_skill_name(raw) or normalize_skill_name(kw)
            if not canon:
                continue
            in_sec = bool(section and section[0] <= a < section[1])
            base = 0.52
            if in_sec:
                base += 0.28
            if len(kw) >= 12:
                base += 0.06
            elif len(kw) >= 6:
                base += 0.04
            conf = min(0.96, base)
            mentions.append(
                SkillMention(
                    canonical=canon,
                    confidence=round(conf, 3),
                    keyword_matched=kw,
                    span_start=a,
                    span_end=b,
                    in_skills_section=in_sec,
                )
            )
            claimed.append((a, b))

    # Merge duplicate canonicals: keep highest confidence, merge section flag
    best: dict[str, SkillMention] = {}
    for sm in mentions:
        prev = best.get(sm.canonical)
        if prev is None or sm.confidence > prev.confidence:
            best[sm.canonical] = sm
        elif prev and sm.confidence == prev.confidence and sm.in_skills_section and not prev.in_skills_section:
            best[sm.canonical] = sm

    return sorted(best.values(), key=lambda x: (-x.confidence, x.canonical))


def extract_skills_canonical_list(text: str) -> list[str]:
    return [m.canonical for m in extract_skill_mentions(text)]


def document_nlp_confidence(mentions: list[SkillMention], text_len: int) -> float:
    """Overall extraction reliability 0–1 (not per-skill taxonomy truth)."""
    if not mentions:
        return 0.18 if text_len > 80 else 0.12
    avg = sum(m.confidence for m in mentions) / len(mentions)
    # Reward readable length; penalize very short OCR-like snippets
    length_factor = min(1.0, max(0.35, text_len / 2500))
    return round(min(0.94, 0.25 + avg * 0.55 * length_factor), 3)


def mentions_to_extract_dicts(mentions: list[SkillMention]) -> list[dict]:
    return [
        {
            "skill": m.canonical,
            "confidence": m.confidence,
            "keyword_matched": m.keyword_matched,
            "in_skills_section": m.in_skills_section,
        }
        for m in mentions
    ]
