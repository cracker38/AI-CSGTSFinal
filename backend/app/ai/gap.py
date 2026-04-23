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
    confidence_base: float = 0.6,
) -> list[GapItem]:
    items: list[GapItem] = []
    for skill, req_level in required.items():
        cur = int(current.get(skill, 0))
        gap = int(req_level) - cur
        sev = severity_from_gap(gap)
        conf = max(0.1, min(0.95, confidence_base - (0.05 * (1 if cur == 0 else 0))))
        explanation = (
            f"Required level {req_level} vs current level {cur} based on your validated skill inventory."
            if gap > 0
            else "Meets or exceeds the required level."
        )
        items.append(
            GapItem(
                skill=skill,
                required_level=int(req_level),
                current_level=cur,
                gap=gap,
                severity=sev,
                confidence=conf,
                explanation=explanation,
            )
        )
    # Prioritize highest business risk
    items.sort(key=lambda x: (x.gap, x.required_level), reverse=True)
    return items


def recommend_actions(gaps: list[GapItem]) -> list[dict]:
    recs: list[dict] = []
    for g in gaps:
        if g.gap <= 0:
            continue
        action = "training"
        if g.severity == "high":
            action = "training_or_hire"
        recs.append(
            {
                "skill": g.skill,
                "recommended_action": action,
                "priority": g.severity,
                "confidence": g.confidence,
                "why": g.explanation,
            }
        )
    return recs[:15]
