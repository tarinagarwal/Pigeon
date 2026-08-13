"""Contact lists management routes"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from typing import List

from database import db
from routes.dependencies import get_current_user
from routes.schemas import CreateContactListRequest, AddContactsToListRequest, UpdateContactListRequest
from config import BLOCK_AFTER_EMAILS

router = APIRouter()


async def _raise_if_list_used_by_active_campaign(list_id: str) -> None:
    """Raise HTTP 400 if this list is used by any active campaign."""
    active = await db.campaigns.find_one(
        {"status": "active", "contact_list_ids": list_id},
        {"id": 1}
    )
    if active:
        raise HTTPException(
            status_code=400,
            detail="This list is used by an active campaign. Stop the campaign to edit the list.",
        )


async def raise_if_any_list_used_by_active_campaign(list_ids: List[str]) -> None:
    """Raise HTTP 400 if any of these list ids are used by an active campaign."""
    if not list_ids:
        return
    active = await db.campaigns.find_one(
        {"status": "active", "contact_list_ids": {"$in": list_ids}},
        {"id": 1}
    )
    if active:
        raise HTTPException(
            status_code=400,
            detail="A contact list in use by an active campaign would be changed. Stop the campaign first.",
        )

@router.post("/contact-lists")
async def create_contact_list(request: CreateContactListRequest, current_user: dict = Depends(get_current_user)):
    """Create a contact list"""
    if request.user_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    contact_list = {
        "id": str(uuid.uuid4()),
        "user_id": current_user["id"],
        "name": request.name,
        "description": request.description,
        "contact_ids": request.contact_ids or [],
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc)
    }
    await db.contact_lists.insert_one(contact_list)
    # Remove MongoDB _id before returning
    contact_list.pop("_id", None)
    return contact_list

@router.get("/contact-lists")
async def get_contact_lists(current_user: dict = Depends(get_current_user)):
    """Get all contact lists for user"""
    user_id = current_user["id"]
    lists = await db.contact_lists.find(
        {"user_id": user_id},
        {"_id": 0}
    ).to_list(None)
    
    # Add contact count to each list
    for lst in lists:
        lst["contact_count"] = len(lst.get("contact_ids", []))
    
    return lists

@router.put("/contact-lists/{list_id}")
async def update_contact_list(list_id: str, request: UpdateContactListRequest, current_user: dict = Depends(get_current_user)):
    """Update a contact list. Blocked if list is used by an active campaign."""
    existing = await db.contact_lists.find_one({"id": list_id}, {"user_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Contact list not found")
    if existing.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    await _raise_if_list_used_by_active_campaign(list_id)
    update_data = {"updated_at": datetime.now(timezone.utc)}

    if request.name is not None:
        update_data["name"] = request.name
    if request.description is not None:
        update_data["description"] = request.description
    if request.contact_ids is not None:
        update_data["contact_ids"] = request.contact_ids

    result = await db.contact_lists.update_one(
        {"id": list_id, "user_id": current_user["id"]},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Contact list not found")
    
    return {"message": "Contact list updated"}

@router.post("/contact-lists/{list_id}/contacts")
async def add_contacts_to_list(list_id: str, request: AddContactsToListRequest, current_user: dict = Depends(get_current_user)):
    """Add contacts to a list. Blocked if list is used by an active campaign."""
    existing = await db.contact_lists.find_one({"id": list_id}, {"user_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Contact list not found")
    if existing.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    await _raise_if_list_used_by_active_campaign(list_id)
    await db.contact_lists.update_one(
        {"id": list_id, "user_id": current_user["id"]},
        {"$addToSet": {"contact_ids": {"$each": request.contact_ids}}}
    )
    return {"message": f"{len(request.contact_ids)} contacts added to list"}

@router.delete("/contact-lists/{list_id}")
async def delete_contact_list(list_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a contact list. Blocked if list is used by an active campaign."""
    existing = await db.contact_lists.find_one({"id": list_id}, {"user_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Contact list not found")
    if existing.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    await _raise_if_list_used_by_active_campaign(list_id)
    await db.contact_lists.delete_one({"id": list_id, "user_id": current_user["id"]})
    return {"message": "Contact list deleted"}

VERIFIED_STATUSES = ["opened", "clicked", "replied"]


@router.get("/contact-lists/{list_id}/audience-preview")
async def get_audience_preview(list_id: str, current_user: dict = Depends(get_current_user)):
    """Get audience breakdown: total, verified, duplicates_removed, pending, blocked."""
    user_id = current_user["id"]
    contact_list = await db.contact_lists.find_one({"id": list_id}, {"_id": 0})
    if not contact_list:
        raise HTTPException(status_code=404, detail="Contact list not found")
    if contact_list.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    contact_ids = contact_list.get("contact_ids", [])
    if not contact_ids:
        return {
            "total_contacts": 0,
            "verified": 0,
            "duplicates_removed": 0,
            "pending": 0,
            "blocked": 0,
        }
    # Fetch contacts (same user) for list ids
    contacts = await db.contacts.find(
        {"id": {"$in": contact_ids}, "user_id": user_id},
        {"_id": 0, "id": 1, "email": 1, "status": 1, "manual_unblock": 1},
    ).to_list(None)
    contact_by_id = {c["id"]: c for c in contacts}
    # Dedupe by email: keep first occurrence
    seen_emails = set()
    unique_contacts = []
    duplicates_removed = 0
    for cid in contact_ids:
        c = contact_by_id.get(cid)
        if not c:
            continue
        email = (c.get("email") or "").strip().lower()
        if email in seen_emails:
            duplicates_removed += 1
            continue
        seen_emails.add(email)
        unique_contacts.append(c)
    # Global email count per contact_id (successfully sent: sent, opened, clicked, replied)
    unique_ids = [c["id"] for c in unique_contacts]
    pipeline = [
        {"$match": {"user_id": user_id, "contact_id": {"$in": unique_ids}, "status": {"$in": ["sent", "opened", "clicked", "replied"]}}},
        {"$group": {"_id": "$contact_id", "count": {"$sum": 1}}},
    ]
    counts_cursor = await db.email_logs.aggregate(pipeline).to_list(None)
    global_sent = {x["_id"]: x["count"] for x in counts_cursor}
    verified = pending = blocked = 0
    for c in unique_contacts:
        cid = c["id"]
        status = (c.get("status") or "pending").lower()
        sent_count = global_sent.get(cid, 0)
        manual_unblock = c.get("manual_unblock", False)

        if status == "unsubscribed":
            blocked += 1
        elif status in VERIFIED_STATUSES:
            verified += 1
        else:
            # Manually unblocked contacts count as pending (not blocked)
            if manual_unblock:
                pending += 1
            elif sent_count >= BLOCK_AFTER_EMAILS:
                blocked += 1
            else:
                pending += 1
    return {
        "total_contacts": len(unique_contacts),
        "verified": verified,
        "duplicates_removed": duplicates_removed,
        "pending": pending,
        "blocked": blocked,
    }


@router.get("/contact-lists/{list_id}/contacts")
async def get_contacts_in_list(list_id: str, skip: int = 0, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Get all contacts in a specific contact list"""
    # Get the contact list
    contact_list = await db.contact_lists.find_one({"id": list_id}, {"_id": 0})
    if not contact_list:
        raise HTTPException(status_code=404, detail="Contact list not found")
    if contact_list.get("user_id") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Access denied")

    contact_ids = contact_list.get("contact_ids", [])
    
    # Get contacts by IDs (scoped to current user)
    contacts = await db.contacts.find(
        {"id": {"$in": contact_ids}, "user_id": current_user["id"]},
        {"_id": 0}
    ).skip(skip).limit(limit).to_list(None)
    
    return {
        "contacts": contacts,
        "total": len(contact_ids),
        "list_name": contact_list.get("name")
    }
