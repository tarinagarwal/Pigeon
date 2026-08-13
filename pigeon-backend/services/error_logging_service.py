"""Centralized Error Logging Service

This service provides a unified interface for logging errors from all third-party
integrations and system operations. Errors are stored in the admin database for
monitoring and troubleshooting.
"""

import logging
import traceback
from typing import Optional, Dict, Any
from datetime import datetime, timezone
from database import admin_db
from admin_models import ErrorLog


class ErrorLoggingService:
    """Service for centralized error logging across all third-party integrations"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
    
    async def log_error(
        self,
        service: str,
        error_type: str,
        error_message: str,
        error_code: Optional[str] = None,
        stack_trace: Optional[str] = None,
        user_id: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        severity: str = "error"
    ) -> str:
        """
        Log an error to the centralized error logging system
        
        Args:
            service: Service name (sendgrid, gmail, smtp, llm, system)
            error_type: Type of error (api_error, auth_error, network_error, validation_error, rate_limit, unknown)
            error_message: Human-readable error message
            error_code: Provider-specific error code (optional)
            stack_trace: Full stack trace (optional)
            user_id: ID of affected user (optional)
            resource_type: Type of resource affected (optional)
            resource_id: ID of affected resource (optional)
            metadata: Additional context data (optional)
            severity: Severity level (critical, error, warning, info)
        
        Returns:
            str: ID of the created error log entry
        """
        try:
            error_log = ErrorLog(
                service=service,
                error_type=error_type,
                error_code=error_code,
                error_message=error_message,
                stack_trace=stack_trace,
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                metadata=metadata or {},
                severity=severity
            )
            
            # Insert into admin database
            await admin_db.error_logs.insert_one(error_log.model_dump())
            
            # Also log to standard logging for immediate visibility
            log_level = {
                "critical": logging.CRITICAL,
                "error": logging.ERROR,
                "warning": logging.WARNING,
                "info": logging.INFO
            }.get(severity, logging.ERROR)
            
            self.logger.log(
                log_level,
                f"[{service.upper()}] {error_type}: {error_message} "
                f"(code: {error_code or 'N/A'}, user: {user_id or 'N/A'})"
            )
            
            return error_log.id
            
        except Exception as e:
            # Fallback logging if database insert fails
            self.logger.error(f"Failed to log error to database: {e}")
            self.logger.error(f"Original error: [{service}] {error_message}")
            return "log_failed"
    
    async def log_exception(
        self,
        service: str,
        exception: Exception,
        error_type: str = "unknown",
        user_id: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        severity: str = "error"
    ) -> str:
        """
        Log an exception with automatic stack trace capture
        
        Args:
            service: Service name
            exception: The exception object
            error_type: Type of error
            user_id: ID of affected user (optional)
            resource_type: Type of resource affected (optional)
            resource_id: ID of affected resource (optional)
            metadata: Additional context data (optional)
            severity: Severity level
        
        Returns:
            str: ID of the created error log entry
        """
        error_message = str(exception)
        error_code = getattr(exception, 'code', None)
        stack_trace = traceback.format_exc()
        
        return await self.log_error(
            service=service,
            error_type=error_type,
            error_message=error_message,
            error_code=error_code,
            stack_trace=stack_trace,
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata=metadata,
            severity=severity
        )
    
    async def mark_resolved(self, error_log_id: str) -> bool:
        """
        Mark an error log as resolved
        
        Args:
            error_log_id: ID of the error log entry
        
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            result = await admin_db.error_logs.update_one(
                {"id": error_log_id},
                {
                    "$set": {
                        "resolved": True,
                        "resolved_at": datetime.now(timezone.utc)
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            self.logger.error(f"Failed to mark error log as resolved: {e}")
            return False
    
    async def get_error_logs(
        self,
        service: Optional[str] = None,
        error_type: Optional[str] = None,
        severity: Optional[str] = None,
        user_id: Optional[str] = None,
        resolved: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100
    ) -> Dict[str, Any]:
        """
        Query error logs with filters
        
        Args:
            service: Filter by service name
            error_type: Filter by error type
            severity: Filter by severity
            user_id: Filter by user ID
            resolved: Filter by resolution status
            skip: Number of records to skip
            limit: Maximum number of records to return
        
        Returns:
            Dict with 'logs' list and 'total' count
        """
        try:
            query: Dict[str, Any] = {}
            
            if service:
                query["service"] = service
            if error_type:
                query["error_type"] = error_type
            if severity:
                query["severity"] = severity
            if user_id:
                query["user_id"] = user_id
            if resolved is not None:
                query["resolved"] = resolved
            
            logs = await admin_db.error_logs.find(query, {"_id": 0}) \
                .sort("created_at", -1) \
                .skip(skip) \
                .limit(limit) \
                .to_list(None)
            
            total = await admin_db.error_logs.count_documents(query)
            
            return {
                "logs": logs,
                "total": total
            }
        except Exception as e:
            self.logger.error(f"Failed to query error logs: {e}")
            return {"logs": [], "total": 0}
    
    async def get_error_stats(self) -> Dict[str, Any]:
        """
        Get aggregated error statistics
        
        Returns:
            Dict with error statistics by service, type, and severity
        """
        try:
            # Count by service
            service_pipeline = [
                {"$group": {"_id": "$service", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}}
            ]
            by_service = await admin_db.error_logs.aggregate(service_pipeline).to_list(None)
            
            # Count by severity
            severity_pipeline = [
                {"$group": {"_id": "$severity", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}}
            ]
            by_severity = await admin_db.error_logs.aggregate(severity_pipeline).to_list(None)
            
            # Count by error type
            type_pipeline = [
                {"$group": {"_id": "$error_type", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}}
            ]
            by_type = await admin_db.error_logs.aggregate(type_pipeline).to_list(None)
            
            # Total counts
            total = await admin_db.error_logs.count_documents({})
            resolved = await admin_db.error_logs.count_documents({"resolved": True})
            unresolved = await admin_db.error_logs.count_documents({"resolved": False})
            
            return {
                "total": total,
                "resolved": resolved,
                "unresolved": unresolved,
                "by_service": [{"service": item["_id"], "count": item["count"]} for item in by_service],
                "by_severity": [{"severity": item["_id"], "count": item["count"]} for item in by_severity],
                "by_type": [{"type": item["_id"], "count": item["count"]} for item in by_type]
            }
        except Exception as e:
            self.logger.error(f"Failed to get error stats: {e}")
            return {
                "total": 0,
                "resolved": 0,
                "unresolved": 0,
                "by_service": [],
                "by_severity": [],
                "by_type": []
            }


# Global instance
error_logger = ErrorLoggingService()
