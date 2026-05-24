"""
Deep résumé understanding: section-aware parsing, structured work history,
education, certifications, and professional summary — grounded in extracted text only.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.ai.cv_skill_nlp import (
    SkillMention,
    analyze_cv_structure,
    document_nlp_confidence,
    experience_section_range,
    extract_skill_mentions,
    mention_in_span,
    mentions_to_extract_dicts,
)
_PIPELINE = "cv_deep_nlp_v4"

_MONTHS = (
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
)

_SECTION_HEADERS: list[tuple[str, re.Pattern[str]]] = [
    (
        "summary",
        re.compile(
            r"(?im)^\s*("
            r"professional\s+summary|executive\s+summary|summary|profile|"
            r"about\s+me|career\s+objective|objective|personal\s+statement"
            r")\s*[:.\-–—]?\s*$"
        ),
    ),
    (
        "experience",
        re.compile(
            r"(?im)^\s*("
            r"experience|work\s+experience|employment|professional\s+experience|"
            r"career\s+history|work\s+history|relevant\s+experience|employment\s+history"
            r")\s*[:.\-–—]?\s*$"
        ),
    ),
    (
        "education",
        re.compile(
            r"(?im)^\s*(education|academic\s+background|academic\s+qualifications?)\s*[:.\-–—]?\s*$"
        ),
    ),
    (
        "skills",
        re.compile(
            r"(?im)^\s*("
            r"skills?|technical\s+skills?|core\s+competencies?|competencies?|"
            r"technologies?|tech\s+stack|tools?\s*(and|&)?\s*technologies?|expertise"
            r")\s*[:.\-–—]?\s*$"
        ),
    ),
    (
        "certifications",
        re.compile(
            r"(?im)^\s*("
            r"certifications?|certificates?|licenses?|licences?|professional\s+credentials?"
            r")\s*[:.\-–—]?\s*$"
        ),
    ),
    (
        "projects",
        re.compile(r"(?im)^\s*(projects?|key\s+projects?|selected\s+projects?)\s*[:.\-–—]?\s*$"),
    ),
    (
        "languages",
        re.compile(r"(?im)^\s*(languages?|language\s+skills?)\s*[:.\-–—]?\s*$"),
    ),
]

_DATE_RANGE = re.compile(
    r"(?i)"
    r"(?:"
    r"(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*)?"
    r"(\d{4})\s*[-–—~to]+\s*(?:present|current|now|ongoing|today)"
    r"|"
    r"(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*)?"
    r"(\d{4})\s*[-–—~to]+\s*"
    r"(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s*)?"
    r"(\d{4})"
    r"|"
    r"(\d{1,2})[/.-](\d{4})\s*[-–—~to]+\s*(?:(\d{1,2})[/.-])?(\d{4}|present|current|now)"
    r")"
)

_EXPLICIT_YEARS = re.compile(
    r"(?i)(\d{1,2})\+?\s+years?\s+(?:of\s+)?(?:professional\s+)?(?:experience|exp\.?)"
)

_DEGREE = re.compile(
    r"(?i)\b("
    r"b\.?\s*sc|bachelor(?:'s)?|b\.?\s*eng|b\.?\s*a|"
    r"m\.?\s*sc|master(?:'s)?|mba|m\.?\s*eng|"
    r"ph\.?\s*d|doctorate|doctoral|"
    r"associate|diploma|hnd|foundation\s+degree"
    r")\b"
)

_CERT_LINE = re.compile(
    r"(?i)\b("
    r"certified|certification|certificate|licensed|credential|"
    r"aws\s+certified|azure\s+certified|google\s+cloud|pmp|scrum\s+master|"
    r"cissp|comptia|coursera|udemy|linkedin\s+learning"
    r")\b"
)

_EMAIL = re.compile(r"(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b")
_PHONE = re.compile(r"(?i)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b")
_LINKEDIN = re.compile(r"(?i)(?:https?://)?(?:www\.)?linkedin\.com/in/[\w-]+")

_BULLET = re.compile(r"^\s*([•●▪\-–—*]|\d+\.)\s+(.+)$")


def _sanitize(text: str) -> str:
    if not text:
        return ""
    return (
        text.replace("\u00a0", " ")
        .replace("\u200b", "")
        .replace("\ufeff", "")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
    )


def _normalize_ml_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def split_cv_sections(text: str) -> dict[str, str]:
    """Map section keys to raw text blocks (line-preserving)."""
    text = _sanitize(text)
    if not text.strip():
        return {}

    hits: list[tuple[int, str, re.Match[str]]] = []
    for key, pattern in _SECTION_HEADERS:
        for m in pattern.finditer(text):
            hits.append((m.start(), key, m))
    if not hits:
        return {"body": text.strip()}

    hits.sort(key=lambda x: x[0])
    sections: dict[str, str] = {}
    for idx, (start, key, m) in enumerate(hits):
        block_start = m.end()
        block_end = hits[idx + 1][0] if idx + 1 < len(hits) else len(text)
        chunk = text[block_start:block_end].strip()
        if chunk:
            prev = sections.get(key, "")
            sections[key] = f"{prev}\n{chunk}".strip() if prev else chunk
    return sections


def _parse_year_from_token(token: str | None) -> int | None:
    if not token:
        return None
    t = str(token).strip().lower()
    if t in {"present", "current", "now", "ongoing", "today"}:
        return datetime.now(timezone.utc).year
    if re.fullmatch(r"\d{4}", t):
        y = int(t)
        return y if 1950 <= y <= datetime.now(timezone.utc).year + 1 else None
    return None


def _extract_date_range(line: str) -> tuple[str, int | None, int | None] | None:
    m = _DATE_RANGE.search(line)
    if not m:
        return None
    groups = m.groups()
    if groups[0] and not groups[1]:
        start = int(groups[0])
        end = datetime.now(timezone.utc).year
        return m.group(0).strip(), start, end
    if groups[1] and groups[2]:
        return m.group(0).strip(), int(groups[1]), int(groups[2])
    if groups[3] and groups[4]:
        start = int(groups[4])
        end_token = groups[6] or groups[5]
        end = _parse_year_from_token(end_token) or int(end_token) if str(end_token).isdigit() else None
        if end:
            return m.group(0).strip(), start, end
    return None


def _duration_months(start_year: int | None, end_year: int | None) -> int | None:
    if not start_year or not end_year or end_year < start_year:
        return None
    return max(1, (end_year - start_year + 1) * 12)


def _split_title_company(line: str) -> tuple[str, str]:
    raw = line.strip()
    if not raw:
        return "", ""
    for sep in (" at ", " @ ", " — ", " - ", " | ", ","):
        if sep.lower() in raw.lower():
            parts = re.split(re.escape(sep), raw, maxsplit=1, flags=re.I)
            if len(parts) == 2:
                left, right = parts[0].strip(), parts[1].strip()
                if left and right:
                    return left, right
    return raw, ""


def parse_experience_entries(experience_text: str) -> list[dict[str, Any]]:
    if not experience_text.strip():
        return []

    lines = [ln.rstrip() for ln in experience_text.splitlines()]
    entries: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal current
        if not current:
            return
        highlights = current.pop("_highlights", [])
        current["highlights"] = highlights[:8]
        if current.get("title") or current.get("company") or highlights:
            entries.append(current)
        current = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        date_hit = _extract_date_range(stripped)
        if date_hit:
            flush()
            dates_raw, start_y, end_y = date_hit
            remainder = _DATE_RANGE.sub("", stripped).strip(" ,-|")
            title, company = _split_title_company(remainder) if remainder else ("", "")
            current = {
                "title": title,
                "company": company,
                "dates": dates_raw,
                "start_year": start_y,
                "end_year": end_y,
                "duration_months": _duration_months(start_y, end_y),
                "_highlights": [],
                "skills": [],
            }
            continue

        if current is None:
            title, company = _split_title_company(stripped)
            current = {
                "title": title,
                "company": company,
                "dates": "",
                "start_year": None,
                "end_year": None,
                "duration_months": None,
                "_highlights": [],
                "skills": [],
            }
            continue

        bullet_m = _BULLET.match(stripped)
        if bullet_m:
            current["_highlights"].append(bullet_m.group(2).strip())
        elif not current.get("company") and current.get("title") and len(stripped) < 80 and not _DEGREE.search(stripped):
            current["company"] = stripped
        elif not current.get("title"):
            current["title"] = stripped
        else:
            current["_highlights"].append(stripped)

    flush()
    return entries[:20]


def parse_education_entries(education_text: str) -> list[dict[str, Any]]:
    if not education_text.strip():
        return []
    out: list[dict[str, Any]] = []
    for line in education_text.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) < 6:
            continue
        if not _DEGREE.search(stripped) and "university" not in stripped.lower() and "college" not in stripped.lower():
            continue
        year_m = re.search(r"\b(19|20)\d{2}\b", stripped)
        degree_m = _DEGREE.search(stripped)
        institution = stripped
        if degree_m:
            institution = stripped[degree_m.end() :].strip(" ,-|")
        out.append(
            {
                "raw_line": stripped,
                "degree": degree_m.group(0).strip() if degree_m else "",
                "institution": institution[:120] if institution else "",
                "year": int(year_m.group(0)) if year_m else None,
            }
        )
    return out[:12]


def parse_certification_entries(cert_text: str, full_text: str) -> list[dict[str, Any]]:
    sources = [cert_text] if cert_text.strip() else []
    if not sources:
        sources = [full_text]
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for block in sources:
        for line in block.splitlines():
            stripped = line.strip()
            if not stripped or len(stripped) < 8:
                continue
            if not _CERT_LINE.search(stripped):
                continue
            key = stripped.lower()[:80]
            if key in seen:
                continue
            seen.add(key)
            year_m = re.search(r"\b(19|20)\d{2}\b", stripped)
            out.append(
                {
                    "name": stripped[:160],
                    "year": int(year_m.group(0)) if year_m else None,
                    "raw_line": stripped,
                }
            )
    return out[:20]


def parse_profile_summary(summary_text: str, full_text: str) -> str:
    if summary_text.strip():
        lines = [ln.strip() for ln in summary_text.splitlines() if ln.strip()]
        return " ".join(lines)[:1200]
    top = _sanitize(full_text).splitlines()[:8]
    prose = [ln.strip() for ln in top if len(ln.strip()) > 40 and not _EMAIL.search(ln)]
    return " ".join(prose)[:800]


def parse_languages(language_text: str) -> list[str]:
    if not language_text.strip():
        return []
    langs: list[str] = []
    for line in language_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        parts = re.split(r"[,;|/]", stripped)
        for p in parts:
            token = p.strip()
            if 2 <= len(token) <= 40:
                langs.append(token)
    return langs[:10]


def parse_projects(projects_text: str) -> list[dict[str, Any]]:
    if not projects_text.strip():
        return []
    blocks = re.split(r"\n\s*\n", projects_text.strip())
    out: list[dict[str, Any]] = []
    for block in blocks[:12]:
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if not lines:
            continue
        highlights = []
        for ln in lines[1:]:
            bm = _BULLET.match(ln)
            highlights.append(bm.group(2).strip() if bm else ln)
        out.append({"name": lines[0][:120], "highlights": highlights[:6]})
    return out


def infer_total_experience_years(
    entries: list[dict[str, Any]],
    full_text: str,
) -> int | None:
    explicit = _EXPLICIT_YEARS.search(full_text.lower())
    if explicit:
        try:
            return int(explicit.group(1))
        except ValueError:
            pass

    spans: list[tuple[int, int]] = []
    for e in entries:
        sy, ey = e.get("start_year"), e.get("end_year")
        if isinstance(sy, int) and isinstance(ey, int) and ey >= sy:
            spans.append((sy, ey))
    if not spans:
        return None

    spans.sort()
    merged: list[tuple[int, int]] = []
    for start, end in spans:
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    total = sum(max(1, end - start + 1) for start, end in merged)
    return min(total, 45)


def _skills_in_text(text: str, mentions: list[SkillMention]) -> list[str]:
    if not text.strip():
        return []
    lowered = text.lower()
    found: list[str] = []
    for m in mentions:
        kw = m.keyword_matched.lower()
        if kw in lowered or m.canonical.replace("-", " ") in lowered:
            found.append(m.canonical)
    return sorted(set(found))


def _enrich_skills_detail(
    mentions: list[SkillMention],
    exp_span: tuple[int, int] | None,
    experience_entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    exp_text = " ".join(
        " ".join(
            filter(
                None,
                [
                    e.get("title") or "",
                    e.get("company") or "",
                    " ".join(e.get("highlights") or []),
                ],
            )
        )
        for e in experience_entries
    )
    detail = mentions_to_extract_dicts(mentions, exp_span=exp_span)
    for row in detail:
        skill = row.get("skill") or ""
        row["in_experience_section"] = bool(row.get("in_experience_section"))
        if exp_text and skill:
            row["mentioned_in_work_history"] = skill.replace("-", " ") in exp_text.lower() or skill in exp_text.lower()
        else:
            row["mentioned_in_work_history"] = row["in_experience_section"]
    return detail


def build_deep_cv_extract(raw_text: str) -> dict[str, Any]:
    """
    Full structured résumé extract from raw PDF text (line-preserving input preferred).
    """
    raw = _sanitize(raw_text)
    sections = split_cv_sections(raw)
    structure = analyze_cv_structure(raw)
    mentions = extract_skill_mentions(raw)
    exp_span = experience_section_range(raw)

    experience_entries = parse_experience_entries(sections.get("experience", ""))
    if not experience_entries and sections.get("body"):
        experience_entries = parse_experience_entries(sections.get("body", ""))

    education_entries = parse_education_entries(sections.get("education", ""))
    certification_entries = parse_certification_entries(
        sections.get("certifications", ""),
        raw,
    )
    profile_summary = parse_profile_summary(sections.get("summary", ""), raw)
    languages = parse_languages(sections.get("languages", ""))
    projects = parse_projects(sections.get("projects", ""))
    experience_years = infer_total_experience_years(experience_entries, raw)

    for entry in experience_entries:
        blob = " ".join(
            filter(
                None,
                [entry.get("title") or "", entry.get("company") or "", " ".join(entry.get("highlights") or [])],
            )
        )
        entry["skills"] = _skills_in_text(blob, mentions)

    skills = [m.canonical for m in mentions]
    skills_detail = _enrich_skills_detail(mentions, exp_span, experience_entries)
    doc_conf = document_nlp_confidence(mentions, len(raw))
    section_hits = any(m.get("in_skills_section") for m in skills_detail)
    exp_section_hits = any(m.get("in_experience_section") for m in skills_detail)

    contact: dict[str, str | None] = {
        "email": None,
        "phone": None,
        "linkedin": None,
    }
    head = raw[:2500]
    em = _EMAIL.search(head)
    if em:
        contact["email"] = em.group(0)
    ph = _PHONE.search(head)
    if ph and len(re.sub(r"\D", "", ph.group(0))) >= 9:
        contact["phone"] = ph.group(0).strip()
    li = _LINKEDIN.search(head)
    if li:
        contact["linkedin"] = li.group(0)

    legacy_education = [e.get("raw_line") or "" for e in education_entries if e.get("raw_line")]
    legacy_certs = [c.get("name") or c.get("raw_line") or "" for c in certification_entries]

    experience_timeline = [
        {
            "title": e.get("title") or "",
            "company": e.get("company") or "",
            "dates": e.get("dates") or "",
            "duration_months": e.get("duration_months"),
            "highlights": (e.get("highlights") or [])[:4],
            "skills": (e.get("skills") or [])[:8],
        }
        for e in experience_entries
    ]

    deep_intel = {
        "sections_detected": sorted(sections.keys()),
        "experience_entry_count": len(experience_entries),
        "education_entry_count": len(education_entries),
        "certification_entry_count": len(certification_entries),
        "project_entry_count": len(projects),
        "language_count": len(languages),
        "skills_in_experience_count": sum(1 for m in skills_detail if m.get("in_experience_section")),
        "skills_in_work_history_count": sum(1 for m in skills_detail if m.get("mentioned_in_work_history")),
        "profile_summary_present": bool(profile_summary.strip()),
        "latest_role": experience_entries[0].get("title") if experience_entries else None,
        "latest_company": experience_entries[0].get("company") if experience_entries else None,
        "experience_span_years": experience_years,
    }

    return {
        "skills": skills,
        "skills_detail": skills_detail,
        "nlp": {
            "pipeline": _PIPELINE,
            "document_confidence": doc_conf,
            "skills_section_detected": section_hits,
            "experience_section_detected": structure.get("experience_section_detected", False),
            "experience_skills_detected": exp_section_hits,
            "char_count": len(raw),
            "mention_count": len(mentions),
            "structure": structure,
        },
        "education": legacy_education,
        "education_entries": education_entries,
        "certifications": legacy_certs,
        "certification_entries": certification_entries,
        "experience": experience_timeline,
        "experience_entries": experience_entries,
        "experience_years": experience_years,
        "profile_summary": profile_summary,
        "languages": languages,
        "projects": projects,
        "contact_hints": contact,
        "sections": {k: v[:4000] for k, v in sections.items()},
        "deep_intel": deep_intel,
        "text_preview": _normalize_ml_text(raw)[:2000],
        "text_for_ml": _normalize_ml_text(raw)[:80000],
    }
