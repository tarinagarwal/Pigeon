from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timezone
import uuid

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password_hash: str  # Hashed password, never store plain text
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company: Optional[str] = None
    status: str = "active"  # active, banned, pending
    plan_id: Optional[str] = None  # References Plan.id; default "free" for new users
    subscription_status: str = "active"  # trial, active, past_due, cancelled
    trial_ends_at: Optional[datetime] = None
    # Subscription period (date only, YYYY-MM-DD) for display and validity
    subscription_start: Optional[str] = None  # Subscribed from
    subscription_end: Optional[str] = None    # Subscribed to / valid until
    # Set when a subscription invoice is successfully paid (Razorpay / Lemon). Used to avoid
    # granting paid-tier limits when the subscription is cancelled or never successfully charged.
    billing_last_paid_at: Optional[datetime] = None
    # True after at least one successful subscription charge (Razorpay paid_count / webhooks).
    # Backfills legacy users who paid before billing_last_paid_at existed.
    billing_has_successful_subscription_charge: bool = False
    razorpay_customer_id: Optional[str] = None
    razorpay_subscription_id: Optional[str] = None
    lemon_squeezy_customer_id: Optional[str] = None
    lemon_squeezy_subscription_id: Optional[str] = None
    email_verified: bool = False  # New users must verify email via OTP; existing users without field treated as verified in login
    two_fa_enabled: bool = True  # 2FA (email OTP at login) on by default; user can disable in settings
    # Optional per-user bonus limits that stack on top of the selected plan.
    # These only apply when the user's plan is not "free".
    extra_max_domains: int = 0
    extra_max_subdomains: int = 0
    extra_max_google_accounts: int = 0
    extra_max_campaigns: int = 0
    extra_max_monthly_smtp_emails: int = 0
    credits_balance: int = 0
    credits_total_purchased: int = 0
    credits_total_earned: int = 0
    credits_total_spent: int = 0
    warmup_shared_pool_enabled: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PlanFeature(BaseModel):
    """Single feature line for a plan (e.g. '1 domain, 1 subdomain', included: true)."""
    text: str
    included: bool = True


