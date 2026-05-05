from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GapItem:
    skill: str
    required_level: int
    current_level: int
    gap: int
    severity: str
    confidence: float
    explanation: str
    importance_weight: float
    weighted_gap: float
    """gap × importance_weight (signed; negative if current exceeds required)."""

    weighted_gap_impact: float
    """max(0, gap) × importance_weight — use for org/HR prioritization."""


def severity_from_gap(gap: int) -> str:
    if gap <= 0:
        return "none"
    if gap == 1:
        return "low"
    if gap == 2:
        return "medium"
    return "high"


def compute_skill_gaps(
    *,
    current: dict[str, int],
    required: dict[str, int],
    importance_weights: dict[str, float] | None = None,
    confidence_base: float = 0.6,
) -> list[GapItem]:
    """
    Per-skill gap analysis. Missing current skills are treated as level 0.

    importance_weights: optional map (same keys as `required` canonical skills).
    Defaults to 1.0 when absent.
    """
    wmap = importance_weights or {}
    items: list[GapItem] = []
    for skill, req_level in required.items():
        cur = int(current.get(skill, 0))
        gap = int(req_level) - cur
        sev = severity_from_gap(gap)
        w = float(wmap.get(skill, 1.0))
        wg = float(gap) * w
        wgi = max(0.0, float(gap)) * w
        conf = max(0.1, min(0.95, confidence_base - (0.05 if cur == 0 else 0.0)))
        if cur == 0 and gap > 0:
            explain = (
                f"Required level {req_level} but skill is missing from validated inventory "
                f"(treated as level 0); importance weight {w:.2f}. "
                f"weighted impact {wgi:.2f}."
            )
        elif gap > 0:
            explain = (
                f"Required level {req_level} vs current {cur}; gap {gap}; "
                f"weight {w:.2f} → weighted gap {wg:.2f}."
            )
        else:
            explain = "Meets or exceeds the required level."

        items.append(
            GapItem(
                skill=skill,
                required_level=int(req_level),
                current_level=cur,
                gap=gap,
                severity=sev,
                confidence=conf,
                explanation=explain,
                importance_weight=w,
                weighted_gap=round(wg, 4),
                weighted_gap_impact=round(wgi, 4),
            )
        )
    items.sort(key=lambda x: (x.weighted_gap_impact, x.gap, x.required_level), reverse=True)
    return items


def recommend_actions(gaps: list[GapItem]) -> list[dict]:
    recs: list[dict] = []
    sorted_gaps = sorted(gaps, key=lambda g: (g.weighted_gap_impact, g.gap), reverse=True)
    for g in sorted_gaps:
        if g.gap <= 0:
            continue
        action = "training"
        if g.severity == "high" or g.weighted_gap_impact >= 4.0:
            action = "training_or_hire"
        recs.append(
            {
                "skill": g.skill,
                "recommended_action": action,
                "priority": g.severity,
                "confidence": g.confidence,
                "why": g.explanation,
                "importance_weight": g.importance_weight,
                "weighted_gap_impact": g.weighted_gap_impact,
            }
        )
    return recs[:15]


def gap_payload_from_items(gaps: list[GapItem]) -> list[dict]:
    """Serialize for JSON responses."""
    out: list[dict] = []
    for g in gaps:
        out.append(
            {
                "skill": g.skill,
                "required_level": g.required_level,
                "current_level": g.current_level,
                "gap": g.gap,
                "severity": g.severity,
                "confidence": g.confidence,
                "explanation": g.explanation,
                "importance_weight": g.importance_weight,
                "weighted_gap": g.weighted_gap,
                "weighted_gap_impact": g.weighted_gap_impact,
            }
        )
    return out
