"""Campaign send ramp-up: optional per-inbox caps on outreach volume by age (days since enable)."""
from datetime import datetime, timezone
from typing import Any, Optional


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            from dateutil import parser

            return parser.parse(value)
        except Exception:
            return None
    return None


# Tier fractions of the daily sending goal (same shape as 10/20/30/40 out of 50 in the product spec).
_RAMP_FRACTIONS = (0.2, 0.4, 0.6, 0.8)  # days 1–7, 8–14, 15–21, 22+


def ramp_cap_for_days_elapsed(days_since_start: int, daily_limit_goal: int) -> int:
    """Scale recommended caps by daily_limit_goal (e.g. goal 50 → 10/20/30/40; goal 25 → 5/10/15/20)."""
    if days_since_start < 0:
        days_since_start = 0
    goal = max(1, min(50, int(daily_limit_goal)))
    if days_since_start <= 6:
        frac = _RAMP_FRACTIONS[0]
    elif days_since_start <= 13:
        frac = _RAMP_FRACTIONS[1]
    elif days_since_start <= 20:
        frac = _RAMP_FRACTIONS[2]
    else:
        frac = _RAMP_FRACTIONS[3]
    cap = max(1, int(round(goal * frac)))
    return min(goal, cap)


def effective_campaign_daily_limit(inbox_doc: dict, now_utc: Optional[datetime] = None) -> int:
    """Campaign sends: min(daily_limit goal, ramp tier). Ramp tiers are fractions of that goal when campaign_rampup is on."""
    base = max(1, min(50, int(inbox_doc.get("daily_limit") or 50)))
    if not inbox_doc.get("campaign_rampup"):
        return base
    now = now_utc or datetime.now(timezone.utc)
    start = _parse_dt(inbox_doc.get("campaign_rampup_started_at")) or _parse_dt(inbox_doc.get("created_at"))
    if start is None:
        return base
    if getattr(start, "tzinfo", None) is None and hasattr(start, "replace"):
        start = start.replace(tzinfo=timezone.utc)
    try:
        days = max(0, (now - start).days)
    except Exception:
        days = 0
    ramp = ramp_cap_for_days_elapsed(days, base)
    return min(base, ramp)
