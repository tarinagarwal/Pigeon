"""Periodic cleanup for old email_logs, tracking_pixels, and inbound_messages."""

from datetime import datetime, timedelta, timezone
from typing import Any

from config import EMAIL_LOG_RETENTION_DAYS


def _build_stale_email_logs_query(cutoff: datetime) -> dict[str, Any]:
    return {
        "$or": [
            # If updated_at exists, treat that as last-change timestamp.
            {"updated_at": {"$lte": cutoff}},
            # Backward-compat rows without updated_at: fall back to sent_at.
            {"updated_at": {"$exists": False}, "sent_at": {"$lte": cutoff}},
            # If both updated_at and sent_at are missing, use created_at.
            {
                "updated_at": {"$exists": False},
                "sent_at": {"$exists": False},
                "created_at": {"$lte": cutoff},
            },
        ]
    }


async def cleanup_stale_email_logs(db) -> dict[str, Any]:
    """Delete email_logs older than retention where no updates happened recently."""
    retention_days = max(1, int(EMAIL_LOG_RETENTION_DAYS))
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    query = _build_stale_email_logs_query(cutoff)

    to_delete = await db.email_logs.count_documents(query)
    if to_delete == 0:
        return {
            "retention_days": retention_days,
            "cutoff": cutoff,
            "candidate_email_logs": 0,
            "deleted_email_logs": 0,
        }

    res = await db.email_logs.delete_many(query)
    return {
        "retention_days": retention_days,
        "cutoff": cutoff,
        "candidate_email_logs": to_delete,
        "deleted_email_logs": int(res.deleted_count),
    }


def _build_stale_tracking_pixels_query(cutoff: datetime) -> dict[str, Any]:
    return {
        "$or": [
            # If updated_at exists, treat that as last-change timestamp.
            {"updated_at": {"$lte": cutoff}},
            # Most rows use created_at only.
            {"updated_at": {"$exists": False}, "created_at": {"$lte": cutoff}},
        ]
    }


async def cleanup_stale_tracking_pixels(db) -> dict[str, Any]:
    """Delete tracking_pixels older than retention where no updates happened recently."""
    retention_days = max(1, int(EMAIL_LOG_RETENTION_DAYS))
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    query = _build_stale_tracking_pixels_query(cutoff)

    to_delete = await db.tracking_pixels.count_documents(query)
    if to_delete == 0:
        return {
            "retention_days": retention_days,
            "cutoff": cutoff,
            "candidate_tracking_pixels": 0,
            "deleted_tracking_pixels": 0,
        }

    res = await db.tracking_pixels.delete_many(query)
    return {
        "retention_days": retention_days,
        "cutoff": cutoff,
        "candidate_tracking_pixels": to_delete,
        "deleted_tracking_pixels": int(res.deleted_count),
    }


def _build_stale_inbound_messages_query(cutoff: datetime) -> dict[str, Any]:
    return {
        "$or": [
            # If updated_at exists, treat that as last-change timestamp.
            {"updated_at": {"$lte": cutoff}},
            # Typical fallback for received messages.
            {"updated_at": {"$exists": False}, "received_at": {"$lte": cutoff}},
            # Safety fallback when received_at is missing.
            {
                "updated_at": {"$exists": False},
                "received_at": {"$exists": False},
                "created_at": {"$lte": cutoff},
            },
        ]
    }


async def cleanup_stale_inbound_messages(db) -> dict[str, Any]:
    """Delete inbound_messages older than retention where no updates happened recently."""
    retention_days = max(1, int(EMAIL_LOG_RETENTION_DAYS))
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    query = _build_stale_inbound_messages_query(cutoff)

    to_delete = await db.inbound_messages.count_documents(query)
    if to_delete == 0:
        return {
            "retention_days": retention_days,
            "cutoff": cutoff,
            "candidate_inbound_messages": 0,
            "deleted_inbound_messages": 0,
        }

    res = await db.inbound_messages.delete_many(query)
    return {
        "retention_days": retention_days,
        "cutoff": cutoff,
        "candidate_inbound_messages": to_delete,
        "deleted_inbound_messages": int(res.deleted_count),
    }