class Plan(BaseModel):
    """Subscription plan: pricing and limits, stored in admin_db.plans."""
    model_config = ConfigDict(extra="ignore")

    id: str  # e.g. "free", "starter", "growth"
    name: str
    price: str  # "0", "10", "Custom"
    annual_price: Optional[str] = None
    description: str = ""
    badge: Optional[str] = None
    best_for: Optional[str] = None
    cta: str = "Get started"
    cta_subtext: Optional[str] = None
    popular: bool = False
    # Limits: -1 means unlimited / Custom
    max_domains: int = 1
    max_subdomains: int = 1
    # Unified inbox pool used by both SMTP and Gmail inboxes.
    # If not explicitly set in the DB, it will default to the subdomain limit.
    max_inboxes: int = 1
    max_google_accounts: int = 0  # 0 can mean "—" (no Google accounts)
    max_campaigns: int = 1
    # Max monthly emails sent via SMTP inboxes for this tenant; -1 = unlimited.
    max_monthly_smtp_emails: int = -1
    warmup: bool = False
    support: str = "Community"
    features: List[PlanFeature] = Field(default_factory=list)
    # Display strings for comparison table
    google_accounts_display: str = "—"
    domains_display: str = "1"
    subdomains_display: str = "1"
    daily_emails_display: str = "50"
    daily_limit: Optional[str] = None  # e.g. "50"
    daily_limit_formula: Optional[str] = None  # e.g. "1×50 subdomains"
    # Razorpay plan IDs (optional; if set, used instead of RAZORPAY_PLAN_* env vars)
    razorpay_plan_id_monthly: Optional[str] = None  # e.g. "plan_xxxx"
    razorpay_plan_id_annual: Optional[str] = None   # e.g. "plan_yyyy"
    # Lemon Squeezy variant IDs for international billing
    lemon_squeezy_variant_id_monthly: Optional[str] = None
    lemon_squeezy_variant_id_annual: Optional[str] = None
    order: int = 0
    active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class LLMConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    user_id: str
    provider: str  # openai, anthropic, gemini, deepseek, grok, groq
    api_key: str
    model_name: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ContactList(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    description: Optional[str] = None
    contact_ids: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Contact(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company: Optional[str] = None
    industry: Optional[str] = None
    custom_fields: Dict[str, Any] = Field(default_factory=dict)
    status: str = "pending"  # pending, sent, opened, clicked, replied, unsubscribed, blocked (3+ failed delivery attempts)
    manual_unblock: bool = False  # if True, bypass block (treated as sendable even after 3+ emails without engagement)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class EmailTemplate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    subject: str
    body: str
    body_type: Literal["html", "plain", "rich"] = "html"  # plain = text/plain, html = text/html, rich = WYSIWYG (stored as html)
    sequence_number: int  # 1, 2, 3 for email1, email2, email3
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class EmailSequenceStep(BaseModel):
    template_id: str
    delay_days: int = 0  # 0 for immediate, >0 for delayed

class Campaign(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    # Maximum emails this campaign can send per day across all selected inboxes.
    # This is a campaign-level cap; per-inbox limits are enforced separately.
    daily_limit: int = 50
    sender_name: Optional[str] = None  # Display name for email sender
    template_ids: List[str] = Field(default_factory=list)
    contact_list_ids: List[str] = Field(default_factory=list)  # Changed from contact_ids
    contact_ids: List[str] = Field(default_factory=list)  # Keep for backward compatibility
    status: str = "draft"  # draft, active, paused, completed
    ai_prompt: Optional[str] = None
    ai_provider: Optional[str] = None
    use_ai_generation: bool = False  # Generate unique content per email using AI
    ai_generation_prompt: Optional[str] = None  # Prompt for per-email AI generation
    ai_generation_provider: Optional[str] = None  # Provider for per-email AI generation
    # Web search (Serper) + LLM: compact public snippets, then personalize template per recipient (Smart Leads–style stack).
    use_external_enrichment: bool = False
    external_enrichment_prompt: Optional[str] = None  # How to use web context when rewriting the template
    external_enrichment_provider: Optional[str] = None  # LLM provider; falls back to ai_generation_provider when unset
    field_mapping: Dict[str, str] = Field(default_factory=dict)
    email_sequence: List[EmailSequenceStep] = Field(default_factory=list)
    start_date: Optional[str] = None  # Format: YYYY-MM-DD - when to start the campaign
    start_time: str = "09:00"
    end_time: str = "17:00"
    timezone: str = "America/New_York"
    sender_type: str = "gmail"  # "gmail" or "smtp"
    sender_ids: List[str] = Field(default_factory=list)  # List of inbox_ids or gmail_user_ids
    sender_rotation: str = "round_robin"  # "round_robin" or "random"
    rotation_enabled: bool = False  # Inbox rotation on/off (persists even with 1 inbox)
    reply_to_type: Optional[str] = None  # "none" | "gmail" | "imap" | "default" | "custom"
    reply_to_id: Optional[str] = None  # Gmail credential/inbox id or IMAP config id
    reply_to_email: Optional[str] = None  # When reply_to_type == "custom", this is the Reply-To address
    ab_winner_template_id: Optional[str] = None  # When set, A/B send uses only this template (auto-selected winner)
    ab_winner_set_at: Optional[datetime] = None  # When winner was (last) set; used for re-evaluation throttle
    archived: bool = False
    # Include Warmup Network (own saved contacts) as extra recipients; personalization uses list-derived company + name from email.
    campaign_real_engagement_network: bool = False
    # Rent pool recipients (requires campaign_real_engagement_network); 1 credit per pool send in email pipeline.
    campaign_personal_network_pool: bool = False
    # Cap campaign real-engagement volume as a % of campaign daily sends (20/40/60/80/100).
    campaign_real_engagement_percent: int = 60
    # When false, do not insert hidden pixel image for open tracking.
    open_tracking: bool = True
    # Days the campaign may send (0=Monday .. 6=Sunday). Default Mon–Fri.
    schedule_weekdays: List[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("schedule_weekdays", mode="before")
    @classmethod
    def _normalize_schedule_weekdays(cls, v):
        default = [0, 1, 2, 3, 4]
        if v is None:
            return default
        if isinstance(v, list):
            if len(v) == 0:
                return default
            try:
                out = sorted({int(x) for x in v if 0 <= int(x) <= 6})
                return out if out else default
            except (TypeError, ValueError):
                return default
        return default

class EmailLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    campaign_id: str
    contact_id: str
    template_id: str
    gmail_message_id: Optional[str] = None
    gmail_thread_id: Optional[str] = None
    subject: str
    body: str
    status: str = "pending"  # pending, sent, failed, opened, clicked, replied
    sent_at: Optional[datetime] = None
    opened_at: Optional[datetime] = None
    clicked_at: Optional[datetime] = None
    replied_at: Optional[datetime] = None
    # Optional classifier for reply origin (e.g. "human", "auto", "outbound")
    reply_type: Optional[str] = None
    tracking_pixel_id: Optional[str] = None
    error_message: Optional[str] = None
    reply_body: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CampaignEnrichmentLead(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    campaign_id: str
    contact_id: str
    template_id: str
    email_log_id: Optional[str] = None
    provider: Optional[str] = None
    queries: List[str] = Field(default_factory=list)
    phone_query: Optional[str] = None
    query_context: Dict[str, Any] = Field(default_factory=dict)
    serper_rows: List[Dict[str, Any]] = Field(default_factory=list)
    phone_search_rows: List[Dict[str, Any]] = Field(default_factory=list)
    selected_read_more_urls: List[str] = Field(default_factory=list)
    page_extractions: List[Dict[str, Any]] = Field(default_factory=list)
    compacted_facts: Optional[str] = None
    lead_object: Dict[str, Any] = Field(default_factory=dict)
    status: str = "generated"
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GmailCredentials(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    user_id: str
    gmail_email: str
    access_token: str
    refresh_token: str
    token_expiry: datetime
    scopes: List[str]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TrackingPixel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email_log_id: str
    opened: bool = False
    open_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CampaignContactEvent(BaseModel):
    type: str  # sent, opened, clicked, replied, failed
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Dict[str, Any] = Field(default_factory=dict)

class CampaignContact(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    campaign_id: str
    contact_id: str
    user_id: str
    status: str = "pending"  # pending, sent, opened, clicked, replied, failed
    last_activity: Optional[datetime] = None
    events: List[CampaignContactEvent] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class LinkClick(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email_log_id: str
    original_url: str
    clicked: bool = False
    click_count: int = 0
    is_unsubscribe: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AnalyticsData(BaseModel):
    total_sent: int = 0
    total_opened: int = 0
    total_clicked: int = 0
    total_replied: int = 0
    open_rate: float = 0.0
    click_rate: float = 0.0
    reply_rate: float = 0.0

class Domain(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    domain: str  # e.g., "example.com"
    status: str = "pending"  # pending, verified, failed
    spf_verified: bool = False
    dkim_selector: str = "sendgrid"
    dkim_verified: bool = False
    dmarc_verified: bool = False
    # Provider-level DNS verification
    cname_verified: bool = False  # Provider CNAME records valid (SendGrid)
    mx_verified: bool = False     # Provider MX records valid (SendGrid)
    health_score: int = 0  # 0-100
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    verified_at: Optional[datetime] = None
    inbound_parse_enabled: bool = False  # SendGrid Inbound Parse enabled for receiving mail
    # Optional branded tracking host (e.g. links.example.com) used for click/pixel URLs.
    tracking_domain: Optional[str] = None
    tracking_domain_verified: bool = False
    tracking_domain_verified_at: Optional[datetime] = None
    # Domain-level sending provider toggle.
    # - `sendgrid`: send outbound via SendGrid
    # - `email_infra`: send outbound via Email Infra (VPS/IP pool)
    sending_provider: Literal["sendgrid", "email_infra"] = "sendgrid"

class Subdomain(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    domain_id: str
    subdomain: str  # e.g., "mail", "outreach"
    full_domain: str  # e.g., "mail.example.com"
    status: str = "pending"  # pending, verified
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Inbox(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    domain_id: Optional[str] = None
    subdomain_id: Optional[str] = None
    email: EmailStr  # e.g., "sales@mail.example.com" or Gmail address
    sender_type: str  # "gmail" or "smtp"
    # For SMTP
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    sender_name: Optional[str] = None  # Optional manual override for sender display name / {{inbox_name}}
    smtp_password: Optional[str] = None  # Encrypted
    smtp_provider: Optional[str] = None  # custom, sendgrid, pigeon (pigeon = Pigeon-managed SendGrid)
    mailbox_id: Optional[str] = None  # Email Infra mailbox id (inbox-level, set when sending_provider == email_infra)
    # For Gmail
    gmail_credentials_id: Optional[str] = None
    gmail_auth_method: Optional[str] = "oauth"  # "oauth" or "app_password"
    gmail_app_password_encrypted: Optional[str] = None  # used when gmail_auth_method == "app_password"
    # Status
    auto_warmup: bool = False  # Whether inbox should be auto-warmed based on plan
    warmup_progress: int = 0  # 0-100
    warmup_started_at: Optional[datetime] = None  # When current warmup period started (for progress); used when resuming from 100%
    # Campaign ramp-up: while True, campaign sends use a tiered daily cap (see services/campaign_rampup.py)
    campaign_rampup: bool = False
    campaign_rampup_started_at: Optional[datetime] = None
    daily_limit: int = 50
    sent_today: int = 0
    status: str = "warming"  # warming, ready, paused
    # Per-inbox weekly rhythm: weekdays (0=Mon..6=Sun) when this inbox sends slower (longer gaps). Set once when missing.
    weekly_rhythm_light_days: Optional[List[int]] = None
    # Per-inbox warmup engagement caps (set daily at midnight): target open/reply rate in [0.30, 0.50] for realistic engagement.
    warmup_target_open_rate: Optional[float] = None
    warmup_target_reply_rate: Optional[float] = None
    # Warmup sender pacing controls (UTC).
    warmup_last_sent_at: Optional[datetime] = None
    warmup_next_send_at: Optional[datetime] = None
    # Warmup engagement mode:
    # pool = platform receiver pool (artificial)
    # network = user Warmup Network (real)
    # network_plus_shared = own Warmup Network + shared personal-network pool
    # hybrid = 60% real + 40% artificial
    # shared_pool = shared personal-network pool rented with credits (legacy/direct mode)
    warmup_engagement_mode: Literal["pool", "network", "network_plus_shared", "hybrid", "shared_pool"] = "pool"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("daily_limit")
    @classmethod
    def cap_daily_limit(cls, v: int) -> int:
        """Maximum 50 emails per day per inbox; no one can exceed this."""
        return min(max(1, v), 50)


class ReplyToImapConfig(BaseModel):
    """IMAP connection used only for Reply-To address and reply detection (no sending)."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    email: EmailStr
    imap_host: str
    imap_port: int = 993
    imap_username: str
    imap_password: Optional[str] = None  # Encrypted at rest
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WarmupReceiverAccount(BaseModel):
    """Platform-level external account (Gmail/Outlook/Yahoo) that receives warm-up emails and opens/replies. Stored in admin_db."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    provider: str  # gmail, outlook, yahoo, custom
    email: EmailStr
    imap_host: str
    imap_port: int = 993
    imap_username: str
    imap_password: Optional[str] = None  # Encrypted at rest
    smtp_host: str
    smtp_port: int = 587
    smtp_username: str
    smtp_password: Optional[str] = None  # Encrypted at rest
    is_active: bool = True
    last_used_at: Optional[datetime] = None
    daily_reply_cap: Optional[int] = None  # Optional max replies per day per account
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WarmupSendTemplate(BaseModel):
    """One warm-up email template: subject + body pair. Per-user. Stored in main db. One random template picked per send."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    subject: str
    body: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WarmupNetworkContact(BaseModel):
    """User-managed contact for real-engagement warmup (Warmup Network). Stored in main db."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    email: EmailStr
    label: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WarmupSent(BaseModel):
    """Record of a warm-up email sent from an inbox to a receiver. Used for threading and reply tracking. Stored in main db."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    inbox_id: str
    user_id: str
    receiver_account_id: Optional[str] = None  # None for network (real engagement) sends
    receiver_email: EmailStr
    # Engagement mode: pool = platform receiver pool; network = user Warmup Network;
    # shared_pool = rented personal-network pool; quick = Quick Engagement send
    engagement_mode: Literal["pool", "network", "shared_pool", "quick"] = "pool"
    thread_id: Optional[str] = None
    turn_index: int = 0
    message_id: str  # Outbound Message-ID for In-Reply-To/References
    subject: str
    sent_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    opened_at: Optional[datetime] = None
    replied_at: Optional[datetime] = None
    link_clicked_at: Optional[datetime] = None  # Warmup Network tracked link (click-through)
    reply_generation_source: Optional[str] = None  # groq | fallback
    reply_quality_score: Optional[float] = None
    receiver_message_uid: Optional[str] = None  # IMAP UID
    receiver_gmail_id: Optional[str] = None  # Gmail API message id
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WarmupThread(BaseModel):
    """Warm-up conversation state shared by sender and receiver loops."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    inbox_id: str
    user_id: str
    receiver_account_id: str
    receiver_email: EmailStr
    root_message_id: str
    stage: str = "new"  # new, active, cooldown, closed
    turn_count: int = 1
    max_turns: int = 3
    next_action_at: Optional[datetime] = None
    last_sender_role: str = "inbox"  # inbox, receiver
    provider_thread_ref: Optional[str] = None
    close_reason: Optional[str] = None
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WarmupMessage(BaseModel):
    """One message inside a warm-up thread."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    thread_id: str
    inbox_id: str
    user_id: str
    receiver_account_id: str
    role: str  # inbox, receiver
    message_id: str
    in_reply_to: Optional[str] = None
    references: Optional[str] = None
    subject: str
    body: str
    from_email: EmailStr
    to_email: EmailStr
    provider: Optional[str] = None
    provider_thread_ref: Optional[str] = None
    llm_meta: Optional[Dict[str, Any]] = None
    sent_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Alert(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    type: str  # "warning", "error", "info", "success"
    title: str
    message: str
    time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_read: bool = False
    actionable: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ContactSubmission(BaseModel):
    """Website contact form submission (public, no auth)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: EmailStr
    subject: str
    message: str
    company: Optional[str] = None
    phone: Optional[str] = None
    archived: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TicketComment(BaseModel):
    """Comment/reply on a support ticket."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    ticket_id: str
    author_id: str  # user_id (dashboard user) or admin_user_id (admin)
    author_type: str  # "user" or "admin"
    body: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Ticket(BaseModel):
    """Support ticket created by dashboard users, manageable by admin."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    subject: str
    description: str
    status: str = "open"  # open, in_progress, resolved, closed
    priority: str = "medium"  # low, medium, high, urgent
    assigned_to: Optional[str] = None  # admin_user_id
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OutreachChatMeta(BaseModel):
    """Optional UI state for an outreach chat (list, inboxes, templates, etc.)."""
    model_config = ConfigDict(extra="ignore")
    selected_list_id: Optional[str] = None
    selected_inbox_ids: List[str] = Field(default_factory=list)
    created_template_ids: List[str] = Field(default_factory=list)
    base_name: Optional[str] = None
    started_campaign_ids: List[str] = Field(default_factory=list)


class OutreachChat(BaseModel):
    """AI Campaign Studio chat (one conversation tab)."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    title: str = "Outreach 1"
    meta: Optional[Dict[str, Any]] = None  # OutreachChatMeta as dict for flexibility
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OutreachChatMessage(BaseModel):
    """Single message in an outreach chat."""
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    chat_id: str
    user_id: str
    role: Literal["user", "assistant"] = "user"
    content: str = ""
    payload: Optional[Dict[str, Any]] = None  # template_card, list_card, inbox_card, campaign_created, etc.
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SupportBotCacheEntry(BaseModel):
    """Cached Q&A entry for the public support bot, stored in admin_db.support_bot_cache."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question_hash: str
    normalized_question: str
    raw_question: str  # Original question as received (for debugging/verification)
    answer: str
    data_version: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WorkflowTrigger(BaseModel):
    """Trigger definition for a workflow (email/campaign scoped)."""

    model_config = ConfigDict(extra="ignore")

    type: str  # e.g. onCampaignStarted, onEmailSent, onEmailOpened, onEmailReplied, onSchedule
    # Optional scoping references; not all are required for every trigger
    campaign_id: Optional[str] = None
    list_id: Optional[str] = None
    contact_id: Optional[str] = None
    # For time-based triggers
    schedule_cron: Optional[str] = None


class WorkflowNode(BaseModel):
    """Single node in a workflow graph."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    # SendEmail, WaitFor, IfCondition, UpdateContact, AddToList, StartCampaign, PauseCampaign, End, etc.
    type: str
    # Node-specific configuration; interpreted by the workflow engine
    config: Dict[str, Any] = Field(default_factory=dict)
    # Optional label/title for display in the builder
    label: Optional[str] = None
    # Canvas position for drag-and-drop builder (stored so layouts persist)
    position_x: Optional[float] = None
    position_y: Optional[float] = None


class WorkflowEdge(BaseModel):
    """Directed edge between workflow nodes."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_node_id: str
    target_node_id: str
    # Optional label for branches such as "Yes", "No", "OnReply", "Timeout"
    label: Optional[str] = None


class Workflow(BaseModel):
    """User-defined workflow definition for advanced email automations."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    description: Optional[str] = None
    status: str = "draft"  # draft, active, paused, archived
    # Scope controls what kind of entity the workflow operates on
    scope: str = "campaign"  # campaign, list, contact, global
    trigger: WorkflowTrigger
    nodes: List[WorkflowNode] = Field(default_factory=list)
    edges: List[WorkflowEdge] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WorkflowRun(BaseModel):
    """Execution instance of a workflow for a specific trigger context."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    workflow_id: str
    user_id: str
    status: str = "running"  # running, completed, failed, cancelled
    # Arbitrary context about what triggered the run (campaign_id, contact_id, email_log_id, etc.)
    trigger_context: Dict[str, Any] = Field(default_factory=dict)
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WorkflowRunStep(BaseModel):
    """Per-node execution record for a workflow run."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    workflow_run_id: str
    node_id: str
    status: str = "pending"  # pending, running, completed, failed, skipped
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    retry_count: int = 0
    # Optional snapshots of entity context before/after the node runs (for debugging)
    context_before: Optional[Dict[str, Any]] = None
    context_after: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WorkflowWait(BaseModel):
    """Waiting condition for a workflow node (time or event based)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    workflow_run_id: str
    node_id: str
    user_id: str
    # Optional entity references the wait is scoped to
    campaign_id: Optional[str] = None
    list_id: Optional[str] = None
    contact_id: Optional[str] = None
    email_log_id: Optional[str] = None
    # For event-based waits: e.g. opened, clicked, replied, unsubscribed
    event_type: Optional[str] = None
    # For time-based waits: until this time in UTC
    until_time: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LifecycleJourney(BaseModel):
    """Lifecycle journey state for a user."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    journey_name: str = "trial_to_paid"
    state: str = "active"
    started_at: Optional[datetime] = None
    current_step: Optional[str] = None
    trial_anchor_at: Optional[datetime] = None
    paid_anchor_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LifecycleEmailSend(BaseModel):
    """Idempotent send ledger for lifecycle templates."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    template_key: str
    scheduled_for: datetime
    status: str = "pending"  # pending, running, sent, skipped, failed, unsubscribed
    idempotency_key: str
    sent_at: Optional[datetime] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LifecycleSuppression(BaseModel):
    """Suppression flags for lifecycle automation."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    unsubscribed_lifecycle: bool = False
    hard_bounce: bool = False
    complaint: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SubUserPermissions(BaseModel):
    """Page-level access permissions granted to a sub-user."""
    dashboard: bool = True
    inbox: bool = True
    campaigns: bool = True
    contacts: bool = True
    templates: bool = True
    workflows: bool = True
    analytics: bool = True
    tracking: bool = True
    domains: bool = True
    inboxes: bool = True
    warmup: bool = True
    settings: bool = False


class SubUserInvitation(BaseModel):
    """Represents a sub-user added to a workspace owner's account."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    owner_id: str  # workspace owner's user_id
    sub_user_email: str
    sub_user_id: Optional[str] = None  # resolved when email matches an existing user
    name: Optional[str] = None
    status: str = "active"  # active, revoked
    permissions: SubUserPermissions = Field(default_factory=SubUserPermissions)
    invited_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Rent Your Network (RYN) models
# ---------------------------------------------------------------------------

class RYNUser(BaseModel):
    """A user of the Rent Your Network portal. Separate from the main app User."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password_hash: str
    full_name: str
    bio: Optional[str] = None
    status: str = "active"  # active, suspended
    credits_balance: int = 0       # available (released) credits
    credits_held: int = 0          # earned but under 48-hr hold, not yet spendable
    credits_total_earned: int = 0
    credits_total_spent: int = 0
    email_verified: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RYNEmailListing(BaseModel):
    """An email address listed for renting by an RYN user."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    owner_id: str  # RYNUser.id
    email: EmailStr
    note: Optional[str] = None           # optional short label/note
    credits_per_use: int = 1             # fixed at 1 credit per use
    daily_receive_limit: int = 10        # max warmup emails this address receives per day
    mx_ok: bool = False                  # domain has valid MX records
    mx_records: List[str] = Field(default_factory=list)  # raw MX hosts
    provider: Optional[str] = None       # one of RYN_KNOWN_EMAIL_PROVIDERS; set on insert from MX detection
    status: str = "active"              # active, paused, removed
    times_rented: int = 0
    credits_earned: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RYNCreditTransaction(BaseModel):
    """A credit transaction for an RYN user (earn or spend).

    type values:
      earn_held  – credits earned but under 48-hr hold (owner side of a rental)
      earn       – credits released from hold into available balance
      spend      – credits spent on a rental (renter side)
      bonus      – platform-granted bonus credits (immediately available)
    """
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str           # RYNUser.id
    amount: int            # positive = earned/held, negative = spent
    type: str              # "earn_held", "earn", "spend", "refund", "bonus", "withdraw"
    description: str
    listing_id: Optional[str] = None      # related RYNEmailListing.id if applicable
    listing_email: Optional[str] = None   # email address of the listing (for warmup lookup)
    renter_user_id: Optional[str] = None  # who rented (stored on earn_held so we can refund them)
    hold_until: Optional[datetime] = None    # set for earn_held; None once released
    released_at: Optional[datetime] = None   # when hold was released → type becomes earn
    settled_reason: Optional[str] = None     # "reply_detected" | "no_response_48h"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RYNWithdrawRequest(BaseModel):
    """A withdrawal request submitted by an RYN user to cash out credits.

    Payment method is either 'bank' or 'upi'.
    A flat 10% platform + transaction fee is deducted from the requested amount.
    Minimum withdrawal is 500 credits.
    """
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str                        # RYNUser.id
    user_email: str                     # denormalised for admin display
    user_name: str                      # denormalised for admin display

    credits_requested: int              # gross credits the user wants to withdraw
    platform_fee_percent: int = 10      # always 10 %
    credits_fee: int                    # = ceil(credits_requested * 0.10)
    credits_net: int                    # = credits_requested - credits_fee (what user actually receives)

    payment_method: str                 # "bank" | "upi"

    # Bank details (populated when payment_method == "bank")
    bank_account_holder: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None

    # UPI details (populated when payment_method == "upi")
    upi_id: Optional[str] = None
    upi_name: Optional[str] = None

    # Status lifecycle: pending → processing → completed | rejected
    status: str = "pending"
    admin_notes: Optional[str] = None   # optional note from admin when updating status

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
