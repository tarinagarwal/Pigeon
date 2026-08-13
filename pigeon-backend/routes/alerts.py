"""Alerts routes"""
from fastapi import APIRouter, Query, HTTPException
from datetime import datetime, timezone

from database import db

router = APIRouter()


def _parse_dt(value):
    """Return timezone-aware UTC datetime from string/datetime, or None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if isinstance(value, str):
        try:
            from dateutil import parser
            dt = parser.parse(value)
            return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
        except Exception:
            return None
    return None


def _to_utc_aware(dt):
    """Normalize to timezone-aware UTC for sorting. Handles None/naive/aware (naive and aware can't be compared)."""
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if isinstance(dt, datetime):
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return datetime.min.replace(tzinfo=timezone.utc)


def _alert_time_from_entity(entity: dict, *, fallback=None):
    """Use entity's updated_at or created_at as alert time; fallback to now if missing."""
    fallback = fallback or datetime.now(timezone.utc)
    for key in ("updated_at", "created_at"):
        dt = _parse_dt(entity.get(key))
        if dt is not None:
            return dt
    return fallback


@router.get("/alerts")
async def get_alerts(user_id: str):
    """Get alerts for user based on domain health, bounce rates, warmup completions, campaign milestones, and admin-created alerts"""
    alerts = []

    # Fetch dismissed alert IDs (for dynamic alerts that are not in db.alerts)
    dismissed_cursor = db.alert_dismissed.find({"user_id": user_id}, {"_id": 0, "alert_id": 1})
    dismissed_ids = {doc["alert_id"] async for doc in dismissed_cursor}

    # Fetch admin-created alerts from database
    db_alerts = await db.alerts.find({"user_id": user_id}, {"_id": 0}).to_list(None)
    for db_alert in db_alerts:
        if db_alert.get("id") in dismissed_ids:
            continue
        # Ensure time and created_at are timezone-aware UTC datetimes (required for sort)
        parsed = _parse_dt(db_alert.get("time"))
        db_alert["time"] = parsed if parsed is not None else datetime.now(timezone.utc)
        parsed = _parse_dt(db_alert.get("created_at"))
        db_alert["created_at"] = parsed if parsed is not None else db_alert["time"]
        alerts.append(db_alert)
    
    # Check domain health scores (stable id so dismiss/mark-read persists)
    domains = await db.domains.find({"user_id": user_id}, {"_id": 0}).to_list(None)
    for domain in domains:
        if domain.get("health_score", 100) < 70:
            domain_id = domain.get("id", "")
            if f"domain_health_{domain_id}" in dismissed_ids:
                continue
            domain_name = domain.get("domain", "")
            alert_time = _alert_time_from_entity(domain)
            alerts.append({
                "id": f"domain_health_{domain_id}",
                "user_id": user_id,
                "type": "warning",
                "title": "Domain health dropping",
                "message": f"{domain_name} dropped below 70% health score. Consider pausing campaigns.",
                "time": alert_time,
                "is_read": False,
                "actionable": True,
                "created_at": alert_time
            })
            try:
                from services.notification_service import notification_service
                from services.email_templates import health_alert
                if notification_service:
                    message = f"Domain {domain_name} dropped below 70% health score. Consider pausing campaigns."
                    subject, body_plain, body_html = health_alert(domain_name, message)
                    await notification_service.send_notification_if_enabled(
                        user_id,
                        "health_alerts",
                        subject,
                        body_plain,
                        body_html,
                    )
            except Exception:
                pass
    
    # Check for high bounce rates in campaigns
    campaigns = await db.campaigns.find({"user_id": user_id}, {"_id": 0}).to_list(None)
    for campaign in campaigns:
        campaign_id = campaign.get("id")
        total_sent = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": {"$ne": "pending"}})
        bounced = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": "failed"})
        
        if total_sent > 0:
            bounce_rate = (bounced / total_sent) * 100
            if bounce_rate > 5 and f"bounce_{campaign_id}" not in dismissed_ids:
                alert_time = _alert_time_from_entity(campaign)
                alerts.append({
                    "id": f"bounce_{campaign_id}",
                    "user_id": user_id,
                    "type": "warning",
                    "title": "High bounce rate",
                    "message": f"Campaign '{campaign.get('name')}' has {bounce_rate:.1f}% bounce rate. Consider verifying contacts.",
                    "time": alert_time,
                    "is_read": False,
                    "actionable": True,
                    "action_link": f"/campaigns/{campaign_id}/contacts",
                    "created_at": alert_time
                })
        
        # Check for campaign milestones (1000 opens) (stable id so dismiss persists)
        opened = await db.email_logs.count_documents({"campaign_id": campaign_id, "status": {"$in": ["opened", "clicked", "replied"]}})
        milestone_id = f"milestone_{campaign_id}_{opened}"
        if opened >= 1000 and opened % 1000 == 0 and milestone_id not in dismissed_ids:  # Milestone reached
            alert_time = _alert_time_from_entity(campaign)
            alerts.append({
                "id": f"milestone_{campaign_id}_{opened}",
                "user_id": user_id,
                "type": "info",
                "title": "Campaign milestone reached",
                "message": f"Campaign '{campaign.get('name')}' has reached {opened} opens. Great job!",
                "time": alert_time,
                "is_read": False,
                "actionable": False,
                "created_at": alert_time
            })
    
    # Check for warmup completions
    inboxes = await db.inboxes.find({"user_id": user_id}, {"_id": 0}).to_list(None)
    for inbox in inboxes:
        if inbox.get("warmup_progress", 0) == 100 and inbox.get("status") == "warming":
            # Check if we recently completed warmup (within last 7 days)
            updated_at = inbox.get("updated_at")
            if not updated_at:
                # Skip inboxes without an updated time
                continue

            # Normalize updated_at to a timezone-aware UTC datetime
            if isinstance(updated_at, str):
                try:
                    from dateutil import parser
                    updated_at = parser.parse(updated_at)
                except Exception:
                    # If parsing fails, skip this inbox
                    continue
            elif not isinstance(updated_at, datetime):
                # Skip unsupported types
                continue

            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)

            days_since = (datetime.now(timezone.utc) - updated_at).days
            if days_since <= 7:
                inbox_id = inbox.get("id", "")
                if f"warmup_{inbox_id}" in dismissed_ids:
                    continue
                alerts.append({
                    "id": f"warmup_{inbox_id}",
                    "user_id": user_id,
                    "type": "success",
                    "title": "Warmup completed",
                    "message": f"{inbox.get('email')} has completed warmup and is ready for full capacity.",
                    "time": updated_at,
                    "is_read": False,
                    "actionable": False,
                    "created_at": updated_at
                })
    
    # Check which alerts have been marked as read
    alert_ids = [a["id"] for a in alerts]
    read_statuses = await db.alert_read_status.find(
        {"alert_id": {"$in": alert_ids}, "user_id": user_id},
        {"_id": 0}
    ).to_list(None)
    read_alert_ids = {rs["alert_id"] for rs in read_statuses}
    
    # Mark alerts as read if they're in the read_statuses collection
    for alert in alerts:
        alert["is_read"] = alert["id"] in read_alert_ids
    
    # Sort by time (newest first). Normalize all to UTC-aware (naive and aware can't be compared).
    alerts.sort(key=lambda x: _to_utc_aware(x.get("time")), reverse=True)
    
    # Convert datetime to ISO string for JSON serialization
    for alert in alerts:
        t = alert.get("time")
        if isinstance(t, datetime):
            alert["time"] = t.isoformat()
        elif t is None and "time" not in alert:
            alert["time"] = datetime.now(timezone.utc).isoformat()
        c = alert.get("created_at")
        if isinstance(c, datetime):
            alert["created_at"] = c.isoformat()
    
    return alerts

@router.post("/alerts/{alert_id}/read")
async def mark_alert_read(alert_id: str, user_id: str = Query(...)):
    """Mark an alert as read (store read status in database)"""
    # Store read status in a separate collection since alerts are generated dynamically
    await db.alert_read_status.update_one(
        {"alert_id": alert_id, "user_id": user_id},
        {"$set": {"is_read": True, "read_at": datetime.now(timezone.utc)}},
        upsert=True
    )
    return {"message": "Alert marked as read"}


@router.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str, user_id: str = Query(...)):
    """Delete an alert (admin-created from db) or dismiss a dynamic alert (store in alert_dismissed)."""
    result = await db.alerts.delete_one({"id": alert_id, "user_id": user_id})
    if result.deleted_count > 0:
        return {"deleted": True, "message": "Alert deleted"}
    # Dynamic alerts (domain_health_, bounce_, milestone_, warmup_) are not in db.alerts; "dismiss" them
    await db.alert_dismissed.update_one(
        {"alert_id": alert_id, "user_id": user_id},
        {"$set": {"alert_id": alert_id, "user_id": user_id, "dismissed_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"deleted": True, "message": "Alert dismissed"}
