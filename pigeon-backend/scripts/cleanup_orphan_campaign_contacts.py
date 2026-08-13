"""
Cleanup orphan campaign_contacts.

An orphan campaign_contact is a row whose `campaign_id` either:
- does not exist in the `campaigns` collection, or
- is missing / null.

Usage:
  python scripts/cleanup_orphan_campaign_contacts.py           # dry-run (default)
  python scripts/cleanup_orphan_campaign_contacts.py dry-run   # dry-run
  python scripts/cleanup_orphan_campaign_contacts.py apply     # delete orphans
"""

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

# Ensure project root (where `database.py` lives) is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from database import db


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Find and optionally delete orphan campaign_contacts."
    )
    parser.add_argument(
        "mode",
        nargs="?",
        default="dry-run",
        choices=["dry-run", "apply"],
        help="Use 'apply' to execute delete_many. Default is dry-run.",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=20,
        help="How many orphan campaign_id values to print as a sample.",
    )
    return parser.parse_args()


def _build_orphan_query(orphan_campaign_ids: list[str]) -> dict[str, Any]:
    clauses: list[dict[str, Any]] = [
        {"campaign_id": {"$exists": False}},
        {"campaign_id": None},
    ]
    if orphan_campaign_ids:
        clauses.append({"campaign_id": {"$in": orphan_campaign_ids}})
    return {"$or": clauses}


async def main() -> None:
    args = _parse_args()
    apply_changes = args.mode == "apply"
    sample_size = max(0, int(args.sample_size))

    print(f"Starting orphan campaign_contacts cleanup (mode={args.mode})")

    existing_campaign_ids = set(await db.campaigns.distinct("id"))
    campaign_ids_in_contacts_raw = await db.campaign_contacts.distinct("campaign_id")
    campaign_ids_in_contacts = [
        cid for cid in campaign_ids_in_contacts_raw if isinstance(cid, str) and cid
    ]

    orphan_campaign_ids = sorted(
        cid for cid in campaign_ids_in_contacts if cid not in existing_campaign_ids
    )
    orphan_query = _build_orphan_query(orphan_campaign_ids)

    total_campaign_contacts = await db.campaign_contacts.count_documents({})
    orphan_campaign_contacts = await db.campaign_contacts.count_documents(orphan_query)

    print(f"Total campaign_contacts: {total_campaign_contacts}")
    print(f"Total campaigns: {len(existing_campaign_ids)}")
    print(f"Distinct campaign_id values in campaign_contacts: {len(campaign_ids_in_contacts_raw)}")
    print(f"Orphan campaign_id values (missing in campaigns): {len(orphan_campaign_ids)}")
    print(f"Orphan campaign_contacts rows: {orphan_campaign_contacts}")

    if sample_size > 0:
        print(f"Sample orphan campaign_id values (up to {sample_size}):")
        for cid in orphan_campaign_ids[:sample_size]:
            print(f"- {cid}")

    if not apply_changes:
        print("Dry-run complete. No documents were deleted.")
        return

    if orphan_campaign_contacts == 0:
        print("Apply complete. No orphan campaign_contacts found.")
        return

    delete_res = await db.campaign_contacts.delete_many(orphan_query)
    print(f"Apply complete. Deleted orphan campaign_contacts: {delete_res.deleted_count}")


if __name__ == "__main__":
    asyncio.run(main())
