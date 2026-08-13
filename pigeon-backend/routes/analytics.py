"""Analytics routes"""
from fastapi import APIRouter, Query
from typing import Optional
from datetime import datetime, timedelta, timezone

from database import db
from models import AnalyticsData

router = APIRouter(prefix="/analytics", tags=["analytics"])

@router.get("")
async def get_analytics(user_id: str, campaign_id: Optional[str] = None, days: int = 7):
    """Get analytics data with period-over-period comparison (single aggregation)."""
    now = datetime.now(timezone.utc)
    current_start = now - timedelta(days=days)
    previous_start = current_start - timedelta(days=days)

    match: dict = {
        "user_id": user_id,
        "sent_at": {"$gte": previous_start},
    }
    if campaign_id:
        match["campaign_id"] = campaign_id

    pipeline = [
        {"$match": match},
        {
            "$addFields": {
                "period": {
                    "$cond": [
                        {"$gte": ["$sent_at", current_start]},
                        "current",
                        "previous",
                    ]
                },
            }
        },
        {
            "$group": {
                "_id": "$period",
                "sent": {"$sum": {"$cond": [{"$ne": ["$status", "pending"]}, 1, 0]}},
                "failed": {"$sum": {"$cond": [{"$eq": ["$status", "failed"]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [{"$eq": ["$status", "pending"]}, 1, 0]}},
                "opened": {"$sum": {"$cond": [{"$in": ["$status", ["opened", "clicked", "replied"]]}, 1, 0]}},
                "clicked": {"$sum": {"$cond": [{"$in": ["$status", ["clicked", "replied"]]}, 1, 0]}},
                "replied": {"$sum": {"$cond": [{"$eq": ["$status", "replied"]}, 1, 0]}},
            }
        },
    ]
    rows = await db.email_logs.aggregate(pipeline).to_list(None)
    by_period = {r["_id"]: r for r in rows}

    cur = by_period.get("current", {})
    prev = by_period.get("previous", {})

    total_sent = cur.get("sent", 0)
    total_failed = cur.get("failed", 0)
    total_delivered = total_sent - total_failed
    total_pending = cur.get("pending", 0)
    total_opened = cur.get("opened", 0)
    total_clicked = cur.get("clicked", 0)
    total_replied = cur.get("replied", 0)

    prev_sent = prev.get("sent", 0)
    prev_failed = prev.get("failed", 0)
    prev_opened = prev.get("opened", 0)
    prev_clicked = prev.get("clicked", 0)
    prev_replied = prev.get("replied", 0)
    
    # Calculate rates
    open_rate = round((total_opened / total_sent * 100) if total_sent > 0 else 0, 2)
    click_rate = round((total_clicked / total_sent * 100) if total_sent > 0 else 0, 2)
    reply_rate = round((total_replied / total_sent * 100) if total_sent > 0 else 0, 2)
    
    prev_open_rate = round((prev_opened / prev_sent * 100) if prev_sent > 0 else 0, 2)
    prev_click_rate = round((prev_clicked / prev_sent * 100) if prev_sent > 0 else 0, 2)
    prev_reply_rate = round((prev_replied / prev_sent * 100) if prev_sent > 0 else 0, 2)
    prev_delivered = prev_sent - prev_failed
    prev_deliverability_rate = round((prev_delivered / prev_sent * 100) if prev_sent > 0 else 0, 2)
    deliverability_rate = round((total_delivered / total_sent * 100) if total_sent > 0 else 0, 2)
    
    # Calculate percentage changes
    def calc_change(current: float, previous: float) -> float:
        if previous == 0:
            return 100.0 if current > 0 else 0.0
        return round(((current - previous) / previous * 100), 1)
    
    analytics = {
        "total_sent": total_sent,
        "total_failed": total_failed,
        "total_delivered": total_delivered,
        "total_pending": total_pending,
        "total_opened": total_opened,
        "total_clicked": total_clicked,
        "total_replied": total_replied,
        "open_rate": open_rate,
        "click_rate": click_rate,
        "reply_rate": reply_rate,
        "deliverability_rate": deliverability_rate,
        "sent_change": calc_change(total_sent, prev_sent),
        "open_rate_change": calc_change(open_rate, prev_open_rate),
        "click_rate_change": calc_change(click_rate, prev_click_rate),
        "reply_rate_change": calc_change(reply_rate, prev_reply_rate),
        "deliverability_rate_change": calc_change(deliverability_rate, prev_deliverability_rate),
    }
    
    return analytics

@router.get("/timeline")
async def get_analytics_timeline(user_id: str, days: int = 7, campaign_id: Optional[str] = None):
    """Get analytics timeline for charts"""
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    match = {"user_id": user_id, "sent_at": {"$gte": start_date}}
    if campaign_id:
        match["campaign_id"] = campaign_id

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": {
                    "$dateToString": {
                        "format": "%Y-%m-%d",
                        "date": "$sent_at"
                    }
                },
                "sent": {"$sum": 1},
                "opened": {
                    "$sum": {
                        "$cond": [{"$in": ["$status", ["opened", "clicked", "replied"]]}, 1, 0]
                    }
                },
                "clicked": {
                    "$sum": {
                        "$cond": [{"$in": ["$status", ["clicked", "replied"]]}, 1, 0]
                    }
                },
                "replied": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "replied"]}, 1, 0]
                    }
                }
            }
        },
        {"$sort": {"_id": 1}}
    ]
    
    timeline = await db.email_logs.aggregate(pipeline).to_list(None)
    return timeline

