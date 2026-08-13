"""Request/Response schemas for routes"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Literal

class ContactsSaveRequest(BaseModel):
    user_id: str
    contacts_data: List[Dict[str, Any]]
    field_mapping: Dict[str, Any]
    list_name: Optional[str] = None
    list_id: Optional[str] = None  # add to this existing list (takes precedence over list_name)

class DeleteContactsRequest(BaseModel):
    contact_ids: List[str]


class UnblockContactsRequest(BaseModel):
    """Unblock selected contacts or all blocked. Omit or empty contact_ids to unblock all blocked."""
    contact_ids: Optional[List[str]] = None


class BlockContactsRequest(BaseModel):
    """Block selected contacts (set manual_unblock = False)."""
    contact_ids: List[str]

class CreateContactRequest(BaseModel):
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company: Optional[str] = None
    industry: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None

class UpdateContactRequest(BaseModel):
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company: Optional[str] = None
    industry: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None

class CreateContactListRequest(BaseModel):
    user_id: str
    name: str
    contact_ids: Optional[List[str]] = []
    description: Optional[str] = None

class UpdateContactListRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    contact_ids: Optional[List[str]] = None

class LLMGenerateRequest(BaseModel):
    user_id: str
    provider: str
    prompt: str


class SmartLeadsAudience(BaseModel):
    """Target audience / ICP fields used to build the web search and AI context."""

    target_company: Optional[str] = None
    industry: Optional[str] = None
    geography: Optional[str] = None
    company_size: Optional[str] = None
    job_titles_or_roles: Optional[str] = None
    keywords: Optional[str] = None
    audience_notes: Optional[str] = None
    search_query_override: Optional[str] = Field(
        default=None,
        description="Override the auto-built Serper query when set (e.g. company + role).",
    )


class SmartLeadsDiscoverRequest(BaseModel):
    ai_provider: str
    audience: SmartLeadsAudience
    num_results: int = Field(default=10, ge=1, description="Organic results to request from Serper.")


class SmartLeadsRunCreateRequest(BaseModel):
    """Start a full Smart Leads background pipeline run."""

    ai_provider: str = Field(..., min_length=1)
    audience: SmartLeadsAudience
    max_emails: int = Field(
        default=100,
        ge=1,
        description="Max work emails persisted per run (mailbox verified + ZeroBounce valid only).",
    )
    company_search_pages: int = Field(
        default=3,
        ge=1,
        description="Serper Google result pages per company-discovery query.",
    )
    employee_search_pages: int = Field(
        default=3,
        ge=1,
        description="Serper Google result pages per employee-discovery query.",
    )
    company_queries: int = Field(
        default=3,
        ge=1,
        description="How many Google search queries to generate for company discovery (buyer/customer contexts, not competitor marketing pages).",
    )
    employee_queries_per_company: int = Field(
        default=3,
        ge=1,
        description="How many Google search queries per company for people discovery.",
    )
    max_companies: int = Field(
        default=100,
        ge=1,
        description="Upper bound on companies kept from search results (all plausible matches up to this).",
    )
    max_people_per_company: int = Field(
        default=12,
        ge=1,
        description="Max people to extract per company (LLM extract step).",
    )


class SerperSettingsPayload(BaseModel):
    """Save or clear Serper API key (stored encrypted)."""

    serper_api_key: Optional[str] = None


class ZeroBounceSettingsPayload(BaseModel):
    """Save or clear ZeroBounce API key (stored encrypted). Required for Smart Leads email validation."""

    zerobounce_api_key: Optional[str] = None


class ZeroBounceValidateTestPayload(BaseModel):
    """Run a one-off ZeroBounce validation test using stored user key."""

    email: str = Field(..., min_length=3)
    timeout: Optional[int] = Field(default=None, ge=3, le=60)
    activity_data: Optional[bool] = None
    verify_plus: Optional[bool] = None


class PostTemplateReplyRequest(BaseModel):
    """Request for LLM-generated follow-up message after template(s) creation."""
    user_id: str
    provider: str
    created_names: List[str] = []  # template names just created
    count: int = 1  # number of templates
    compliance_note: Optional[str] = None


class PostTemplateReplyResponse(BaseModel):
    reply: str


class OutreachIntentContext(BaseModel):
    """Context sent to outreach intent endpoint for policy/function mapping."""
    templates_in_session: Optional[List[Dict[str, Any]]] = None  # [{ id, name, subject, sequence_step?, variant? }]
    existing_sequences_summary: Optional[str] = None  # e.g. "S1-V1, S2-V1. Steps present: 1, 2. Next follow-up would be S3."
    selected_list_id: Optional[str] = None
    contact_lists: Optional[List[Dict[str, Any]]] = None  # [{ id, name, contact_count }]
    base_name: Optional[str] = None
    recent_messages: Optional[List[Dict[str, str]]] = None  # [{ role, content }]
    last_action: Optional[str] = None  # e.g. create_template, create_sequence, add_variants
    just_created_templates: Optional[bool] = None  # true when user just created templates and may want preview/inbox
    created_campaign_id: Optional[str] = None  # campaign already created for this sequence (do not create duplicate)
    selected_inbox_ids: Optional[List[str]] = None  # inbox(es) selected for sending
    pending_name_confirm: Optional[Dict[str, Any]] = None  # { suggested_name, topic, steps, variants } when awaiting name confirmation
    sequence_steps: Optional[int] = None  # how many emails in sequence (set after user replies to ask_steps)
    sequence_variants: Optional[int] = None  # how many A/B variants per step (set after user replies to ask_variants)
    pending_sequence_ask: Optional[str] = None  # "topic" | "steps" | "variants" when waiting for user reply
    campaign_topic: Optional[str] = None  # campaign topic/prompt persisted after user answers ask_topic


class OutreachIntentRequest(BaseModel):
    user_id: str
    provider: str
    message: str
    context: Optional[OutreachIntentContext] = None


class OutreachIntentStep(BaseModel):
    """Single instruction (tool call) for the frontend to execute."""
    tool: str
    args: Dict[str, Any] = {}


class OutreachIntentResponse(BaseModel):
    action: str
    params: Dict[str, Any] = {}
    reply: Optional[str] = None
    steps: Optional[List[Dict[str, Any]]] = None  # [{ "tool": str, "args": dict }, ...]; when set, frontend runs these instead of single action


class ParseStepsVariantsRequest(BaseModel):
    user_id: str
    provider: str
    message: str


class ParseStepsVariantsResponse(BaseModel):
    steps: int
    variants: int


class CreateOutreachChatRequest(BaseModel):
    title: Optional[str] = "Outreach 1"


class UpdateOutreachChatRequest(BaseModel):
    title: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class AddOutreachMessageRequest(BaseModel):
    role: Literal["user", "assistant"]
    content: str = ""
    payload: Optional[Dict[str, Any]] = None


class OutreachActRequest(BaseModel):
    """Single chat turn for backend-orchestrated AI Campaign Studio."""

    message: str
    # Role is kept for future system/assistant-triggered turns; for now the UI will always send "user".
    role: Literal["user", "assistant"] = "user"
    # Selected AI provider/model to use for this chat turn (e.g. "openai", "anthropic").
    ai_provider: str
    # Optional UI hints or structured events (e.g. list/inbox selections) that the orchestrator
    # can use in addition to the free-form message text.
    ui_hints: Optional[Dict[str, Any]] = None


class OutreachActResponse(BaseModel):
    """Backend-orchestrated result for a single chat turn."""

    # Newly created assistant messages for this turn (already persisted server-side).
    messages: List[Dict[str, Any]]
    # UI instructions for the frontend (e.g. show_list_picker, show_inbox_picker, show_preview).
    ui_actions: List[Dict[str, Any]] = []
    # High-level chat state that the frontend can cache (mirrors chat.meta).
    state: Dict[str, Any] = {}


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None  # Stored as first_name / last_name on user
    company: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str
    remember_me: bool = False

class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ImpersonateRequest(BaseModel):
    """Exchange admin-issued impersonation token for user session."""
    token: str


class MailboxLoginRequest(BaseModel):
    inbox_email: str
    password: str


class MailboxForgotPasswordRequest(BaseModel):
    inbox_email: str


class MailboxResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class ProfileUpdateRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    company: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class TwoFARequest(BaseModel):
    enabled: bool


class Verify2FARequest(BaseModel):
    two_fa_token: str
    code: str


class Resend2FARequest(BaseModel):
    two_fa_token: str


class VerifyEmailRequest(BaseModel):
    email: str
    code: str


class ResendVerificationRequest(BaseModel):
    email: str


class NotificationPreferences(BaseModel):
    campaign_updates: bool = True
    reply_notifications: bool = True
    health_alerts: bool = False
    weekly_reports: bool = True
    product_updates: bool = True
    ticket_reply: bool = True
    lifecycle_automation: bool = True


class ComplianceSettings(BaseModel):
    spam_words: Optional[str] = None
    max_links_per_email: int = 3
    max_images_per_email: int = 2
    require_unsubscribe_link: bool = False


class EmailInfraSettings(BaseModel):
    enabled: bool = False


class UserSettingsPayload(BaseModel):
    notifications: Optional[NotificationPreferences] = None
    compliance: Optional[ComplianceSettings] = None
    email_infra: Optional[EmailInfraSettings] = None
    default_reply_to_type: Optional[str] = None  # "none" | "gmail" | "imap"
    default_reply_to_id: Optional[str] = None  # credential id or IMAP config id


class GoogleOAuthConfigPayload(BaseModel):
    """User's own Google OAuth app credentials. use_app_google_oauth is admin-only (set via admin Edit User)."""
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None  # encrypted at rest, never returned in GET


