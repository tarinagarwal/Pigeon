"""Health check routes"""
from fastapi import APIRouter
from datetime import datetime, timezone
import logging
from pymongo import ReadPreference

from database import client, db, admin_db

router = APIRouter()

@router.get("/")
async def root():
    return {"message": "Email Outreach API", "status": "healthy"}

@router.get("/health")
async def health_check():
    """Health check endpoint with database connectivity test"""
    try:
        # Connectivity check should not require a writable primary.
        await client.admin.with_options(
            read_preference=ReadPreference.SECONDARY_PREFERRED
        ).command("ping")
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
        logging.error(f"Database health check failed: {e}")
    
    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "database": db_status,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@router.get("/jobs")
async def health_jobs():
    """
    Check if there are active campaigns or background jobs running.
    Used by ASG termination handler to ensure graceful shutdown.
    """
    try:
        # Count active campaigns in app DB
        active_campaigns = await db.campaigns.count_documents({
            "status": "active"
        })
        
        # Count running jobs in admin DB (send_campaign_batch)
        running_jobs = await admin_db.system_jobs.count_documents({
            "status": "running"
        })

        # Check for recent email activity as a safety buffer (last 5 mins)
        five_mins_ago = datetime.now(timezone.utc).timestamp() - 300
        recent_activity = await db.email_logs.count_documents({
            "sent_at": {"$gte": five_mins_ago}
        })
        
        return {
            "status": "ok",
            "active_campaigns": active_campaigns,
            "running_system_jobs": running_jobs,
            "recent_email_activity": recent_activity,
            "safe_to_terminate": (active_campaigns == 0 and running_jobs == 0 and recent_activity == 0)
        }
    except Exception as e:
        logging.error(f"Error checking job status: {e}")
        return {
            "status": "error",
            "error": str(e),
            "safe_to_terminate": False  # Error on safe side
        }
