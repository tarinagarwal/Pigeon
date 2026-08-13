"""Backfill warmup threads/messages and remove legacy reply-template collection."""
import os
import uuid
from datetime import timezone

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient


async def main() -> None:
    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("DB_NAME", "pigeon_ai")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    admin_db = client["pigeon_admin"]

    cursor = db.warmup_sent.find({"thread_id": {"$exists": False}})
    async for doc in cursor:
        sent_at = doc.get("sent_at") or doc.get("created_at")
        if sent_at and getattr(sent_at, "tzinfo", None) is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        thread_id = str(uuid.uuid4())
        now = sent_at or doc.get("updated_at")
        await db.warmup_threads.update_one(
            {"id": thread_id},
            {"$set": {
                "id": thread_id,
                "inbox_id": doc["inbox_id"],
                "user_id": doc["user_id"],
                "receiver_account_id": doc["receiver_account_id"],
                "receiver_email": doc["receiver_email"],
                "root_message_id": doc["message_id"],
                "stage": "closed",
                "turn_count": 1,
                "max_turns": 1,
                "last_sender_role": "inbox",
                "close_reason": "legacy_backfill",
                "started_at": now,
                "last_activity_at": now,
                "ended_at": now,
                "next_action_at": None,
                "created_at": now,
                "updated_at": now,
            }},
            upsert=True,
        )
        await db.warmup_messages.update_one(
            {"message_id": doc["message_id"], "thread_id": thread_id},
            {"$set": {
                "id": str(uuid.uuid4()),
                "thread_id": thread_id,
                "inbox_id": doc["inbox_id"],
                "user_id": doc["user_id"],
                "receiver_account_id": doc["receiver_account_id"],
                "role": "inbox",
                "message_id": doc["message_id"],
                "in_reply_to": None,
                "references": None,
                "subject": doc.get("subject") or "Hello",
                "body": "",
                "from_email": doc.get("from_email") or doc["receiver_email"],
                "to_email": doc["receiver_email"],
                "provider": None,
                "sent_at": now,
                "created_at": now,
                "updated_at": now,
            }},
            upsert=True,
        )
        await db.warmup_sent.update_one(
            {"id": doc["id"]},
            {"$set": {"thread_id": thread_id, "turn_index": 0, "updated_at": now}},
        )

    await admin_db.warmup_reply_templates.drop()
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