class WebhookCreate(BaseModel):
    url: str
    events: List[str] = []


class WebhookUpdate(BaseModel):
    url: Optional[str] = None
    events: Optional[List[str]] = None

class EmailPreviewRequest(BaseModel):
    template_id: str
    contact_id: Optional[str] = None
    sample_data: Optional[Dict[str, Any]] = None

class TestEmailRequest(BaseModel):
    user_id: str
    template_id: str
    test_email: str
    sender_id: Optional[str] = None  # Gmail inbox id; when set, test is sent from this account
    contact_id: Optional[str] = None
    sample_data: Optional[Dict[str, Any]] = None
    use_ai_variation: Optional[bool] = False
    ai_provider: Optional[str] = None
    ai_prompt: Optional[str] = None

class ConnectionTestEmailRequest(BaseModel):
    user_id: str
    to_email: str
    sender_id: Optional[str] = None  # Gmail inbox id; when set, test is sent from this account

class SMTPConnectionTestEmailRequest(BaseModel):
    user_id: str
    inbox_id: str
    to_email: str

class SMTPTemplateTestRequest(BaseModel):
    user_id: str
    template_id: str
    inbox_id: str
    test_email: str
    contact_id: Optional[str] = None
    sample_data: Optional[Dict[str, Any]] = None
    use_ai_variation: Optional[bool] = False
    ai_provider: Optional[str] = None
    ai_prompt: Optional[str] = None

