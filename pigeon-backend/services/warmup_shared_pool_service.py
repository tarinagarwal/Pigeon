"""Helpers for the shared personal-network warmup pool."""
from __future__ import annotations

import math
from typing import Any, Iterable


MIN_SHARED_POOL_CONTACTS = 15
SHARED_POOL_CREDITS_PER_SEND = 1
SHARED_POOL_GMAIL_SHARE = 0.80
SHARED_POOL_OUTLOOK_SHARE = 0.20

GMAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
}

OUTLOOK_DOMAINS = {
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "outlook.in",
    "outlook.co.uk",
    "hotmail.co.uk",
    "live.co.uk",
}


def classify_contact_provider(email: str | None) -> str:
    value = (email or "").strip().lower()
    if "@" not in value:
        return "other"
    host = value.split("@", 1)[1]
    if host in GMAIL_DOMAINS:
        return "gmail"
    if host in OUTLOOK_DOMAINS or host.startswith(("outlook.", "hotmail.", "live.")):
        return "outlook"
    return "other"


def summarize_warmup_network_contacts(contacts: Iterable[dict[str, Any]]) -> dict[str, Any]:
    total = 0
    gmail_count = 0
    outlook_count = 0
    other_count = 0
    for contact in contacts:
        total += 1
        provider = classify_contact_provider(contact.get("email"))
        if provider == "gmail":
            gmail_count += 1
        elif provider == "outlook":
            outlook_count += 1
        else:
            other_count += 1

    # Eligibility uses only Gmail + Outlook; "other" providers do not count toward totals or the mix.
    gmail_outlook_total = gmail_count + outlook_count
    required_gmail_for_current_total = (
        math.ceil(gmail_outlook_total * SHARED_POOL_GMAIL_SHARE) if gmail_outlook_total else 0
    )
    required_outlook_for_current_total = max(0, gmail_outlook_total - required_gmail_for_current_total)
    qualifies = (
        gmail_outlook_total >= MIN_SHARED_POOL_CONTACTS
        and gmail_count >= required_gmail_for_current_total
        and outlook_count >= required_outlook_for_current_total
    )

    return {
        "total_contacts": total,
        "gmail_contacts": gmail_count,
        "outlook_contacts": outlook_count,
        "other_contacts": other_count,
        "gmail_outlook_contacts": gmail_outlook_total,
        "required_total_contacts": MIN_SHARED_POOL_CONTACTS,
        "required_gmail_contacts_at_minimum": math.ceil(MIN_SHARED_POOL_CONTACTS * SHARED_POOL_GMAIL_SHARE),
        "required_outlook_contacts_at_minimum": MIN_SHARED_POOL_CONTACTS - math.ceil(MIN_SHARED_POOL_CONTACTS * SHARED_POOL_GMAIL_SHARE),
        "required_gmail_contacts_for_current_total": required_gmail_for_current_total,
        "required_outlook_contacts_for_current_total": required_outlook_for_current_total,
        "qualifies": qualifies,
        "gmail_share": round((gmail_count / gmail_outlook_total), 4) if gmail_outlook_total else 0.0,
        "outlook_share": round((outlook_count / gmail_outlook_total), 4) if gmail_outlook_total else 0.0,
    }


class WarmupSharedPoolService:
    def __init__(self, db: Any):
        self.db = db

    async def get_user_contact_docs(self, user_id: str) -> list[dict[str, Any]]:
        return await self.db.warmup_network_contacts.find(
            {"user_id": user_id},
            {"_id": 0},
        ).to_list(None)

    async def get_user_summary(self, user_id: str) -> dict[str, Any]:
        contacts = await self.get_user_contact_docs(user_id)
        return summarize_warmup_network_contacts(contacts)

    async def get_eligible_contributor_user_ids(self, *, exclude_user_id: str | None = None) -> list[str]:
        query: dict[str, Any] = {"warmup_shared_pool_enabled": True}
        if exclude_user_id:
            query["id"] = {"$ne": exclude_user_id}
        users = await self.db.users.find(query, {"_id": 0, "id": 1}).to_list(None)
        eligible_ids: list[str] = []
        for user in users:
            user_id = user.get("id")
            if not user_id:
                continue
            summary = await self.get_user_summary(user_id)
            if summary.get("qualifies"):
                eligible_ids.append(user_id)
            else:
                await self.db.users.update_one(
                    {"id": user_id},
                    {"$set": {"warmup_shared_pool_enabled": False}},
                )
        return eligible_ids

    async def count_available_contacts(self, *, exclude_user_id: str | None = None) -> int:
        contributor_ids = await self.get_eligible_contributor_user_ids(exclude_user_id=exclude_user_id)
        if not contributor_ids:
            return 0
        return await self.db.warmup_network_contacts.count_documents({"user_id": {"$in": contributor_ids}})
