"""
Normalize contact emails in the MongoDB `contacts` collection.

- If `email` contains multiple addresses (comma/semicolon/space separated),
  split them and:
  * keep the first email on the original contact
  * create additional contacts (same fields, new ids) for the other emails
- If no valid email is found, the contact is left as-is.
- Avoids creating duplicates for the same user/email.
- Adds any new contacts to all lists that referenced the original contact.
"""

import asyncio
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

# Ensure project root (where `database.py` lives) is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from database import db  # uses MONGO_URL + DB_NAME from existing env


EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def extract_valid_emails(raw: str) -> List[str]:
    """
    Extract all valid email addresses from a raw string.

    - Split by commas/semicolons
    - Then split segments by whitespace
    - Keep unique values matching EMAIL_REGEX
    """
    if not raw:
        return []

    emails: set[str] = set()
    for segment in re.split(r"[;,]", str(raw)):
        segment = segment.strip()
        if not segment:
            continue
        for token in segment.split():
            token = token.strip()
            if token and EMAIL_REGEX.match(token):
                emails.add(token)

    return list(emails)


async def normalize_contacts(user_id: Optional[str] = None, dry_run: bool = True) -> None:
    """
    Run normalization for all contacts (or for a single user if user_id is provided).
    """
    query = {} if user_id is None else {"user_id": user_id}
    cursor = db.contacts.find(query)

    processed = 0
    updated_primary = 0
    new_contacts = 0
    no_change = 0

    async for contact in cursor:
        processed += 1
        raw_email = (contact.get("email") or "").strip()
        if not raw_email:
            no_change += 1
            continue

        emails = extract_valid_emails(raw_email)
        if not emails:
            # invalid / unparsable email, leave as-is
            no_change += 1
            continue

        if len(emails) == 1:
            primary = emails[0]
            if primary != raw_email:
                if not dry_run:
                    await db.contacts.update_one(
                        {"_id": contact["_id"]},
                        {"$set": {"email": primary}},
                    )
                updated_primary += 1
            else:
                no_change += 1
            continue

        # Multiple emails in this contact
        primary = emails[0]
        others = emails[1:]

        # 1) Update original contact to first email only
        if primary != raw_email:
            if not dry_run:
                await db.contacts.update_one(
                    {"_id": contact["_id"]},
                    {"$set": {"email": primary}},
                )
            updated_primary += 1

        # 2) Find all lists that currently reference this contact
        contact_id = contact.get("id")
        lists = await db.contact_lists.find(
            {"contact_ids": contact_id},
            {"_id": 0, "id": 1},
        ).to_list(None)
        list_ids = [lst["id"] for lst in lists]

        # 3) Create/reuse contacts for the remaining emails
        for email in others:
            email_norm = email.strip().lower()
            if not email_norm:
                continue

            existing = await db.contacts.find_one(
                {
                    "user_id": contact["user_id"],
                    "email": {"$regex": f"^{re.escape(email)}$", "$options": "i"},
                },
                {"_id": 0, "id": 1},
            )
            if existing:
                new_contact_id = existing["id"]
            else:
                # clone base contact
                new_doc = dict(contact)
                new_doc.pop("_id", None)
                new_doc["id"] = str(uuid.uuid4())
                new_doc["email"] = email
                new_doc["created_at"] = datetime.now(timezone.utc)
                new_doc["updated_at"] = datetime.now(timezone.utc)
                if not dry_run:
                    await db.contacts.insert_one(new_doc)
                new_contacts += 1
                new_contact_id = new_doc["id"]

            # Add new contact to any lists containing the original
            for lid in list_ids:
                if not dry_run:
                    await db.contact_lists.update_one(
                        {"id": lid},
                        {"$addToSet": {"contact_ids": new_contact_id}},
                    )

    mode = "DRY-RUN" if dry_run else "APPLY"
    print(
        f"[{mode}] Done. processed={processed}, "
        f"updated_primary={updated_primary}, new_contacts={new_contacts}, "
        f"unchanged={no_change}"
    )


async def main() -> None:
    """
    Usage:
      python normalize_contacts_emails.py            # dry-run for all users
      python normalize_contacts_emails.py apply      # apply for all users
      python normalize_contacts_emails.py user <ID>  # dry-run for a single user
      python normalize_contacts_emails.py apply <ID> # apply for a single user
    """
    args = sys.argv[1:]

    apply_changes = False
    user_id: Optional[str] = None

    if args:
        if args[0].lower() in {"apply", "run"}:
            apply_changes = True
            if len(args) > 1:
                user_id = args[1]
        else:
            # First arg is treated as user_id in dry-run mode
            user_id = args[0]

    print(
        f"Starting normalize_contacts_emails "
        f"(dry_run={not apply_changes}, user_id={user_id or 'ALL'})"
    )
    await normalize_contacts(user_id=user_id, dry_run=not apply_changes)


if __name__ == "__main__":
    asyncio.run(main())