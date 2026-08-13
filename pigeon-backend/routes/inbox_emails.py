"""Inbox emails routes"""
import base64
import hashlib
import json
import re
from fastapi import APIRouter, Query, HTTPException, Depends, Request
from fastapi.encoders import jsonable_encoder
from typing import Optional
from datetime import datetime, timezone
from starlette.responses import Response, JSONResponse

from database import db
from routes.dependencies import get_current_user
from routes.schemas import SendReceivedReplyRequest, SendComposeRequest
from services.plan_service import MonthlySmtpQuotaExceeded
from services.email_html_plain import html_email_fragment_to_plain

router = APIRouter()


def _etag_for_payload(payload: list) -> str:
    """Compute a strong ETag from a list payload (stable JSON hash)."""
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _maybe_304(request: Request, etag: str) -> Optional[Response]:
    """If client sent If-None-Match matching etag, return 304 Response; else None."""
    inm = (request.headers.get("if-none-match") or "").strip().strip('"')
    if inm and inm == etag:
        return Response(status_code=304)
    return None


def _normalize_subject(subject: str) -> str:
    """Strip Re:, Fwd:, whitespace for matching."""
    if not subject:
        return ""
    return re.sub(r"^\s*(Re:\s*|Fwd:\s*)+", "", subject, flags=re.IGNORECASE).strip().lower()


def _email_from_from(from_str: str) -> str:
    """Extract email from 'Name <email@x.com>' or return as-is if plain email."""
    if not from_str:
        return ""
    from_str = from_str.strip()
    match = re.search(r"<([^>]+)>", from_str)
    if match:
        return match.group(1).strip().lower()
    return from_str.lower()


def _legacy_thread_key(from_str: str, subject: str) -> str:
    """Build a stable thread key for messages without thread_id (same conversation = same key)."""
    from_email = _email_from_from(from_str or "")
    norm_subject = _normalize_subject(subject or "")
    payload = json.dumps([from_email, norm_subject], sort_keys=True)
    return "legacy:" + base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _get_email_service():
    from routes.emails import email_service
    if email_service is None:
        raise HTTPException(status_code=503, detail="Email service not available")
    return email_service


def _looks_like_html(s: str) -> bool:
    """True if string contains HTML tags (so frontend can render with isolation)."""
    if not s or not isinstance(s, str):
        return False
    return bool(re.search(r"<[a-z!/][^>]*>", s, re.I))


def _build_thread_messages(
    log: dict,
    resolved_body_by_log_id: dict,
    inbound_by_id: dict,
    inbound_html_by_id: Optional[dict] = None,
) -> list:
    """Build ordered list of thread messages (Gmail-style). Each item: { type, body, at, from, body_html? }."""
    inbound_html_by_id = inbound_html_by_id or {}
    thread = log.get("thread_messages") or []
    sent_at = log.get("sent_at") or log.get("created_at")
    sent_at_iso = sent_at.isoformat() if hasattr(sent_at, "isoformat") else str(sent_at) if sent_at else None
    original_body = (log.get("body") or "").strip()
    reply_body = (log.get("reply_body") or "").strip()
    reply_body = reply_body or resolved_body_by_log_id.get(log["id"], "") or inbound_by_id.get(log.get("inbound_message_id") or "", "")
    last_sent = (log.get("last_sent_reply_body") or "").strip()
    reply_body_html = (inbound_html_by_id.get(log.get("inbound_message_id") or "") or "").strip() or None

    our_send_msg = {"type": "our_send", "body": original_body, "at": sent_at_iso, "from": "us"}
    if original_body and _looks_like_html(original_body):
        our_send_msg["body_html"] = original_body

    if not thread:
        messages = [our_send_msg]
        if reply_body:
            their_msg = {"type": "their_reply", "body": reply_body, "at": None, "from": "them"}
            if reply_body_html:
                their_msg["body_html"] = reply_body_html
            elif _looks_like_html(reply_body):
                their_msg["body_html"] = reply_body
            messages.append(their_msg)
        if last_sent:
            messages.append({"type": "our_reply", "body": last_sent, "at": None, "from": "us"})
        return messages

    messages = [our_send_msg]
    sorted_thread = sorted([t for t in thread if isinstance(t, dict)], key=lambda x: (x.get("at") or ""))
    for t in sorted_thread:
        typ = t.get("type") or "their_reply"
        body = (t.get("body") or "").strip()
        at = t.get("at")
        from_side = "us" if typ == "our_reply" else "them"
        msg = {"type": typ, "body": body, "at": at, "from": from_side}
        if t.get("body_html"):
            msg["body_html"] = (t.get("body_html") or "").strip()
        elif body and from_side == "them" and _looks_like_html(body):
            msg["body_html"] = body
        messages.append(msg)
    return messages