@router.get("/email-logs")
async def get_email_logs(
    user_id: str,
    campaign_id: Optional[str] = None,
    skip: int = 0,
    limit: int = 50
):
    """Get email logs"""
    query = {"user_id": user_id}
    if campaign_id:
        query["campaign_id"] = campaign_id
    
    logs = await db.email_logs.find(
        query,
        {"_id": 0}
    ).sort("created_at", -1).skip(skip).limit(limit).to_list(None)
    
    total = await db.email_logs.count_documents(query)
    
    return {"logs": logs, "total": total}


@router.get("/activity")
async def get_user_activity(user_id: str, limit: int = 10):
    """Get user activity feed showing recent actions and events"""
    from datetime import datetime, timedelta, timezone
    import json
    
    # Get recent campaigns created/updated
    recent_campaigns = await db.campaigns.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "name": 1, "created_at": 1, "updated_at": 1, "status": 1}
    ).sort("created_at", -1).limit(limit).to_list(None)
    
    # Get recent contacts added
    recent_contacts = await db.contacts.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "created_at": 1}
    ).sort("created_at", -1).limit(limit).to_list(None)
    
    # Get recent domains added
    recent_domains = await db.domains.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "domain": 1, "created_at": 1, "verified": 1}
    ).sort("created_at", -1).limit(limit).to_list(None)
    
    # Get recent inboxes added
    recent_inboxes = await db.inboxes.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "email": 1, "created_at": 1}
    ).sort("created_at", -1).limit(limit).to_list(None)
    
    # Get recent email logs (email_logs have contact_id, not recipient_email)
    recent_emails = await db.email_logs.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "contact_id": 1, "subject": 1, "status": 1, "sent_at": 1, "created_at": 1}
    ).sort("created_at", -1).limit(limit).to_list(None)
    
    # Resolve contact_id -> email for description
    contact_ids = list({e.get("contact_id") for e in recent_emails if e.get("contact_id")})
    contacts_list = await db.contacts.find(
        {"id": {"$in": contact_ids}},
        {"_id": 0, "id": 1, "email": 1}
    ).to_list(None) if contact_ids else []
    contact_email_map = {c["id"]: c.get("email", "—") for c in contacts_list}
    
    # Combine all activities and create activity feed
    activities = []
    
    # Add campaign activities
    for campaign in recent_campaigns[:3]:
        activities.append({
            "id": f"campaign_{campaign['id']}",
            "type": "campaign",
            "title": f"Campaign '{campaign['name']}' created",
            "description": f"Campaign status: {campaign['status']}",
            "timestamp": campaign.get('created_at') or campaign.get('updated_at'),
            "icon": "mail"
        })
    
    # Add contact activities
    for contact in recent_contacts[:3]:
        activities.append({
            "id": f"contact_{contact['id']}",
            "type": "contact",
            "title": f"Contact '{contact.get('name', contact['email'])}' added",
            "description": f"Added to your contact list",
            "timestamp": contact['created_at'],
            "icon": "users"
        })
    
    # Add domain activities
    for domain in recent_domains[:2]:
        status = "verified" if domain.get('verified') else "added"
        activities.append({
            "id": f"domain_{domain['id']}",
            "type": "domain",
            "title": f"Domain '{domain['domain']}' {status}",
            "description": f"Domain {status} successfully",
            "timestamp": domain['created_at'],
            "icon": "server"
        })
    
    # Add inbox activities
    for inbox in recent_inboxes[:2]:
        activities.append({
            "id": f"inbox_{inbox['id']}",
            "type": "inbox",
            "title": f"Inbox '{inbox['email']}' connected",
            "description": f"Email account connected",
            "timestamp": inbox['created_at'],
            "icon": "mail"
        })
    
    # Add email sent activities
    for email in recent_emails[:3]:
        status_display = {
            "sent": "Email sent",
            "delivered": "Email delivered",
            "opened": "Email opened",
            "clicked": "Email clicked",
            "replied": "Email replied"
        }.get(email['status'], f"Email {email['status']}")
        
        recipient = email.get("recipient_email") or contact_email_map.get(email.get("contact_id"), "—")
        activities.append({
            "id": f"email_{email['id']}",
            "type": "email",
            "title": status_display,
            "description": f"To: {recipient}",
            "timestamp": email.get('sent_at') or email.get('created_at'),
            "icon": "send"
        })
    
    # Sort activities by timestamp descending
    activities.sort(key=lambda x: x['timestamp'], reverse=True)
    
    # Return only the most recent activities up to the limit
    return {"activities": activities[:limit]}


