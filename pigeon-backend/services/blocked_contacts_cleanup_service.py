"""Periodic cleanup for contacts that remained blocked past retention."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
import logging
from typing import Any

from config import BLOCKED_CONTACT_RETENTION_DAYS, CONTACT_UNUSED_RETENTION_DAYS

logger = logging.getLogger(__name__)

# Keep chunk size moderate so each bulk operation stays fast and memory-safe.
_BULK_CHUNK_SIZE = 1000


def _chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


async def _unlink_and_delete_contacts(
    db,
    user_id: str,
    contact_ids: list[str],
    delete_filter: dict[str, Any],
) -> dict[str, int]:
    """Bulk unlink from lists/campaigns, then delete contacts."""
    if not contact_ids:
        return {
            "updated_contact_lists": 0,
            "updated_campaigns": 0,
            "deleted_campaign_contacts": 0,
            "deleted_contacts": 0,
        }

    list_res = await db.contact_lists.update_many(
        {"user_id": user_id, "contact_ids": {"$in": contact_ids}},
        {"$pull": {"contact_ids": {"$in": contact_ids}}},
    )
    campaign_res = await db.campaigns.update_many(
        {"user_id": user_id, "contact_ids": {"$in": contact_ids}},
        {"$pull": {"contact_ids": {"$in": contact_ids}}},
    )
    campaign_contacts_res = await db.campaign_contacts.delete_many(
        {"user_id": user_id, "contact_id": {"$in": contact_ids}}
    )
    contacts_res = await db.contacts.delete_many(
        {
            "user_id": user_id,
            "id": {"$in": contact_ids},
            **delete_filter,
        }
    )
    return {
        "updated_contact_lists": list_res.modified_count,
        "updated_campaigns": campaign_res.modified_count,
        "deleted_campaign_contacts": campaign_contacts_res.deleted_count,
        "deleted_contacts": contacts_res.deleted_count,
    }


def _older_than_cutoff_filter(cutoff: datetime) -> dict[str, Any]:
    return {
        "$or": [
            {"updated_at": {"$lte": cutoff}},
            {"updated_at": {"$exists": False}, "created_at": {"$lte": cutoff}},
        ]
    }


async def _cleanup_blocked_contacts(db, now: datetime) -> dict[str, Any]:
    retention_days = max(1, int(BLOCKED_CONTACT_RETENTION_DAYS))
    cutoff = now - timedelta(days=retention_days)
    older_than_cutoff_filter = _older_than_cutoff_filter(cutoff)
    expiration_query = {"status": "blocked", **older_than_cutoff_filter}

    blocked_contacts = await db.contacts.find(
        expiration_query,
        {"_id": 0, "id": 1, "user_id": 1},
    ).to_list(None)

    if not blocked_contacts:
        return {
            "retention_days": retention_days,
            "cutoff": cutoff,
            "candidate_contacts": 0,
            "deleted_contacts": 0,
            "updated_contact_lists": 0,
            "updated_campaigns": 0,
            "deleted_campaign_contacts": 0,
        }

    contact_ids_by_user: dict[str, list[str]] = defaultdict(list)
    for row in blocked_contacts:
        user_id = row.get("user_id")
        contact_id = row.get("id")
        if user_id and contact_id:
            contact_ids_by_user[user_id].append(contact_id)

    totals = {
        "retention_days": retention_days,
        "cutoff": cutoff,
        "candidate_contacts": len(blocked_contacts),
        "deleted_contacts": 0,
        "updated_contact_lists": 0,
        "updated_campaigns": 0,
        "deleted_campaign_contacts": 0,
    }
    for user_id, user_contact_ids in contact_ids_by_user.items():
        for contact_ids in _chunks(user_contact_ids, _BULK_CHUNK_SIZE):
            stats = await _unlink_and_delete_contacts(
                db=db,
                user_id=user_id,
                contact_ids=contact_ids,
                delete_filter={"status": "blocked", **older_than_cutoff_filter},
            )
            totals["deleted_contacts"] += stats["deleted_contacts"]
            totals["updated_contact_lists"] += stats["updated_contact_lists"]
            totals["updated_campaigns"] += stats["updated_campaigns"]
            totals["deleted_campaign_contacts"] += stats["deleted_campaign_contacts"]
    return totals


async def _cleanup_unused_contacts(db, now: datetime) -> dict[str, Any]:
    retention_days = max(1, int(CONTACT_UNUSED_RETENTION_DAYS))
    cutoff = now - timedelta(days=retention_days)
    older_than_cutoff_filter = _older_than_cutoff_filter(cutoff)

    # "Unused" = contact record itself is old and it has no recent activity,
    # and it is not currently linked in campaign/list contact ids.
    candidate_query = {"status": {"$ne": "blocked"}, **older_than_cutoff_filter}
    candidates = await db.contacts.find(
        candidate_query,
        {"_id": 0, "id": 1, "user_id": 1},
    ).to_list(None)
    if not candidates:
        return {
            "retention_days": retention_days,
            "cutoff": cutoff,
            "candidate_contacts": 0,
            "deleted_contacts": 0,
            "updated_contact_lists": 0,
            "updated_campaigns": 0,
            "deleted_campaign_contacts": 0,
        }

    contact_ids_by_user: dict[str, list[str]] = defaultdict(list)
    for row in candidates:
        user_id = row.get("user_id")
        contact_id = row.get("id")
        if user_id and contact_id:
            contact_ids_by_user[user_id].append(contact_id)

    totals = {
        "retention_days": retention_days,
        "cutoff": cutoff,
        "candidate_contacts": len(candidates),
        "deleted_contacts": 0,
        "updated_contact_lists": 0,
        "updated_campaigns": 0,
        "deleted_campaign_contacts": 0,
    }

    recent_email_activity_query = {
        "$or": [
            {"created_at": {"$gte": cutoff}},
            {"sent_at": {"$gte": cutoff}},
            {"opened_at": {"$gte": cutoff}},
            {"clicked_at": {"$gte": cutoff}},
            {"replied_at": {"$gte": cutoff}},
        ]
    }
    recent_campaign_contact_query = {
        "$or": [
            {"created_at": {"$gte": cutoff}},
            {"updated_at": {"$gte": cutoff}},
            {"last_activity": {"$gte": cutoff}},
        ]
    }

    for user_id, user_candidate_ids in contact_ids_by_user.items():
        for candidate_ids in _chunks(user_candidate_ids, _BULK_CHUNK_SIZE):
            linked_in_lists = await db.contact_lists.find(
                {"user_id": user_id, "contact_ids": {"$in": candidate_ids}},
                {"_id": 0, "contact_ids": 1},
            ).to_list(None)
            linked_in_list_ids = {
                cid
                for doc in linked_in_lists
                for cid in (doc.get("contact_ids") or [])
                if cid in candidate_ids
            }

            linked_in_campaigns = await db.campaigns.find(
                {"user_id": user_id, "contact_ids": {"$in": candidate_ids}},
                {"_id": 0, "contact_ids": 1},
            ).to_list(None)
            linked_in_campaign_ids = {
                cid
                for doc in linked_in_campaigns
                for cid in (doc.get("contact_ids") or [])
                if cid in candidate_ids
            }

            recent_email_ids = set(
                await db.email_logs.distinct(
                    "contact_id",
                    {
                        "user_id": user_id,
                        "contact_id": {"$in": candidate_ids},
                        **recent_email_activity_query,
                    },
                )
            )
            recent_campaign_contact_ids = set(
                await db.campaign_contacts.distinct(
                    "contact_id",
                    {
                        "user_id": user_id,
                        "contact_id": {"$in": candidate_ids},
                        **recent_campaign_contact_query,
                    },
                )
            )

            protected_ids = (
                linked_in_list_ids
                | linked_in_campaign_ids
                | recent_email_ids
                | recent_campaign_contact_ids
            )
            stale_unused_ids = [cid for cid in candidate_ids if cid not in protected_ids]
            if not stale_unused_ids:
                continue

            stats = await _unlink_and_delete_contacts(
                db=db,
                user_id=user_id,
                contact_ids=stale_unused_ids,
                delete_filter={"status": {"$ne": "blocked"}, **older_than_cutoff_filter},
            )
            totals["deleted_contacts"] += stats["deleted_contacts"]
            totals["updated_contact_lists"] += stats["updated_contact_lists"]
            totals["updated_campaigns"] += stats["updated_campaigns"]
            totals["deleted_campaign_contacts"] += stats["deleted_campaign_contacts"]

    return totals


async def cleanup_expired_blocked_contacts(db) -> dict[str, Any]:
    """
    Remove contacts that have status=blocked for >= retention window.

    Order of operations is important:
    1) Unlink from campaign/list structures
    2) Delete contact rows
    """
    now = datetime.now(timezone.utc)
    blocked = await _cleanup_blocked_contacts(db, now)
    unused = await _cleanup_unused_contacts(db, now)

    result = {
        "checked_at": now,
        "blocked": blocked,
        "unused": unused,
        "deleted_contacts_total": int(blocked.get("deleted_contacts", 0))
        + int(unused.get("deleted_contacts", 0)),
    }
    logger.info(
        "Contact cleanup complete: blocked_deleted=%s unused_deleted=%s total_deleted=%s",
        int(blocked.get("deleted_contacts", 0)),
        int(unused.get("deleted_contacts", 0)),
        result["deleted_contacts_total"],
    )
    return result