@router.get("/inbox/emails")
async def get_inbox_emails(
    request: Request,
    user_id: str,
    filter: Optional[str] = Query("all", description="Filter: all, unread, sent, replied, starred, archived"),
):
    """Get inbox emails (sent and replied threads so user can view and reply from app). Supports ETag/304."""
    emails = []
    
    # Include sent, opened, clicked, and replied so user can open any thread and reply from app
    query = {"user_id": user_id, "status": {"$in": ["sent", "opened", "clicked", "replied"]}}
    if filter == "archived":
        query["archived"] = True
    else:
        # Exclude archived when showing main inbox (all, unread, sent, replied, starred)
        query["$or"] = [{"archived": {"$ne": True}}, {"archived": {"$exists": False}}]
    email_logs = await db.email_logs.find(query, {"_id": 0}).sort(
        [("replied_at", -1), ("sent_at", -1)]
    ).limit(50).to_list(None)
    
    if not email_logs:
        return []
    
    # Get all contact IDs, campaign IDs, and sender inbox IDs in one query for efficiency
    contact_ids = list(set([log.get("contact_id") for log in email_logs if log.get("contact_id")]))
    campaign_ids = list(set([log.get("campaign_id") for log in email_logs if log.get("campaign_id")]))
    sender_inbox_ids = list(set([log.get("sender_id") for log in email_logs if log.get("sender_id")]))
    
    # Fetch all contacts and campaigns in batch
    contacts_list = await db.contacts.find({"id": {"$in": contact_ids}}, {"_id": 0}).to_list(None) if contact_ids else []
    campaigns_list = await db.campaigns.find({"id": {"$in": campaign_ids}}, {"_id": 0}).to_list(None) if campaign_ids else []
    inboxes_list = (
        await db.inboxes.find({"id": {"$in": sender_inbox_ids}}, {"_id": 0, "id": 1, "email": 1}).to_list(None)
        if sender_inbox_ids else []
    )
    
    # Create lookup maps
    contact_map = {c["id"]: c for c in contacts_list}
    campaign_map = {c["id"]: c for c in campaigns_list}
    inbox_map = {i["id"]: i for i in inboxes_list}

    # Load inbound_messages for logs missing reply_body (sync Campaign replies with Received)
    logs_needing_inbound = [log for log in email_logs if not (log.get("reply_body") or "").strip()]
    inbound_by_id = {}
    resolved_body_by_log_id = {}
    if logs_needing_inbound:
        # Resolve by inbound_message_id first
        inbound_ids = [log.get("inbound_message_id") for log in logs_needing_inbound if log.get("inbound_message_id")]
        if inbound_ids:
            cursor = db.inbound_messages.find({"id": {"$in": inbound_ids}, "user_id": user_id}, {"_id": 0, "id": 1, "body_text": 1, "body_html": 1})
            for m in await cursor.to_list(None):
                inbound_by_id[m["id"]] = (m.get("body_text") or m.get("body_html") or "").strip()
        # For logs still missing, try match by contact email + subject from recent inbound_messages
        still_missing = [log for log in logs_needing_inbound if not inbound_by_id.get(log.get("inbound_message_id") or "") and not (log.get("reply_body") or "").strip()]
        if still_missing:
            recent_inbound = await db.inbound_messages.find(
                {"user_id": user_id},
                {"_id": 0, "id": 1, "from": 1, "subject": 1, "body_text": 1, "body_html": 1, "received_at": 1}
            ).sort("received_at", -1).limit(150).to_list(None)
            matched_inbound_ids = set()
            for log in still_missing:
                contact = contact_map.get(log.get("contact_id"), {})
                contact_email = (contact.get("email") or "").strip().lower()
                log_subj_norm = _normalize_subject(log.get("subject") or "")
                if not contact_email or not log_subj_norm:
                    continue
                for m in recent_inbound:
                    if m["id"] in matched_inbound_ids:
                        continue
                    from_email = _email_from_from(m.get("from") or "")
                    if from_email != contact_email:
                        continue
                    if _normalize_subject(m.get("subject") or "") != log_subj_norm:
                        continue
                    body = (m.get("body_text") or m.get("body_html") or "").strip()
                    if body:
                        matched_inbound_ids.add(m["id"])
                        resolved_body_by_log_id[log["id"]] = body
                        recv_at = m.get("received_at")
                        if not isinstance(recv_at, datetime):
                            recv_at = datetime.now(timezone.utc)
                        await db.email_logs.update_one(
                            {"id": log["id"], "user_id": user_id},
                            {"$set": {"reply_body": body[:50000], "inbound_message_id": m["id"], "status": "replied", "replied_at": recv_at}}
                        )
                        contact_id = log.get("contact_id")
                        campaign_id = log.get("campaign_id")
                        if contact_id:
                            await db.contacts.update_one({"id": contact_id}, {"$set": {"status": "replied"}})
                        if campaign_id and contact_id:
                            await db.campaign_contacts.update_one(
                                {"campaign_id": campaign_id, "contact_id": contact_id},
                                {"$set": {"status": "replied", "last_activity": recv_at, "updated_at": recv_at}}
                            )
                    break

    # Load body_html for "Their reply" so frontend can render HTML and show Full preview
    all_inbound_ids = list(set(log.get("inbound_message_id") for log in email_logs if log.get("inbound_message_id")))
    inbound_html_by_id = {}
    if all_inbound_ids:
        cursor = db.inbound_messages.find(
            {"id": {"$in": all_inbound_ids}, "user_id": user_id},
            {"_id": 0, "id": 1, "body_html": 1},
        )
        for m in await cursor.to_list(None):
            html = (m.get("body_html") or "").strip()
            if html:
                inbound_html_by_id[m["id"]] = html

    for log in email_logs:
        # Get contact and campaign from maps
        contact = contact_map.get(log.get("contact_id"), {})
        campaign = campaign_map.get(log.get("campaign_id"), {})
        # Build thread messages (Gmail-style reply-by-reply)
        messages = _build_thread_messages(log, resolved_body_by_log_id, inbound_by_id, inbound_html_by_id)
        # For list row: preview/body from last message in thread
        last_msg = messages[-1] if messages else {}
        reply_body = (log.get("reply_body") or "").strip()
        if not reply_body:
            reply_body = resolved_body_by_log_id.get(log["id"], "") or inbound_by_id.get(log.get("inbound_message_id") or "", "")
        sent_body = log.get("body", "")
        # If there's no reply content yet (not synced or not sent), show a clear "no reply" message
        preview_body = (last_msg.get("body") or reply_body or "No reply yet") if last_msg.get("from") == "them" else (reply_body or "No reply yet")
        full_body = (last_msg.get("body") or reply_body) if last_msg.get("from") == "them" else reply_body
        if not full_body:
            full_body = "No reply yet"
        # Badge: domain_received if reply came via inbound (domain); else reply_to (Gmail/IMAP)
        has_inbound = bool(log.get("inbound_message_id")) or log["id"] in resolved_body_by_log_id
        reply_source = "domain_received" if has_inbound else "reply_to"
        subject = log.get("subject", "")
        if not subject.startswith("Re:"):
            subject = f"Re: {subject}"
        time_value = log.get("replied_at") or log.get("sent_at") or log.get("created_at")
        if isinstance(time_value, datetime):
            time_value = time_value.isoformat()
        elif time_value is None:
            time_value = datetime.now(timezone.utc).isoformat()
        is_read_flag = log.get("is_read")
        if isinstance(is_read_flag, bool):
            is_read = is_read_flag
        else:
            is_read = log.get("status") == "replied"
        emails.append({
            "id": log.get("id"),
            "sender": f"{contact.get('first_name', '')} {contact.get('last_name', '')}".strip() or contact.get("email", "Unknown"),
            "senderEmail": contact.get("email", "unknown@example.com"),
            "subject": subject,
            "preview": (preview_body[:150] + "...") if len(preview_body) > 150 else preview_body,
            "body": full_body,
            "originalBody": sent_body,
            "lastSentReplyBody": log.get("last_sent_reply_body") or None,
            "messages": messages,
            "time": time_value,
            "isRead": is_read,
            "isStarred": bool(log.get("starred")),
            "hasAttachment": False,
            "campaign": campaign.get("name") if campaign else None,
            "labels": ["replied"] if log.get("status") == "replied" else ["sent"],
            "replySource": reply_source,
            "sentFromInboxEmail": (inbox_map.get(log.get("sender_id")) or {}).get("email"),
        })
    
    # Apply filters
    if filter == "unread":
        emails = [e for e in emails if not e["isRead"]]
    elif filter == "sent":
        emails = [e for e in emails if "replied" not in e.get("labels", [])]
    elif filter == "replied":
        emails = [e for e in emails if "replied" in e.get("labels", [])]
    elif filter == "starred":
        emails = [e for e in emails if e["isStarred"]]

    etag = _etag_for_payload(emails)
    not_modified = _maybe_304(request, etag)
    if not_modified is not None:
        return not_modified
    return JSONResponse(content=jsonable_encoder(emails), headers={"ETag": f'"{etag}"'})

