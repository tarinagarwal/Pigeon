from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional
import uuid

from pydantic import BaseModel, EmailStr, Field, ConfigDict


class AdminUser(BaseModel):
    """Internal admin user for operating the system."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password_hash: str
    is_super_admin: bool = False
    status: str = "active"  # active, disabled
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AdminRole(BaseModel):
    """Named role that groups a set of permissions."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str  # e.g. "support", "ops", "engineering"
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AdminPermission(BaseModel):
    """Fine-grained permission that can be attached to roles."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    code: str  # e.g. "campaign.read", "campaign.write", "user.suspend"
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AdminUserRole(BaseModel):
    """Mapping between admin users and roles (many-to-many)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    admin_user_id: str
    role_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RolePermission(BaseModel):
    """Mapping between roles and permissions (many-to-many)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role_id: str
    permission_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AutomationRule(BaseModel):
    """High-level automation rule that can schedule or trigger jobs."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None

    # Examples: "CRON", "ON_EVENT", "THRESHOLD"
    trigger_type: str
    trigger_config: Dict[str, Any] = Field(default_factory=dict)

    # Examples: "START_CAMPAIGN", "PAUSE_WARMUP", "SEND_ALERT", "RUN_LLM_ANALYSIS"
    action_type: str
    action_config: Dict[str, Any] = Field(default_factory=dict)

    is_active: bool = True
    created_by_admin_id: Optional[str] = None
    updated_by_admin_id: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SystemJob(BaseModel):
    """Represents a scheduled or ad-hoc system job."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    rule_id: Optional[str] = None
    job_type: str  # e.g. "automation_rule", "send_campaign_batch", "maintenance", "backfill"
    action_config: Optional[Dict[str, Any]] = None  # e.g. {"campaign_id": "..."} for send_campaign_batch

    status: str = "pending"  # pending, running, success, failed
    scheduled_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class JobRun(BaseModel):
    """Individual execution of a job (if you need multiple runs)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    job_id: str
    status: str  # pending, running, success, failed
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: Optional[datetime] = None
    logs: Optional[str] = None


class AuditLog(BaseModel):
    """Audit trail of admin actions performed via the admin panel or API."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    admin_user_id: str
    action: str  # e.g. "update_campaign", "delete_domain"
    resource_type: str  # e.g. "campaign", "domain", "user"
    resource_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FeatureFlag(BaseModel):
    """Feature flag used to toggle behaviour in the system."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    key: str  # e.g. "new_dashboard_enabled"
    value: Any
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SystemConfig(BaseModel):
    """Key-value configuration for system-wide settings."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    key: str  # e.g. "max_daily_sends_per_tenant"
    value: Any
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ErrorLog(BaseModel):
    """Centralized error logging for third-party integrations and system errors."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    service: str  # "sendgrid", "gmail", "smtp", "llm", "system"
    error_type: str  # "api_error", "auth_error", "network_error", "validation_error", "rate_limit", "unknown"
    error_code: Optional[str] = None  # Provider-specific error code
    error_message: str  # Human-readable error message
    stack_trace: Optional[str] = None  # Full stack trace for debugging
    user_id: Optional[str] = None  # User affected (if applicable)
    resource_type: Optional[str] = None  # "domain", "inbox", "campaign", "email"
    resource_id: Optional[str] = None  # ID of affected resource
    metadata: Dict[str, Any] = Field(default_factory=dict)  # Additional context
    severity: str = "error"  # "critical", "error", "warning", "info"
    resolved: bool = False
    resolved_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Blog(BaseModel):
    """Blog post stored in admin_db.blogs. Content is markdown; featured image from Cloudinary or URL."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    slug: str
    content: str = ""  # Markdown
    excerpt: Optional[str] = None
    author: Optional[str] = None
    featured_image_url: Optional[str] = None  # Cloudinary URL or any image URL
    status: str = "draft"  # draft | published
    published_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