class SendReplyRequest(BaseModel):
    user_id: str
    email_log_id: str
    subject: str
    body: str
    cc: Optional[str] = None  # comma-separated emails to CC (e.g. outside mailbox)


class SendReceivedReplyRequest(BaseModel):
    user_id: str
    subject: str
    body: str
    cc: Optional[str] = None  # comma-separated emails to CC (e.g. outside mailbox)


class SendComposeRequest(BaseModel):
    """Send a new (compose) email from an inbox."""
    user_id: str
    to_email: str
    subject: str
    body: str
    inbox_id: Optional[str] = None  # optional; if omitted, first ready inbox is used
    cc: Optional[str] = None  # comma-separated emails to CC


class CreateSubdomainRequest(BaseModel):
    subdomain: str

class AddContactsToListRequest(BaseModel):
    contact_ids: List[str]


class ContactFormSubmitRequest(BaseModel):
    """Public website contact form submission."""
    name: str
    email: str
    subject: str
    message: str
    company: Optional[str] = None
    phone: Optional[str] = None


# ---------------------------------------------------------------------------
# Tickets (support)
# ---------------------------------------------------------------------------

class CreateTicketRequest(BaseModel):
    subject: str
    description: str
    priority: Optional[str] = "medium"

class UpdateTicketRequest(BaseModel):
    subject: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None

class CreateTicketCommentRequest(BaseModel):
    body: str


# ---------------------------------------------------------------------------
# Reply-To IMAP config (for campaigns)
# ---------------------------------------------------------------------------

class ReplyToImapConfigCreate(BaseModel):
    email: str
    imap_host: str
    imap_port: int = 993
    imap_username: str
    imap_password: str


class ReplyToImapConfigUpdate(BaseModel):
    email: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    imap_username: Optional[str] = None
    imap_password: Optional[str] = None


# ---------------------------------------------------------------------------
# Admin management (super admin only)
# ---------------------------------------------------------------------------

class CreateAdminRequest(BaseModel):
    email: str
    password: str
    is_super_admin: bool = False


class UpdateAdminStatusRequest(BaseModel):
    status: str  # "active" | "disabled"


class UpdateAdminPasswordRequest(BaseModel):
    new_password: str


# ---------------------------------------------------------------------------
# Support bot (public)
# ---------------------------------------------------------------------------


class SupportBotMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SupportBotChatRequest(BaseModel):
    question: str
    history: Optional[List[SupportBotMessage]] = None


class SupportBotChatResponse(BaseModel):
    answer: str
    in_domain: bool = True
    from_cache: bool = False
