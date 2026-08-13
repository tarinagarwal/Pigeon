"""
Cleanup stale email_logs immediately.

Stale email_log = no recent updates and older than retention days.
Timestamp precedence:
1) updated_at (if present)
2) sent_at (if updated_at missing)
3) created_at (if both updated_at/sent_at missing)

Usage:
  python scripts/cleanup_stale_email_logs.py                  # dry-run, default 60 days
  python scripts/cleanup_stale_email_logs.py apply            # apply deletion
  python scripts/cleanup_stale_email_logs.py --days 90        # dry-run with custom retention
  python scripts/cleanup_stale_email_logs.py apply --days 90  # apply with custom retention
"""

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Ensure project root (where `database.py` lives) is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from database import db


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Find and optionally delete stale email_logs."
    )
    parser.add_argument(
        "mode",
        nargs="?",
        default="dry-run",
        choices=["dry-run", "apply"],
        help="Use 'apply' to execute delete_many. Default is dry-run.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=60,
        help="Retention in days for stale email_logs (default: 60).",
    )
    return parser.parse_args()


def _build_stale_query(cutoff: datetime) -> dict[str, Any]:
    return {
        "$or": [
            {"updated_at": {"$lte": cutoff}},
            {"updated_at": {"$exists": False}, "sent_at": {"$lte": cutoff}},
            {
                "updated_at": {"$exists": False},
                "sent_at": {"$exists": False},
                "created_at": {"$lte": cutoff},
            },
        ]
    }


async def main() -> None:
    args = _parse_args()
    apply_changes = args.mode == "apply"
    retention_days = max(1, int(args.days))
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    query = _build_stale_query(cutoff)

    print(
        f"Starting stale email_logs cleanup (mode={args.mode}, retention_days={retention_days})"
    )
    total = await db.email_logs.count_documents({})
    candidates = await db.email_logs.count_documents(query)
    print(f"Total email_logs: {total}")
    print(f"Stale candidates: {candidates}")
    print(f"Cutoff (UTC): {cutoff.isoformat()}")

    if not apply_changes:
        print("Dry-run complete. No documents were deleted.")
        return

    if candidates == 0:
        print("Apply complete. No stale email_logs to delete.")
        return

    res = await db.email_logs.delete_many(query)
    print(f"Apply complete. Deleted stale email_logs: {res.deleted_count}")


if __name__ == "__main__":
    asyncio.run(main())
