"""Backfill: mark pre-existing RYN accounts as verified.

Signup verification was added after these accounts were created, so without this
they would all be locked out by the new login check. Run once, before deploying
the gate to users.

    python scripts/backfill_ryn_email_verified.py          # report only
    python scripts/backfill_ryn_email_verified.py --apply
"""
import asyncio
import sys

from database import db


async def main() -> None:
    apply = "--apply" in sys.argv
    q = {"$or": [{"email_verified": False}, {"email_verified": {"$exists": False}}]}
    n = await db.ryn_users.count_documents(q)
    total = await db.ryn_users.count_documents({})
    print(f"RYN accounts: {total} | unverified: {n}")
    if not n:
        print("Nothing to backfill.")
        return
    if not apply:
        print("\nDry run — re-run with --apply to mark these verified.")
        return
    res = await db.ryn_users.update_many(q, {"$set": {"email_verified": True}})
    print(f"Marked {res.modified_count} account(s) verified.")


if __name__ == "__main__":
    asyncio.run(main())