# --- Sending behavior / Tracking ---

@router.get("/sending-hourly")
async def get_sending_by_hour(user_id: str, days: int = 7):
    """Sending volume by hour of day (0-23) over the period. UTC."""
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    pipeline = [
        {"$match": {"user_id": user_id, "sent_at": {"$gte": start_date}, "status": {"$ne": "pending"}}},
        {"$group": {"_id": {"$hour": "$sent_at"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}}
    ]
    raw = await db.email_logs.aggregate(pipeline).to_list(None)
    # Fill missing hours with 0
    by_hour = {r["_id"]: r["count"] for r in raw}
    return [{"hour": h, "count": by_hour.get(h, 0)} for h in range(24)]


@router.get("/sending-by-inbox")
async def get_sending_by_inbox(user_id: str, days: int = 7):
    """Sending volume per inbox (sender_id). Resolve inbox email for display."""
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    pipeline = [
        {"$match": {"user_id": user_id, "sent_at": {"$gte": start_date}, "status": {"$ne": "pending"}}},
        {"$group": {"_id": {"$ifNull": ["$sender_id", "unknown"]}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    rows = await db.email_logs.aggregate(pipeline).to_list(None)
    sender_ids = [r["_id"] for r in rows if r["_id"] != "unknown"]
    inboxes = await db.inboxes.find(
        {"id": {"$in": sender_ids}, "user_id": user_id},
        {"_id": 0, "id": 1, "email": 1}
    ).to_list(None) if sender_ids else []
    inbox_map = {i["id"]: i.get("email", i["id"]) for i in inboxes}
    return [
        {
            "sender_id": r["_id"],
            "email": inbox_map.get(r["_id"], "Inbox deleted" if r["_id"] != "unknown" else "Unknown"),
            "count": r["count"]
        }
        for r in rows
    ]


@router.get("/sending-by-campaign")
async def get_sending_by_campaign(user_id: str, days: int = 7):
    """Sending volume per campaign. Resolve campaign name for display."""
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    pipeline = [
        {"$match": {"user_id": user_id, "sent_at": {"$gte": start_date}, "status": {"$ne": "pending"}}},
        {"$group": {"_id": "$campaign_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    rows = await db.email_logs.aggregate(pipeline).to_list(None)
    campaign_ids = [r["_id"] for r in rows if r["_id"]]
    campaigns = await db.campaigns.find(
        {"id": {"$in": campaign_ids}, "user_id": user_id},
        {"_id": 0, "id": 1, "name": 1}
    ).to_list(None) if campaign_ids else []
    campaign_map = {c["id"]: c.get("name", c["id"]) for c in campaigns}
    return [
        {
            "campaign_id": r["_id"],
            "name": campaign_map.get(r["_id"], "Campaign deleted" if r["_id"] else "Unknown"),
            "count": r["count"]
        }
        for r in rows
    ]


@router.get("/sending-insights")
async def get_sending_insights(user_id: str, days: int = 7):
    """Summary insights for sending behavior: total sent, peak hour, top inbox, top campaign."""
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    total_sent = await db.email_logs.count_documents(
        {"user_id": user_id, "sent_at": {"$gte": start_date}, "status": {"$ne": "pending"}}
    )
    # Peak hour
    pipeline_hour = [
        {"$match": {"user_id": user_id, "sent_at": {"$gte": start_date}, "status": {"$ne": "pending"}}},
        {"$group": {"_id": {"$hour": "$sent_at"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 1}
    ]
    peak = await db.email_logs.aggregate(pipeline_hour).to_list(None)
    peak_hour = peak[0]["_id"] if peak else None
    # Top inbox
    pipeline_inbox = [
        {"$match": {"user_id": user_id, "sent_at": {"$gte": start_date}, "status": {"$ne": "pending"}}},
        {"$group": {"_id": {"$ifNull": ["$sender_id", "unknown"]}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 1}
    ]
    top_inbox_row = await db.email_logs.aggregate(pipeline_inbox).to_list(None)
    top_sender_id = top_inbox_row[0]["_id"] if top_inbox_row and top_inbox_row[0]["_id"] != "unknown" else None
    top_inbox_email = None
    if top_sender_id:
        inbox = await db.inboxes.find_one({"id": top_sender_id, "user_id": user_id}, {"_id": 0, "email": 1})
        top_inbox_email = inbox.get("email", top_sender_id) if inbox else "Inbox deleted"
    # Top campaign
    pipeline_camp = [
        {"$match": {"user_id": user_id, "sent_at": {"$gte": start_date}, "status": {"$ne": "pending"}}},
        {"$group": {"_id": "$campaign_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 1}
    ]
    top_camp_row = await db.email_logs.aggregate(pipeline_camp).to_list(None)
    top_campaign_id = top_camp_row[0]["_id"] if top_camp_row and top_camp_row[0]["_id"] else None
    top_campaign_name = None
    if top_campaign_id:
        camp = await db.campaigns.find_one({"id": top_campaign_id, "user_id": user_id}, {"_id": 0, "name": 1})
        top_campaign_name = camp.get("name", top_campaign_id) if camp else "Campaign deleted"
    return {
        "total_sent": total_sent,
        "peak_hour_utc": peak_hour,
        "top_inbox_email": top_inbox_email,
        "top_campaign_name": top_campaign_name,
    }


@router.get("/best-send-time")
async def get_best_send_time(
    user_id: str,
    tz: str = Query("America/New_York", description="Timezone for send window (e.g. America/New_York)", alias="timezone"),
    days: int = Query(30, ge=7, le=365),
    campaign_id: Optional[str] = None,
):
    """Best time to send based on open rate by hour in the given timezone.
    Analyzes when emails were sent (in that TZ) and their open rates; returns the hour with highest open rate.
    """
    from zoneinfo import ZoneInfo

    tz_name = (tz or "America/New_York").strip()
    try:
        ZoneInfo(tz_name)
    except Exception:
        return {
            "best_hour": None,
            "best_hour_label": None,
            "open_rate": None,
            "based_on_sent": 0,
            "message": "Invalid timezone.",
            "top_hours": [],
        }

    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=days)
    match = {"user_id": user_id, "sent_at": {"$gte": start_date}, "status": {"$ne": "pending"}}
    if campaign_id:
        match["campaign_id"] = campaign_id

    # Group by hour in the given timezone; MongoDB $dateToString supports timezone
    pipeline = [
        {"$match": match},
        {
            "$addFields": {
                "local_hour": {"$toInt": {"$dateToString": {"format": "%H", "date": "$sent_at", "timezone": tz_name}}},
                "opened": {"$in": ["$status", ["opened", "clicked", "replied"]]},
            }
        },
        {"$group": {"_id": "$local_hour", "sent": {"$sum": 1}, "opened": {"$sum": {"$cond": ["$opened", 1, 0]}}}},
        {"$match": {"sent": {"$gte": 3}}},  # at least 3 sends for that hour to be meaningful
        {"$addFields": {"open_rate": {"$round": [{"$multiply": [{"$divide": ["$opened", "$sent"]}, 100]}, 1]}}},
        {"$sort": {"open_rate": -1, "sent": -1}},
        {"$limit": 5},
    ]
    rows = await db.email_logs.aggregate(pipeline).to_list(None)

    if not rows:
        # Fallback: same aggregation without min sent filter to get any suggestion
        pipeline_fallback = [
            {"$match": match},
            {
                "$addFields": {
                    "local_hour": {"$toInt": {"$dateToString": {"format": "%H", "date": "$sent_at", "timezone": tz_name}}},
                    "opened": {"$in": ["$status", ["opened", "clicked", "replied"]]},
                }
            },
            {"$group": {"_id": "$local_hour", "sent": {"$sum": 1}, "opened": {"$sum": {"$cond": ["$opened", 1, 0]}}}},
            {"$addFields": {"open_rate": {"$round": [{"$multiply": [{"$divide": ["$opened", "$sent"]}, 100]}, 1]}}},
            {"$sort": {"open_rate": -1, "sent": -1}},
            {"$limit": 5},
        ]
        rows = await db.email_logs.aggregate(pipeline_fallback).to_list(None)

    if not rows:
        return {
            "best_hour": None,
            "best_hour_label": None,
            "open_rate": None,
            "based_on_sent": 0,
            "message": "Not enough sent emails yet. Send more campaigns to see the best time to send based on open rates.",
            "top_hours": [],
        }

    best = rows[0]
    hour = best["_id"]
    # Format as 9:00 AM style
    best_hour_label = f"{((hour % 12) or 12)}:00 {'AM' if hour < 12 else 'PM'}"
    total_sent_for_best = await db.email_logs.count_documents(match)
    top_hours = [
        {
            "hour": r["_id"],
            "label": f"{((r['_id'] % 12) or 12)}:00 {'AM' if r['_id'] < 12 else 'PM'}",
            "open_rate": r["open_rate"],
            "sent": r["sent"],
        }
        for r in rows
    ]
    return {
        "best_hour": hour,
        "best_hour_label": best_hour_label,
        "open_rate": best["open_rate"],
        "based_on_sent": best["sent"],
        "message": f"Based on your open rates in {tz_name} over the last {days} days, sending around {best_hour_label} performs best ({best['open_rate']}% open rate from {best['sent']} emails).",
        "top_hours": top_hours,
    }