@router.put("/inbox/emails/{email_id}/read")
async def mark_email_as_read(email_id: str, user_id: str):
    """Mark an email as read"""
    await db.email_logs.update_one(
        {"id": email_id, "user_id": user_id},
        {"$set": {"is_read": True}}
    )
    return {"message": "Email marked as read"}

@router.put("/inbox/emails/{email_id}/archive")
async def archive_email(email_id: str, user_id: str):
    """Archive an email"""
    await db.email_logs.update_one(
        {"id": email_id, "user_id": user_id},
        {"$set": {"archived": True}}
    )
    return {"message": "Email archived"}

@router.put("/inbox/emails/{email_id}/star")
async def toggle_star_email(email_id: str, user_id: str):
    """Toggle starred state of an email"""
    log = await db.email_logs.find_one({"id": email_id, "user_id": user_id}, {"starred": 1})
    if not log:
        raise HTTPException(status_code=404, detail="Email not found")
    new_starred = not log.get("starred", False)
    await db.email_logs.update_one(
        {"id": email_id, "user_id": user_id},
        {"$set": {"starred": new_starred}}
    )
    return {"message": "Email starred" if new_starred else "Email unstarred", "starred": new_starred}

@router.delete("/inbox/emails/{email_id}")
async def delete_email(email_id: str, user_id: str):
    """Delete an email"""
    await db.email_logs.delete_one({"id": email_id, "user_id": user_id})
    return {"message": "Email deleted"}

