"""Mailbox-scoped API: same as inbox received/compose but authenticated by mailbox login (inbox email + password)."""
from fastapi import APIRouter, Query, HTTPException, Depends, Request
from fastapi.encoders import jsonable_encoder
from typing import Optional
from datetime import datetime, timezone
from starlette.responses import JSONResponse

from database import db
from routes.dependencies import get_current_mailbox
from routes.schemas import SendReceivedReplyRequest, SendComposeRequest
from services.plan_service import MonthlySmtpQuotaExceeded

# Reuse inbox_emails helpers (thread keying, etag, etc.)
from routes.inbox_emails import (
    _etag_for_payload,
    _maybe_304,
    _legacy_thread_key,
    _decode_legacy_thread_key,
    _is_compose_thread_key,
    _get_inbound_ids_for_thread,
    _get_email_service,
    _enrich_inbound_warmup_flags,
    _INBOUND_LIST_PROJECTION,
    _COMPOSE_LIST_PROJECTION,
    _message_preview,
    _batch_threads_warmup_flags,
    _list_received_threads,
)

router = APIRouter(prefix="/mailbox", tags=["mailbox"])


@router.get("/me")
async def mailbox_me(current_mailbox: dict = Depends(get_current_mailbox)):
    """Return current mailbox (inbox) and user_id for the logged-in mailbox session."""
    user_id = current_mailbox.pop("_user_id", None)
    return {"inbox": current_mailbox, "user_id": user_id}


@router.get("/received")
async def mailbox_get_received(
    request: Request,
    current_mailbox: dict = Depends(get_current_mailbox),
    domain_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List received email threads for this mailbox only."""
    user_id = current_mailbox["_user_id"]
    inbox_id = current_mailbox["id"]
    query = {"user_id": user_id, "inbox_id": inbox_id}
    if domain_id:
        query["domain_id"] = domain_id

    items, has_more = await _list_received_threads(
        user_id,
        query,
        inbox_id=inbox_id,
        valid_inbox_ids={inbox_id},
        offset=offset,
        limit=limit,
        unread_only=False,
    )
    payload = {"threads": items, "has_more": has_more}
    etag = _etag_for_payload(items)
    not_modified = _maybe_304(request, etag)
    if not_modified is not None:
        return not_modified
    return JSONResponse(content=jsonable_encoder(payload), headers={"ETag": f'"{etag}"'})


@router.put("/received/thread/{thread_id}/read")
async def mailbox_mark_thread_read(
    thread_id: str,
    current_mailbox: dict = Depends(get_current_mailbox),
):
    """Mark all messages in a received thread as read."""
    user_id = current_mailbox["_user_id"]
    inbox_id = current_mailbox["id"]
    ids = await _get_inbound_ids_for_thread(thread_id, user_id)
    if not ids:
        return {"message": "Thread not found or already empty"}
    result = await db.inbound_messages.update_many(
        {"id": {"$in": ids}, "user_id": user_id, "inbox_id": inbox_id},
        {"$set": {"is_read": True}},
    )
    return {"message": "Thread marked as read", "modified_count": result.modified_count}


@router.delete("/received/thread/{thread_id}")
async def mailbox_delete_thread(
    thread_id: str,
    current_mailbox: dict = Depends(get_current_mailbox),
):
    """Delete all messages in a received thread."""
    user_id = current_mailbox["_user_id"]
    inbox_id = current_mailbox["id"]
    if _is_compose_thread_key(thread_id):
        compose_result = await db.outbound_replies.delete_many(
            {"user_id": user_id, "inbox_id": inbox_id, "thread_id": thread_id, "compose_email": True}
        )
        return {"message": "Thread deleted", "deleted_inbound": 0, "deleted_replies": compose_result.deleted_count}
    ids = await _get_inbound_ids_for_thread(thread_id, user_id)
    if not ids:
        return {"message": "Thread already deleted", "deleted_inbound": 0, "deleted_replies": 0}
    inbound_result = await db.inbound_messages.delete_many(
        {"id": {"$in": ids}, "user_id": user_id, "inbox_id": inbox_id}
    )
    replies_result = await db.outbound_replies.delete_many(
        {"user_id": user_id, "thread_id": thread_id}
    )
    return {
        "message": "Thread deleted",
        "deleted_inbound": inbound_result.deleted_count,
        "deleted_replies": replies_result.deleted_count,
    }


@router.get("/received/thread/{thread_id}")
async def mailbox_get_thread(
    thread_id: str,
    current_mailbox: dict = Depends(get_current_mailbox),
):
    """Get full thread (inbound + outbound) for this mailbox."""
    user_id = current_mailbox["_user_id"]
    if _is_compose_thread_key(thread_id):
        compose = await db.outbound_replies.find_one(
            {
                "thread_id": thread_id,
                "user_id": user_id,
                "inbox_id": current_mailbox["id"],
                "compose_email": True,
            },
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
        all_inbounds = await db.inbound_messages.find(
            {"user_id": user_id, "inbox_id": current_mailbox["id"]},
            {"_id": 0},
        ).sort("received_at", 1).to_list(None)
        inbounds = []
        from routes.inbox_emails import _normalize_subject, _email_from_from
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
            {"user_id": user_id, "inbox_id": current_mailbox["id"], "$or": [{"thread_id": thread_id}, {"id": thread_id}]},
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
    events = [{"type": "inbound", "at": e.get("received_at") or "", "payload": e} for e in inbounds]
    events += [{"type": "outbound", "at": o.get("at") or "", "payload": o} for o in outbounds]
    events.sort(key=lambda x: x["at"])
    messages = [{"type": e["type"], **e["payload"]} for e in events]
    return {"thread_id": thread_id, "messages": messages}


@router.get("/received/{message_id}")
async def mailbox_get_received_email(
    message_id: str,
    current_mailbox: dict = Depends(get_current_mailbox),
):
    """Get a single received email by id."""
    user_id = current_mailbox["_user_id"]
    inbox_id = current_mailbox["id"]
    doc = await db.inbound_messages.find_one(
        {"id": message_id, "user_id": user_id, "inbox_id": inbox_id},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")
    if isinstance(doc.get("received_at"), datetime):
        doc["received_at"] = doc["received_at"].isoformat()
    body = doc.get("body_text") or doc.get("body_html") or ""
    doc["preview"] = (body[:150] + "...") if len(body) > 150 else body
    doc["thread_id"] = doc.get("thread_id") or doc["id"]
    return doc


@router.post("/received/{message_id}/reply")
async def mailbox_reply_to_received(
    message_id: str,
    body: SendReceivedReplyRequest,
    current_mailbox: dict = Depends(get_current_mailbox),
):
    """Send a reply to a received email from this mailbox."""
    user_id = current_mailbox["_user_id"]
    if body.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    svc = _get_email_service()
    try:
        result = await svc.send_reply_to_inbound(
            user_id, message_id, body.subject, body.body, body.cc
        )
        return result
    except MonthlySmtpQuotaExceeded as e:
        raise HTTPException(status_code=403, detail=e.message) from e
    except Exception as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.post("/compose")
async def mailbox_compose(
    body: SendComposeRequest,
    current_mailbox: dict = Depends(get_current_mailbox),
):
    """Send a new email from this mailbox (compose)."""
    user_id = current_mailbox["_user_id"]
    inbox_id = current_mailbox["id"]
    if body.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    svc = _get_email_service()
    try:
        result = await svc.send_compose(
            user_id,
            body.to_email,
            body.subject,
            body.body,
            body.inbox_id or inbox_id,
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
