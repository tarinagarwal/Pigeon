"""Block contacts globally after repeated delivery failures (bounce/drop/etc)."""
from datetime import datetime, timezone
import logging

from config import BLOCK_AFTER_FAILED_ATTEMPTS

logger = logging.getLogger(__name__)


async def maybe_mark_contact_blocked_for_failures(db, user_id: str, contact_id: str) -> None:
    """If contact has >= BLOCK_AFTER_FAILED_ATTEMPTS failed delivery attempts globally, mark as blocked."""
    count = await db.email_logs.count_documents({
        "user_id": user_id,
        "contact_id": contact_id,
        "status": "failed",
    })
    if count >= BLOCK_AFTER_FAILED_ATTEMPTS:
        now = datetime.now(timezone.utc)
        res = await db.contacts.update_one(
            {"id": contact_id, "user_id": user_id},
            {"$set": {"status": "blocked", "updated_at": now}},
        )
        if res.modified_count:
            logger.info(
                "Marked contact %s as blocked (globally) after %d failed delivery attempts",
                contact_id,
                count,
            )
