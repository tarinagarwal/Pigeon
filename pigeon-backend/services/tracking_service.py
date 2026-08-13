from datetime import datetime, timezone
import re


def _is_unsubscribe_url(url: str) -> bool:
    """Return True if the URL is considered an unsubscribe/opt-out link."""
    if not url or not isinstance(url, str):
        return False
    lower = url.lower().strip()
    return (
        "unsubscribe" in lower
        or "opt-out" in lower
        or "optout" in lower
        or bool(re.search(r"/(unsub|opt.?out|preferences|manage.?subscription)", lower))
    )


class TrackingService:
    def __init__(self, db):
        self.db = db
    
    async def track_open(self, pixel_id: str):
        """Track email open"""
        # Update tracking pixel
        result = await self.db.tracking_pixels.update_one(
            {"id": pixel_id},
            {
                "$set": {"opened": True},
                "$inc": {"open_count": 1}
            }
        )
        
        if result.modified_count > 0:
            # Get pixel to get email_log_id
            pixel = await self.db.tracking_pixels.find_one({"id": pixel_id})
            
            if pixel:
                # Update email log if not already opened
                now = datetime.now(timezone.utc)
                await self.db.email_logs.update_one(
                    {
                        "id": pixel["email_log_id"],
                        "status": "sent"
                    },
                    {
                        "$set": {
                            "status": "opened",
                            "opened_at": now
                        }
                    }
                )
                
                # Update contact status
                log = await self.db.email_logs.find_one({"id": pixel["email_log_id"]})
                if log:
                    await self.db.contacts.update_one(
                        {"id": log["contact_id"], "status": "sent"},
                        {"$set": {"status": "opened"}}
                    )

                    # Update CampaignContact status and add event
                    await self.db.campaign_contacts.update_one(
                        {"campaign_id": log["campaign_id"], "contact_id": log["contact_id"]},
                        {
                            "$set": {
                                "status": "opened",
                                "last_activity": now,
                                "updated_at": now
                            },
                            "$push": {
                                "events": {
                                    "type": "opened",
                                    "timestamp": now,
                                    "metadata": {"email_log_id": log["id"], "pixel_id": pixel_id}
                                }
                            }
                        }
                    )

                    # Trigger webhooks for email.opened
                    try:
                        from services.webhook_event_service import WebhookEventService  # local import
                        from server import webhook_event_service as _wh_service  # type: ignore

                        if isinstance(_wh_service, WebhookEventService):
                            await _wh_service.send_email_event("email.opened", log)
                    except Exception:
                        # Never break tracking because of webhook side-effects
                        pass
                else:
                    # Warmup Network: tracking_pixels.email_log_id stores warmup_sent.id
                    ws = await self.db.warmup_sent.find_one({"id": pixel["email_log_id"]})
                    if ws and not ws.get("opened_at"):
                        await self.db.warmup_sent.update_one(
                            {"id": ws["id"]},
                            {"$set": {"opened_at": now, "updated_at": now}},
                        )
    
    async def track_click(self, link_id: str) -> str:
        """Track link click and return original URL"""
        # Update link click
        result = await self.db.link_clicks.update_one(
            {"id": link_id},
            {
                "$set": {"clicked": True},
                "$inc": {"click_count": 1}
            }
        )
        
        link = await self.db.link_clicks.find_one({"id": link_id})
        
        if not link:
            raise Exception("Link not found")
        
        if result.modified_count > 0:
            # Update email log if not already clicked
            await self.db.email_logs.update_one(
                {
                    "id": link["email_log_id"],
                    "status": {"$in": ["sent", "opened"]}
                },
                {
                    "$set": {
                        "status": "clicked",
                        "clicked_at": datetime.now(timezone.utc)
                    }
                }
            )
            
            # Update contact status (campaign rows only; warmup uses warmup_sent below)
            log = await self.db.email_logs.find_one({"id": link["email_log_id"]})
            if log and log.get("contact_id"):
                now = datetime.now(timezone.utc)
                is_unsubscribe = link.get("is_unsubscribe") or _is_unsubscribe_url(link.get("original_url") or "")

                if is_unsubscribe:
                    # Mark contact as unsubscribed and treat same as block (exclude from future campaigns)
                    await self.db.contacts.update_one(
                        {"id": log["contact_id"]},
                        {"$set": {"status": "unsubscribed", "manual_unblock": False}}
                    )
                    if log.get("campaign_id"):
                        await self.db.campaign_contacts.update_one(
                            {"campaign_id": log["campaign_id"], "contact_id": log["contact_id"]},
                            {
                                "$set": {"status": "unsubscribed", "last_activity": now, "updated_at": now},
                                "$push": {
                                    "events": {
                                        "type": "unsubscribed",
                                        "timestamp": now,
                                        "metadata": {"email_log_id": log["id"], "link_id": link_id, "url": link["original_url"]}
                                    }
                                }
                            }
                        )
                else:
                    await self.db.contacts.update_one(
                        {"id": log["contact_id"], "status": {"$in": ["sent", "opened"]}},
                        {"$set": {"status": "clicked"}}
                    )
                    if log.get("campaign_id"):
                        await self.db.campaign_contacts.update_one(
                            {"campaign_id": log["campaign_id"], "contact_id": log["contact_id"]},
                            {
                                "$set": {"status": "clicked", "last_activity": now, "updated_at": now},
                                "$push": {
                                    "events": {
                                        "type": "clicked",
                                        "timestamp": now,
                                        "metadata": {"email_log_id": log["id"], "link_id": link_id, "url": link["original_url"]}
                                    }
                                }
                            }
                        )
            else:
                # Warmup Network (and similar): link_clicks.email_log_id stores warmup_sent.id
                ws = await self.db.warmup_sent.find_one({"id": link["email_log_id"]})
                if ws and not ws.get("link_clicked_at"):
                    now = datetime.now(timezone.utc)
                    await self.db.warmup_sent.update_one(
                        {"id": ws["id"]},
                        {"$set": {"link_clicked_at": now, "updated_at": now}},
                    )
        
        return link["original_url"]