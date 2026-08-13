"""
Match inbound / mailbox-received replies to warmup_sent rows (same idea as email_logs + inbound_messages).

Used by SendGrid inbound webhook and by GET /warmup/sent-logs to backfill replied_at when mail was already stored.
"""

import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _email_from_from(from_str: str) -> str:
    if not from_str:
        return ""
    from_str = from_str.strip()
    match = re.search(r"<([^>]+)>", from_str)
    if match:
        return match.group(1).strip().lower()
    return from_str.lower()


def _normalize_subject(subject: str) -> str:
    if not subject:
        return ""
    return re.sub(r"^\s*(Re:\s*|Fwd:\s*)+", "", subject, flags=re.IGNORECASE).strip().lower()


def _normalize_msg_id(msg_id: str) -> str:
    if not msg_id:
        return ""
    s = (msg_id or "").strip()
    if s.startswith("<") and s.endswith(">"):
        s = s[1:-1]
    return s


def _extract_email_from_to_field(to_field: str) -> str:
    if not to_field or not to_field.strip():
        return ""
    s = to_field.strip()
    if "," in s:
        s = s.split(",")[0].strip()
    match = re.search(r"<([^>]+)>", s)
    if match:
        return match.group(1).strip().lower()
    return s.lower()


async def try_update_warmup_sent_from_inbound(
    db: Any,
    *,
    user_id: str,
    inbox_id: Optional[str],
    to_addr: str,
    from_addr: str,
    subject: str,
    reply_ids: set,
    received_at: datetime,
    inbound_message_id: str,
) -> bool:
    """
    If this inbound message is a reply to a warmup send, set warmup_sent.replied_at.

    Matching:
    1) In-Reply-To / References contains warmup_sent.message_id (outbound Message-ID body).
    2) Fallback: same as campaign mailbox sync — receiver email + normalized subject + inbox,
       for recent sends without replied_at.
    """
    if not user_id:
        return False

    from_email = _email_from_from(from_addr or "")
    if not from_email or "@" not in from_email:
        return False

    # --- 1) Match by threading headers (outbound Message-ID stored on warmup_sent.message_id)
    candidate_mids: set = set()
    for r in reply_ids or []:
        if not r:
            continue
        candidate_mids.add(r.strip())
        candidate_mids.add(_normalize_msg_id(r))
    candidate_mids.discard("")

    if candidate_mids:
        ws = await db.warmup_sent.find_one(
            {
                "user_id": user_id,
                "replied_at": None,
                "message_id": {"$in": list(candidate_mids)},
            }
        )
        if ws:
            await _apply_warmup_reply(db, ws, received_at, inbound_message_id)
            return True

    # --- 2) Fallback: receiver + subject + inbox (mirrors inbox_emails campaign sync)
    norm_incoming = _normalize_subject(subject or "")
    if not norm_incoming:
        return False

    to_email = _extract_email_from_to_field(to_addr or "")

    query: dict = {"user_id": user_id, "replied_at": None}
    if inbox_id:
        query["inbox_id"] = inbox_id

    try:
        pending = await db.warmup_sent.find(query, {"_id": 0}).sort("sent_at", -1).limit(200).to_list(None)
    except Exception as e:
        logger.warning("warmup_inbound_sync: list pending warmup_sent failed: %s", e)
        return False

    for ws in pending:
        recv = (ws.get("receiver_email") or "").strip().lower()
        if recv != from_email:
            continue
        if _normalize_subject(ws.get("subject") or "") != norm_incoming:
            continue
        # If inbound had no inbox_id (catch-all), require To to match this send's inbox email
        if not inbox_id and to_email:
            ib = await db.inboxes.find_one({"id": ws.get("inbox_id")}, {"_id": 0, "email": 1})
            if ib:
                ib_em = (ib.get("email") or "").strip().lower()
                if ib_em and ib_em != to_email:
                    continue
        ra = ws.get("sent_at")
        if isinstance(ra, datetime) and received_at < ra:
            continue
        await _apply_warmup_reply(db, ws, received_at, inbound_message_id)
        return True

    return False


async def _apply_warmup_reply(
    db: Any,
    ws: dict,
    received_at: datetime,
    inbound_message_id: str,
) -> None:
    now = received_at if isinstance(received_at, datetime) else datetime.now(timezone.utc)
    try:
        await db.warmup_sent.update_one(
            {"id": ws["id"]},
            {
                "$set": {
                    "replied_at": now,
                    "updated_at": datetime.now(timezone.utc),
                    "inbound_message_id": inbound_message_id,
                }
            },
        )
        # So MailBox / inbox APIs can show a "warmup" badge without extra joins on every read.
        await db.inbound_messages.update_one(
            {"id": inbound_message_id},
            {"$set": {"warmup_reply": True}},
        )
    except Exception as e:
        logger.warning("warmup_inbound_sync: update warmup_sent id=%s failed: %s", ws.get("id"), e)


async def backfill_warmup_replies_for_user(db: Any, user_id: str, limit_pending: int = 150) -> int:
    """
    For warmup_sent rows with no replied_at, scan recent inbound_messages (like get_inbox_emails for campaigns)
    and attach the first matching reply. Returns number of rows updated.
    """
    if not user_id:
        return 0
    try:
        pending = await db.warmup_sent.find(
            {"user_id": user_id, "replied_at": None},
            {"_id": 0},
        ).sort("sent_at", -1).limit(limit_pending).to_list(None)
    except Exception as e:
        logger.warning("warmup_inbound_sync: backfill list failed: %s", e)
        return 0
    if not pending:
        return 0

    try:
        recent_inbound = await db.inbound_messages.find(
            {"user_id": user_id},
            {"_id": 0, "id": 1, "from": 1, "subject": 1, "to": 1, "received_at": 1, "inbox_id": 1},
        ).sort("received_at", -1).limit(400).to_list(None)
    except Exception as e:
        logger.warning("warmup_inbound_sync: backfill inbound list failed: %s", e)
        return 0

    updated = 0
    matched_inbound_ids: set = set()
    for ws in pending:
        recv = (ws.get("receiver_email") or "").strip().lower()
        ws_subj = _normalize_subject(ws.get("subject") or "")
        if not recv or not ws_subj:
            continue
        ws_inbox_id = ws.get("inbox_id")
        for m in recent_inbound:
            if m["id"] in matched_inbound_ids:
                continue
            if _email_from_from(m.get("from") or "") != recv:
                continue
            if _normalize_subject(m.get("subject") or "") != ws_subj:
                continue
            if ws_inbox_id and m.get("inbox_id") and m.get("inbox_id") != ws_inbox_id:
                continue
            recv_at = m.get("received_at")
            if not isinstance(recv_at, datetime):
                recv_at = datetime.now(timezone.utc)
            sent_at = ws.get("sent_at")
            if isinstance(sent_at, datetime) and recv_at < sent_at:
                continue
            await _apply_warmup_reply(db, ws, recv_at, m["id"])
            matched_inbound_ids.add(m["id"])
            updated += 1
            break
    return updated