@router.post("/inbox/emails/{email_id}/tag")
async def tag_email(email_id: str, user_id: str, tag: str):
    """Add a tag to an email"""
    await db.email_logs.update_one(
        {"id": email_id, "user_id": user_id},
        {"$addToSet": {"tags": tag}}
    )
    return {"message": f"Tag '{tag}' added to email"}

@router.put("/inbox/emails/mark-all-read")
async def mark_all_emails_read(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark all emails as read for the current user. Uses authenticated user only."""
    if user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    result = await db.email_logs.update_many(
        {"user_id": user_id, "is_read": {"$ne": True}},
        {"$set": {"is_read": True}},
    )
    return {
        "message": "All emails marked as read",
        "modified_count": result.modified_count,
    }

@router.put("/inbox/emails/archive-all")
async def archive_all_emails(user_id: str):
    """Archive all emails for a user"""
    await db.email_logs.update_many(
        {"user_id": user_id},
        {"$set": {"archived": True}}
    )
    return {"message": "All emails archived"}


# --- MailBox list helpers (lightweight payloads) ---

_INBOUND_LIST_PROJECTION = {
    "_id": 0,
    "id": 1,
    "thread_id": 1,
    "to": 1,
    "from": 1,
    "subject": 1,
    "received_at": 1,
    "user_id": 1,
    "inbox_id": 1,
    "domain_id": 1,
    "message_id": 1,
    "has_attachment": 1,
    "is_read": 1,
    "warmup_reply": 1,
    "body_text": 1,
    "body_html": 1,
    "last_sent_reply_subject": 1,
    "last_sent_reply_at": 1,
}

_COMPOSE_LIST_PROJECTION = {
    "_id": 0,
    "id": 1,
    "thread_id": 1,
    "to": 1,
    "subject": 1,
    "body": 1,
    "at": 1,
    "user_id": 1,
    "inbox_id": 1,
}


def _message_preview(body_text: Optional[str], body_html: Optional[str], fallback_body: Optional[str] = None) -> str:
    """Plain-text preview for list rows (strips HTML when needed)."""
    body = (body_text or "").strip()
    if not body:
        raw = (body_html or fallback_body or "").strip()
        if raw:
            body = html_email_fragment_to_plain(raw) if "<" in raw else raw
    if len(body) > 150:
        return body[:150] + "..."
    return body


async def _batch_threads_warmup_flags(user_id: str, inbound_groups: list) -> list:
    """Return warmup_thread bool per inbound thread group (single DB round-trip)."""
    if not inbound_groups:
        return []
    results = [False] * len(inbound_groups)
    ids_to_check: list[str] = []
    id_to_indices: dict[str, list[int]] = {}
    for i, group in enumerate(inbound_groups):
        if any(m.get("warmup_reply") for m in group):
            results[i] = True
            continue
        for m in group:
            mid = m.get("id")
            if not mid:
                continue
            ids_to_check.append(mid)
            id_to_indices.setdefault(mid, []).append(i)
    if not ids_to_check:
        return results
    matched: set[str] = set()
    cursor = db.warmup_sent.find(
        {"user_id": user_id, "inbound_message_id": {"$in": list(set(ids_to_check))}},
        {"_id": 0, "inbound_message_id": 1},
    )
    async for doc in cursor:
        imid = doc.get("inbound_message_id")
        if imid:
            matched.add(imid)
    for mid in matched:
        for idx in id_to_indices.get(mid, []):
            results[idx] = True
    return results


def _thread_id_for_message(m: dict) -> str:
    explicit_tid = m.get("thread_id")
    if explicit_tid and explicit_tid != m.get("id"):
        return explicit_tid
    return _legacy_thread_key(m.get("from") or "", m.get("subject") or "")


async def _fetch_inbound_threads_map(
    query: dict,
    *,
    min_threads: int,
    batch_size: int = 500,
    max_messages: int = 10000,
) -> tuple[dict[str, list], bool]:
    """Batch-fetch inbound messages until min_threads exist or data is exhausted."""
    threads_map: dict[str, list] = {}
    skip = 0
    total_fetched = 0
    has_more_messages = False

    while len(threads_map) < min_threads and total_fetched < max_messages:
        batch = await (
            db.inbound_messages.find(query, _INBOUND_LIST_PROJECTION)
            .sort("received_at", -1)
            .skip(skip)
            .limit(batch_size)
            .to_list(None)
        )
        if not batch:
            break
        total_fetched += len(batch)
        for m in batch:
            tid = _thread_id_for_message(m)
            threads_map.setdefault(tid, []).append(m)
        if len(batch) < batch_size:
            break
        if len(threads_map) >= min_threads:
            has_more_messages = True
            break
        skip += batch_size

    return threads_map, has_more_messages


async def _build_received_page_items(
    user_id: str,
    page_threads: list,
    compose_inbox_email_map: dict,
) -> list:
    inbound_groups = [group for _recv, _tid, group, kind in page_threads if kind == "inbound"]
    warmup_flags = await _batch_threads_warmup_flags(user_id, inbound_groups)
    inbound_warmup_iter = iter(warmup_flags)
    items = []
    for _recv, tid, group, kind in page_threads:
        latest = group[0]
        if kind == "compose":
            body = latest.get("body") or ""
            preview = _message_preview(body, None)
            sent_at = latest.get("at")
            if isinstance(sent_at, datetime):
                sent_at = sent_at.isoformat()
            items.append({
                "id": latest.get("id"),
                "thread_id": tid,
                "to": latest.get("to"),
                "from": f"To: {latest.get('to')}",
                "subject": latest.get("subject"),
                "received_at": sent_at,
                "user_id": latest.get("user_id"),
                "inbox_id": latest.get("inbox_id"),
                "preview": preview,
                "message_count": 1,
                "last_sent_reply_subject": latest.get("subject"),
                "last_sent_reply_at": sent_at,
                "is_read": True,
                "warmup_thread": False,
                "compose_email": True,
                "sender_email": compose_inbox_email_map.get(latest.get("inbox_id")),
            })
        else:
            preview = _message_preview(latest.get("body_text"), latest.get("body_html"))
            recv = latest.get("received_at")
            if isinstance(recv, datetime):
                recv = recv.isoformat()
            warmup_thread = next(inbound_warmup_iter, False)
            items.append({
                "id": latest["id"],
                "thread_id": tid,
                "to": latest.get("to"),
                "from": latest.get("from"),
                "subject": latest.get("subject"),
                "received_at": recv,
                "user_id": latest.get("user_id"),
                "inbox_id": latest.get("inbox_id"),
                "domain_id": latest.get("domain_id"),
                "message_id": latest.get("message_id"),
                "preview": preview,
                "message_count": len(group),
                "has_attachment": latest.get("has_attachment"),
                "last_sent_reply_subject": latest.get("last_sent_reply_subject"),
                "last_sent_reply_at": latest.get("last_sent_reply_at"),
                "is_read": latest.get("is_read", False),
                "warmup_thread": warmup_thread,
            })
    return items


async def _list_received_threads(
    user_id: str,
    query: dict,
    *,
    inbox_id: Optional[str],
    valid_inbox_ids: set,
    offset: int,
    limit: int,
    unread_only: bool,
) -> tuple[list, bool]:
    """Return (thread list items, has_more) with proper thread-level pagination."""
    min_threads = offset + limit
    threads_map, has_more_messages = await _fetch_inbound_threads_map(
        query, min_threads=min_threads
    )

    compose_rows: list = []
    if not unread_only:
        compose_query = {"user_id": user_id, "compose_email": True}
        if inbox_id:
            compose_query["inbox_id"] = inbox_id
        else:
            compose_query["inbox_id"] = {"$in": list(valid_inbox_ids)}
        compose_rows = await db.outbound_replies.find(
            compose_query, _COMPOSE_LIST_PROJECTION
        ).sort("at", -1).limit(1000).to_list(None)

    compose_inbox_ids = list({row.get("inbox_id") for row in compose_rows if row.get("inbox_id")})
    compose_inboxes = (
        await db.inboxes.find({"id": {"$in": compose_inbox_ids}}, {"_id": 0, "id": 1, "email": 1}).to_list(None)
        if compose_inbox_ids
        else []
    )
    compose_inbox_email_map = {i["id"]: i.get("email") for i in compose_inboxes}

    thread_list = []
    for tid, group in threads_map.items():
        latest = group[0]
        thread_list.append((latest.get("received_at"), tid, group, "inbound"))
    for compose in compose_rows:
        compose_tid = compose.get("thread_id") or f"compose:{compose.get('id')}"
        thread_list.append((compose.get("at"), compose_tid, [compose], "compose"))
    thread_list.sort(key=lambda x: (x[0] or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)

    page_threads = thread_list[offset : offset + limit]
    has_more = len(thread_list) > offset + limit or (
        has_more_messages and len(page_threads) == limit
    )
    items = await _build_received_page_items(user_id, page_threads, compose_inbox_email_map)
    return items, has_more


# --- Warmup ↔ MailBox: threads that include a reply to a warmup send ---

async def _thread_has_warmup_reply(user_id: str, group: list) -> bool:
    if not group:
        return False
    if any(m.get("warmup_reply") for m in group):
        return True
    ids = [m["id"] for m in group if m.get("id")]
    if not ids:
        return False
    n = await db.warmup_sent.count_documents({"user_id": user_id, "inbound_message_id": {"$in": ids}})
    return n > 0


async def _enrich_inbound_warmup_flags(user_id: str, inbounds: list) -> None:
    """Set warmup_reply on inbound dicts when warmup_sent links this inbound (backfills older rows)."""
    if not inbounds:
        return
    ids_needing = [m["id"] for m in inbounds if m.get("id") and not m.get("warmup_reply")]
    if not ids_needing:
        return
    matched = set()
    cursor = db.warmup_sent.find(
        {"user_id": user_id, "inbound_message_id": {"$in": ids_needing}},
        {"_id": 0, "inbound_message_id": 1},
    )
    async for doc in cursor:
        imid = doc.get("inbound_message_id")
        if imid:
            matched.add(imid)
    for m in inbounds:
        if not m.get("warmup_reply") and m.get("id") in matched:
            m["warmup_reply"] = True


# --- Inbound / received mail (SendGrid Inbound Parse) ---

@router.get("/inbox/received")
async def get_received_emails(
    request: Request,
    user_id: str,
    current_user: dict = Depends(get_current_user),
    inbox_id: Optional[str] = Query(None),
    domain_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    unread_only: bool = Query(False),
):
    """List received email threads (Gmail-style). One row per thread. Supports ETag/304."""
    if user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    # Only show MailBox messages that belong to inboxes the user actually has.
    # This avoids surfacing catch-all/inbound messages for addresses without a configured inbox.
    inbox_cursor = db.inboxes.find({"user_id": user_id}, {"_id": 0, "id": 1})
    inbox_docs = await inbox_cursor.to_list(None)
    valid_inbox_ids = {doc["id"] for doc in inbox_docs}
    if not valid_inbox_ids:
        # No inboxes configured → MailBox should appear empty.
        return []

    query = {"user_id": user_id}
    if inbox_id:
        # If an inbox filter is provided, only allow it when it belongs to this user.
        if inbox_id not in valid_inbox_ids:
            return []
        query["inbox_id"] = inbox_id
    else:
        # When no specific inbox is selected, only include messages mapped to one of the user's inboxes.
        query["inbox_id"] = {"$in": list(valid_inbox_ids)}

    if domain_id:
        query["domain_id"] = domain_id
    if unread_only:
        query["is_read"] = {"$ne": True}

    items, has_more = await _list_received_threads(
        user_id,
        query,
        inbox_id=inbox_id,
        valid_inbox_ids=valid_inbox_ids,
        offset=offset,
        limit=limit,
        unread_only=unread_only,
    )
    payload = {"threads": items, "has_more": has_more}
    etag = _etag_for_payload(items)
    not_modified = _maybe_304(request, etag)
    if not_modified is not None:
        return not_modified
    return JSONResponse(content=jsonable_encoder(payload), headers={"ETag": f'"{etag}"'})


def _decode_legacy_thread_key(thread_id: str):
    """Decode legacy thread key to (from_email, norm_subject). Returns None if not legacy."""
    if not thread_id.startswith("legacy:"):
        return None
    try:
        payload = thread_id[7:]  # strip "legacy:"
        payload += "=" * (4 - len(payload) % 4)  # padding for b64
        decoded = base64.urlsafe_b64decode(payload).decode()
        parts = json.loads(decoded)
        if isinstance(parts, list) and len(parts) >= 2:
            return parts[0], parts[1]
    except (ValueError, json.JSONDecodeError):
        pass
    return None


def _is_compose_thread_key(thread_id: str) -> bool:
    return isinstance(thread_id, str) and thread_id.startswith("compose:")


async def _get_inbound_ids_for_thread(thread_id: str, user_id: str) -> list:
    """Return list of inbound message ids belonging to this thread (for mark-as-read)."""
    legacy = _decode_legacy_thread_key(thread_id)
    if legacy:
        from_email, norm_subject = legacy
        from_regex = re.escape(from_email)
        all_inbounds = await db.inbound_messages.find(
            {"user_id": user_id, "from": {"$regex": from_regex, "$options": "i"}},
            {"_id": 0, "id": 1, "from": 1, "subject": 1},
        ).sort("received_at", 1).to_list(None)
        ids = []
        for m in all_inbounds:
            if _email_from_from(m.get("from") or "") != from_email:
                continue
            if _normalize_subject(m.get("subject") or "") != norm_subject:
                continue
            ids.append(m["id"])
        return ids
    cursor = db.inbound_messages.find(
        {"user_id": user_id, "$or": [{"thread_id": thread_id}, {"id": thread_id}]},
        {"_id": 0, "id": 1},
    )
    return [m["id"] for m in await cursor.to_list(None)]


@router.put("/inbox/received/thread/{thread_id}/read")
async def mark_received_thread_read(
    thread_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark all messages in a received thread as read."""
    if user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    if _is_compose_thread_key(thread_id):
        compose_result = await db.outbound_replies.delete_many(
            {"user_id": user_id, "thread_id": thread_id, "compose_email": True}
        )
        return {"message": "Thread deleted", "deleted_inbound": 0, "deleted_replies": compose_result.deleted_count}
    ids = await _get_inbound_ids_for_thread(thread_id, user_id)
    if not ids:
        return {"message": "Thread not found or already empty"}
    result = await db.inbound_messages.update_many(
        {"id": {"$in": ids}, "user_id": user_id},
        {"$set": {"is_read": True}},
    )
    return {"message": "Thread marked as read", "modified_count": result.modified_count}


@router.delete("/inbox/received/thread/{thread_id}")
async def delete_received_thread(
    thread_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete all messages (and replies) in a received thread."""
    if user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    ids = await _get_inbound_ids_for_thread(thread_id, user_id)
    if not ids:
        # Nothing to delete; treat as success so UI can clean up.
        return {"message": "Thread already deleted", "deleted_inbound": 0, "deleted_replies": 0}
    inbound_result = await db.inbound_messages.delete_many(
        {"id": {"$in": ids}, "user_id": user_id}
    )
    # Outbound replies are keyed by thread_id (not per-message id)
    replies_result = await db.outbound_replies.delete_many(
        {"user_id": user_id, "thread_id": thread_id}
    )
    return {
        "message": "Thread deleted",
        "deleted_inbound": inbound_result.deleted_count,
        "deleted_replies": replies_result.deleted_count,
    }


@router.get("/inbox/received/thread/{thread_id}")
async def get_received_thread(
    thread_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get full thread (inbound + outbound replies) in chronological order (Gmail-style)."""
    if user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")

    if _is_compose_thread_key(thread_id):
        compose = await db.outbound_replies.find_one(
            {"thread_id": thread_id, "user_id": user_id, "compose_email": True},
            {"_id": 0},
        )
        if not compose:
            return {"thread_id": thread_id, "messages": []}
        sent_at = compose.get("at")
        if isinstance(sent_at, datetime):
            sent_at = sent_at.isoformat()
        return {
            "thread_id": thread_id,
            "messages": [{
                "type": "outbound",
                "id": compose.get("id"),
                "thread_id": thread_id,
                "to": compose.get("to"),
                "subject": compose.get("subject"),
                "body": compose.get("body"),
                "at": sent_at,
                "compose_email": True,
            }],
        }

    legacy = _decode_legacy_thread_key(thread_id)
    if legacy:
        from_email, norm_subject = legacy
        # Find all inbounds with same from (email) and normalized subject.
        # First narrow down on the database side by user_id + from, then apply
        # the normalized-subject match in Python.
        from_regex = re.escape(from_email)
        all_inbounds = await db.inbound_messages.find(
            {"user_id": user_id, "from": {"$regex": from_regex, "$options": "i"}},
            {"_id": 0},
        ).sort("received_at", 1).to_list(None)
        inbounds = []
        for m in all_inbounds:
            if _email_from_from(m.get("from") or "") != from_email:
                continue
            if _normalize_subject(m.get("subject") or "") != norm_subject:
                continue
            inbounds.append(m)
        inbound_ids = [m["id"] for m in inbounds]
        outbounds = await db.outbound_replies.find(
            {"user_id": user_id, "thread_id": {"$in": inbound_ids}},
            {"_id": 0},
        ).sort("at", 1).to_list(None) if inbound_ids else []
    else:
        inbounds = await db.inbound_messages.find(
            {"user_id": user_id, "$or": [{"thread_id": thread_id}, {"id": thread_id}]},
            {"_id": 0},
        ).sort("received_at", 1).to_list(None)
        outbounds = await db.outbound_replies.find(
            {"user_id": user_id, "thread_id": thread_id},
            {"_id": 0},
        ).sort("at", 1).to_list(None)

    for m in inbounds:
        if isinstance(m.get("received_at"), datetime):
            m["received_at"] = m["received_at"].isoformat()
        body = m.get("body_text") or m.get("body_html") or ""
        m["preview"] = (body[:150] + "...") if len(body) > 150 else body
    await _enrich_inbound_warmup_flags(user_id, inbounds)
    for o in outbounds:
        if isinstance(o.get("at"), datetime):
            o["at"] = o["at"].isoformat()

    # Merge by time: inbound + outbound (outbound_replies already stores our replies)
    events = [{"type": "inbound", "at": e.get("received_at") or "", "payload": e} for e in inbounds]
    events += [{"type": "outbound", "at": o.get("at") or "", "payload": o} for o in outbounds]
    events.sort(key=lambda x: x["at"])
    messages = [{"type": e["type"], **e["payload"]} for e in events]
    return {"thread_id": thread_id, "messages": messages}


@router.get("/inbox/received/{message_id}")
async def get_received_email(
    message_id: str,
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single received email by id. Returns thread_id so client can load full thread."""
    if user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    doc = await db.inbound_messages.find_one({"id": message_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    if isinstance(doc.get("received_at"), datetime):
        doc["received_at"] = doc["received_at"].isoformat()
    body = doc.get("body_text") or doc.get("body_html") or ""
    doc["preview"] = (body[:150] + "...") if len(body) > 150 else body
    doc["thread_id"] = doc.get("thread_id") or doc["id"]
    return doc


@router.post("/inbox/received/{message_id}/reply")
async def reply_to_received(
    message_id: str,
    body: SendReceivedReplyRequest,
    current_user: dict = Depends(get_current_user),
):
    """Send a reply to a received (inbound) email."""
    if body.user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    svc = _get_email_service()
    try:
        result = await svc.send_reply_to_inbound(
            body.user_id, message_id, body.subject, body.body, body.cc
        )
        return result
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e
    except Exception as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.post("/inbox/compose")
async def send_compose(
    body: SendComposeRequest,
    current_user: dict = Depends(get_current_user),
):
    """Send a new (compose) email from an inbox (MailBox Write mail)."""
    if body.user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    svc = _get_email_service()
    try:
        result = await svc.send_compose(
            body.user_id,
            body.to_email,
            body.subject,
            body.body,
            body.inbox_id,
            body.cc,
        )
        return result
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e
    except Exception as e:
        msg = str(e)
        if "not found" in msg.lower() or "invalid" in msg.lower():
            raise HTTPException(status_code=400, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
