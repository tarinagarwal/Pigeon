"""
Bulk database cleanup utility.

Cleans:
1) Expired blocked contacts (retention from config)
2) Unused contacts (retention from config)
3) Error logs (all by default, or older than N days)

Usage:
  python scripts/bulk_cleanup_database.py                 # dry-run
  python scripts/bulk_cleanup_database.py apply           # execute cleanup
  python scripts/bulk_cleanup_database.py apply --error-logs-days 30
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

from database import admin_db, db
from services.blocked_contacts_cleanup_service import cleanup_expired_blocked_contacts


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bulk cleanup contacts and error logs.")
    parser.add_argument(
        "mode",
        nargs="?",
        default="dry-run",
        choices=["dry-run", "apply"],
        help="Use 'apply' to execute deletes. Default is dry-run.",
    )
    parser.add_argument(
        "--error-logs-days",
        type=int,
        default=None,
        help="Delete error logs older than this many days. If omitted, deletes all error logs.",
    )
    return parser.parse_args()


async def _preview_contacts_cleanup() -> dict[str, Any]:
    """
    Preview candidate counts for contact cleanup.
    Note: this is a coarse preview count.
    """
    now = datetime.now(timezone.utc)

    # Mirrors default config values (actual apply uses service logic/config).
    blocked_cutoff = now - timedelta(days=7)
    unused_cutoff = now - timedelta(days=60)

    blocked_candidates = await db.contacts.count_documents(
        {
            "status": "blocked",
            "$or": [
                {"updated_at": {"$lte": blocked_cutoff}},
                {"updated_at": {"$exists": False}, "created_at": {"$lte": blocked_cutoff}},
            ],
        }
    )
    unused_candidates = await db.contacts.count_documents(
        {
            "status": {"$ne": "blocked"},
            "$or": [
                {"updated_at": {"$lte": unused_cutoff}},
                {"updated_at": {"$exists": False}, "created_at": {"$lte": unused_cutoff}},
            ],
        }
    )
    return {
        "blocked_candidates": blocked_candidates,
        "unused_candidates": unused_candidates,
    }


async def _error_logs_query(error_logs_days: int | None) -> dict[str, Any]:
    if error_logs_days is None:
        return {}
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, int(error_logs_days)))
    return {"created_at": {"$lte": cutoff}}


async def main() -> None:
    args = _parse_args()
    apply_changes = args.mode == "apply"

    print(f"Starting bulk cleanup (mode={args.mode})")

    # Contacts cleanup
    if apply_changes:
        contacts_result = await cleanup_expired_blocked_contacts(db)
        print("Contacts cleanup applied:")
        print(contacts_result)
    else:
        preview = await _preview_contacts_cleanup()
        print("Contacts cleanup dry-run preview (candidate counts):")
        print(preview)

    # Error logs cleanup
    logs_query = await _error_logs_query(args.error_logs_days)
    logs_to_delete = await admin_db.error_logs.count_documents(logs_query)
    if apply_changes:
        logs_res = await admin_db.error_logs.delete_many(logs_query)
        print(
            f"Error logs cleanup applied: deleted={logs_res.deleted_count}, "
            f"filter={logs_query or 'ALL'}"
        )
    else:
        print(
            f"Error logs dry-run preview: would_delete={logs_to_delete}, "
            f"filter={logs_query or 'ALL'}"
        )

    print("Bulk cleanup finished.")


if __name__ == "__main__":
    asyncio.run(main())
