"""Rwanda Franc — platform-wide currency for budgets and training costs."""

from __future__ import annotations

CURRENCY_CODE = "FRW"


def format_frw(amount: int | float | None) -> str:
    if amount is None:
        return "—"
    try:
        n = int(round(float(amount)))
    except (TypeError, ValueError):
        return "—"
    return f"{CURRENCY_CODE} {n:,}"
