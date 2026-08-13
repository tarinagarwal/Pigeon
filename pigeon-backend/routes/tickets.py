"""Ticket (support) management routes for dashboard users."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from database import db
from models import Ticket, TicketComment
from routes.dependencies import get_current_user
from routes.schemas import CreateTicketRequest, UpdateTicketRequest, CreateTicketCommentRequest
from services.slack_service import notify_ticket_created

router = APIRouter()

VALID_STATUSES = {"open", "in_progress", "resolved", "closed"}
VALID_PRIORITIES = {"low", "medium", "high", "urgent"}


@router.get("/tickets")
async def list_tickets(
    status: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """List tickets for the current user."""
    query = {"user_id": current_user["id"]}
    if status and status in VALID_STATUSES:
        query["status"] = status
    tickets = (
        await db.tickets.find(query, {"_id": 0})
        .sort("updated_at", -1)
        .to_list(None)
    )
    return tickets


@router.post("/tickets")
async def create_ticket(
    payload: CreateTicketRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a new support ticket."""
    priority = (payload.priority or "medium").lower()
    if priority not in VALID_PRIORITIES:
        priority = "medium"
    now = datetime.now(timezone.utc)
    ticket = Ticket(
        user_id=current_user["id"],
        subject=payload.subject.strip(),
        description=payload.description.strip(),
        priority=priority,
        status="open",
        created_at=now,
        updated_at=now,
    )
    doc = ticket.model_dump()
    await db.tickets.insert_one(doc)
    doc.pop("_id", None)
    # Notify Slack (best-effort)
    await notify_ticket_created(
        ticket_id=ticket.id,
        subject=ticket.subject,
        description=ticket.description,
        priority=ticket.priority,
        user_id=current_user["id"],
        user_email=current_user.get("email"),
    )
    return doc


@router.get("/tickets/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single ticket (must belong to current user)."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    return ticket


@router.put("/tickets/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    payload: UpdateTicketRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update a ticket (user can update subject, description, priority; status limited)."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    updates = {"updated_at": datetime.now(timezone.utc)}
    if payload.subject is not None:
        updates["subject"] = payload.subject.strip()
    if payload.description is not None:
        updates["description"] = payload.description.strip()
    if payload.priority is not None:
        p = payload.priority.lower()
        updates["priority"] = p if p in VALID_PRIORITIES else ticket.get("priority", "medium")
    # Users can only set status to "closed" (or leave as-is); other statuses are admin-only
    if payload.status is not None:
        if payload.status.lower() == "closed":
            updates["status"] = "closed"
        # else: ignore invalid/restricted status change

    await db.tickets.update_one({"id": ticket_id}, {"$set": updates})
    updated = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    return updated


@router.delete("/tickets/{ticket_id}")
async def delete_ticket(
    ticket_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a ticket and its comments (only owner)."""
    ticket = await db.tickets.find_one({"id": ticket_id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    await db.tickets.delete_one({"id": ticket_id})
    await db.ticket_comments.delete_many({"ticket_id": ticket_id})
    return {"deleted": True}


@router.get("/tickets/{ticket_id}/comments")
async def list_ticket_comments(
    ticket_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List comments for a ticket (only if user owns the ticket)."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    comments = (
        await db.ticket_comments.find({"ticket_id": ticket_id}, {"_id": 0})
        .sort("created_at", 1)
        .to_list(None)
    )
    return comments


@router.post("/tickets/{ticket_id}/comments")
async def add_ticket_comment(
    ticket_id: str,
    payload: CreateTicketCommentRequest,
    current_user: dict = Depends(get_current_user),
):
    """Add a comment to a ticket (as the ticket owner)."""
    ticket = await db.tickets.find_one({"id": ticket_id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Comment body is required")

    now = datetime.now(timezone.utc)
    comment = TicketComment(
        ticket_id=ticket_id,
        author_id=current_user["id"],
        author_type="user",
        body=body,
        created_at=now,
    )
    doc = comment.model_dump()
    await db.ticket_comments.insert_one(doc)
    # Bump ticket updated_at
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$set": {"updated_at": now}},
    )
    doc.pop("_id", None)
    return doc
