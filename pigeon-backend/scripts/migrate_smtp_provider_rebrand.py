"""One-off migration for the EmaReach -> Pigeon rebrand.

`smtp_provider` is a stored enum value, not just display text. The rebrand
changed the code literal from "emareach" to "pigeon", so any inbox saved before
the rename still carries the old value and would stop being recognised as a
platform-managed SendGrid sender.

Run once, after deploying the renamed code:

    python scripts/migrate_smtp_provider_rebrand.py          # report only
    python scripts/migrate_smtp_provider_rebrand.py --apply  # write changes
"""
import asyncio
import sys

from database import db

OLD_VALUE = "emareach"
NEW_VALUE = "pigeon"


async def main() -> None:
    apply = "--apply" in sys.argv

    stale = await db.inboxes.count_documents({"smtp_provider": OLD_VALUE})
    already = await db.inboxes.count_documents({"smtp_provider": NEW_VALUE})

    print(f"inboxes with smtp_provider={OLD_VALUE!r}: {stale}")
    print(f"inboxes with smtp_provider={NEW_VALUE!r}: {already}")

    if not stale:
        print("Nothing to migrate.")
        return

    if not apply:
        print("\nDry run — re-run with --apply to update these rows.")
        return

    result = await db.inboxes.update_many(
        {"smtp_provider": OLD_VALUE},
        {"$set": {"smtp_provider": NEW_VALUE}},
    )
    print(f"Updated {result.modified_count} inbox rows.")


if __name__ == "__main__":
    asyncio.run(main())
