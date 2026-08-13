"""Admin API routes for error log management"""

from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import admin_db
from routes.dependencies import get_current_admin, require_admin_permissions
from services.error_logging_service import error_logger


router = APIRouter(prefix="/admin/error-logs")


class MarkResolvedRequest(BaseModel):
    error_log_id: str


@router.get(
    "",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def list_error_logs(
    service: Optional[str] = Query(default=None, description="Filter by service"),
    error_type: Optional[str] = Query(default=None, description="Filter by error type"),
    severity: Optional[str] = Query(default=None, description="Filter by severity"),
    user_id: Optional[str] = Query(default=None, description="Filter by user ID"),
    resolved: Optional[bool] = Query(default=None, description="Filter by resolution status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    current_admin: dict = Depends(get_current_admin),
):
    """
    List error logs with optional filters
    
    Query parameters:
    - service: Filter by service name (sendgrid, gmail, smtp, llm, system)
    - error_type: Filter by error type (api_error, auth_error, network_error, etc.)
    - severity: Filter by severity (critical, error, warning, info)
    - user_id: Filter by affected user
    - resolved: Filter by resolution status (true/false)
    - skip: Number of records to skip for pagination
    - limit: Maximum number of records to return (1-500)
    """
    result = await error_logger.get_error_logs(
        service=service,
        error_type=error_type,
        severity=severity,
        user_id=user_id,
        resolved=resolved,
        skip=skip,
        limit=limit
    )
    return result


@router.get(
    "/stats",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def get_error_stats(
    current_admin: dict = Depends(get_current_admin),
):
    """
    Get aggregated error statistics
    
    Returns statistics including:
    - Total error count
    - Resolved vs unresolved counts
    - Breakdown by service
    - Breakdown by severity
    - Breakdown by error type
    """
    stats = await error_logger.get_error_stats()
    return stats


@router.get(
    "/{error_log_id}",
    dependencies=[Depends(require_admin_permissions(["system.read"]))],
)
async def get_error_log(
    error_log_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Get a specific error log by ID"""
    error_log = await admin_db.error_logs.find_one({"id": error_log_id}, {"_id": 0})
    if not error_log:
        raise HTTPException(status_code=404, detail="Error log not found")
    return error_log


@router.post(
    "/{error_log_id}/resolve",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def mark_error_resolved(
    error_log_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Mark an error log as resolved"""
    success = await error_logger.mark_resolved(error_log_id)
    if not success:
        raise HTTPException(status_code=404, detail="Error log not found")
    return {"success": True, "message": "Error log marked as resolved"}


@router.delete(
    "/{error_log_id}",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def delete_error_log(
    error_log_id: str,
    current_admin: dict = Depends(get_current_admin),
):
    """Delete an error log entry"""
    result = await admin_db.error_logs.delete_one({"id": error_log_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Error log not found")
    return {"success": True, "message": "Error log deleted"}


@router.post(
    "/bulk-resolve",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def bulk_resolve_errors(
    service: Optional[str] = Query(default=None),
    error_type: Optional[str] = Query(default=None),
    current_admin: dict = Depends(get_current_admin),
):
    """
    Bulk resolve error logs matching filters
    
    Query parameters:
    - service: Resolve all errors for a specific service
    - error_type: Resolve all errors of a specific type
    """
    query = {"resolved": False}
    if service:
        query["service"] = service
    if error_type:
        query["error_type"] = error_type
    
    result = await admin_db.error_logs.update_many(
        query,
        {
            "$set": {
                "resolved": True,
                "resolved_at": datetime.now(timezone.utc)
            }
        }
    )
    
    return {
        "success": True,
        "message": f"Resolved {result.modified_count} error logs"
    }


@router.delete(
    "/bulk-delete",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def bulk_delete_resolved_errors(
    days_old: int = Query(default=30, ge=1, description="Delete resolved errors older than N days"),
    current_admin: dict = Depends(get_current_admin),
):
    """
    Bulk delete resolved error logs older than specified days
    
    This helps keep the error log database clean by removing old resolved errors.
    """
    from datetime import timedelta
    
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_old)
    
    result = await admin_db.error_logs.delete_many({
        "resolved": True,
        "resolved_at": {"$lt": cutoff_date}
    })
    
    return {
        "success": True,
        "message": f"Deleted {result.deleted_count} resolved error logs older than {days_old} days"
    }


@router.delete(
    "/bulk-delete-all",
    dependencies=[Depends(require_admin_permissions(["system.write"]))],
)
async def bulk_delete_all_errors(
    service: Optional[str] = Query(default=None),
    error_type: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    resolved: Optional[bool] = Query(default=None),
    current_admin: dict = Depends(get_current_admin),
):
    """
    Bulk delete error logs.

    If filters are provided, deletes only matching records.
    If no filters are provided, deletes all error logs.
    """
    query = {}
    if service:
        query["service"] = service
    if error_type:
        query["error_type"] = error_type
    if severity:
        query["severity"] = severity
    if resolved is not None:
        query["resolved"] = resolved

    result = await admin_db.error_logs.delete_many(query)

    if query:
        message = f"Deleted {result.deleted_count} filtered error logs"
    else:
        message = f"Deleted {result.deleted_count} error logs"

    return {
        "success": True,
        "message": message,
        "deleted_count": result.deleted_count,
    }
