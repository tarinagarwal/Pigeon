from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, Request
from fastapi.encoders import jsonable_encoder
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import RedirectResponse, JSONResponse
import os
import logging
import uuid
from datetime import datetime, timezone

# Import database connection
from database import db, client, admin_db

# Import services
from services.gmail_service import GmailService
from services.llm_service import LLMService
from services.email_service import EmailService
from services.tracking_service import TrackingService
from services.excel_service import ExcelService
from services.domain_service import DomainService
from services.smtp_service import SMTPService
from services.background_tasks import BackgroundTasks
from services.automation_service import AutomationService
from services.workflow_service import WorkflowService
from services.plan_service import PlanService
from services.lemonsqueezy_service import LemonSqueezyService
from services.imap_reply_service import ImapReplyService
from services.notification_service import NotificationService, init_notification_service
from services.warmup_sender_service import WarmupSenderService
from services.warmup_receiver_service import WarmupReceiverService
from services.warmup_llm_service import WarmupLLMService
from services.webhook_event_service import WebhookEventService
from services.campaign_deliverability_service import CampaignDeliverabilityService
from services.lifecycle_automation_service import LifecycleAutomationService

# Import route modules
from routes import (
    auth,
    billing,
    blogs,
    gmail,
    plans,
    llm,
    outreach,
    contacts,
    contact_lists,
    contact as contact_route,
    templates,
    campaigns,
    emails,
    tracking,
    analytics,
    domains,
    subdomains,
    inboxes,
    alerts,
    inbox_emails,
    mailbox_routes,
    warmup,
    health,
    settings,
    tickets,
    reply_to,
    webhooks,
    region,
    admin_auth,
    admin_automation,
    admin_core,
    admin_infrastructure,
    admin_warmup,
    admin_billing_webhooks,
    error_logs,
    support_bot,
    workflows,
    smart_leads,
    workspace,
    rent_network,
    admin_ryn,
    public_tools,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create indexes and start background tasks. Shutdown: stop tasks and close DB."""
    # Startup
    try:
        await db.users.create_index("email", unique=True)
        await db.contacts.create_index("user_id")
        await db.contacts.create_index([("user_id", 1), ("email", 1)])
        await db.contacts.create_index([("status", 1), ("updated_at", 1)])
        await db.campaigns.create_index("user_id")
        await db.email_logs.create_index("campaign_id")
        await db.email_logs.create_index([("user_id", 1), ("sent_at", -1)])
        await db.email_logs.create_index([("sender_id", 1), ("sent_at", -1)])
        # Inbox listing: filter by user_id, status $in, archived (or not), sort by replied_at desc, sent_at desc
        await db.email_logs.create_index([
            ("user_id", 1),
            ("status", 1),
            ("archived", 1),
            ("replied_at", -1),
            ("sent_at", -1),
        ])
        await db.email_logs.create_index("gmail_thread_id")
        await db.domains.create_index("user_id")
        await db.domain_creation_locks.create_index("id", unique=True)
        await db.domain_creation_locks.create_index("created_at", expireAfterSeconds=300)
        await db.inboxes.create_index("user_id")
        await _migrate_gmail_credentials_to_multi()
        try:
            await db.gmail_credentials.drop_index("user_id_1")
        except Exception:
            pass
        await db.gmail_credentials.create_index("user_id")
        await db.gmail_credentials.create_index("id", unique=True)
        await db.oauth_states.create_index("state", unique=True)
        await db.oauth_states.create_index("created_at", expireAfterSeconds=3600)
        await db.password_resets.create_index("reset_token", unique=True)
        await db.password_resets.create_index("user_id")
        await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
        await db.mailbox_password_resets.create_index("reset_token", unique=True)
        await db.mailbox_password_resets.create_index("inbox_id")
        await db.mailbox_password_resets.create_index("expires_at", expireAfterSeconds=0)
        await db.sessions.create_index("user_id")
        await db.sessions.create_index([("user_id", 1), ("jti", 1)], unique=True)
        await db.contact_submissions.create_index("created_at")
        await db.contact_submissions.create_index([("archived", 1), ("created_at", -1)])
        await db.risky_email_jobs.create_index("user_id")
        await db.risky_email_jobs.create_index([("user_id", 1), ("created_at", -1)])
        await db.smart_leads_runs.create_index("id", unique=True)
        await db.smart_leads_runs.create_index([("user_id", 1), ("created_at", -1)])
        await db.smart_leads_companies.create_index("run_id")
        await db.smart_leads_companies.create_index("user_id")
        await db.smart_leads_people.create_index("run_id")
        await db.smart_leads_people.create_index("user_id")
        await db.smart_leads_emails.create_index("run_id")
        await db.smart_leads_emails.create_index("user_id")
        await db.tickets.create_index("user_id")
        await db.tickets.create_index("status")
        await db.tickets.create_index("updated_at")
        await db.ticket_comments.create_index("ticket_id")
        await db.tracking_pixels.create_index("email_log_id")
        await db.link_clicks.create_index("email_log_id")
        await db.reply_to_imap_configs.create_index("user_id")
        # Rent Your Network indexes
        await db.ryn_users.create_index("email", unique=True)
        await db.ryn_listings.create_index("owner_id")
        await db.ryn_listings.create_index([("status", 1), ("created_at", -1)])
        await db.ryn_transactions.create_index("user_id")
        await db.ryn_transactions.create_index([("user_id", 1), ("created_at", -1)])
        await db.ryn_transactions.create_index("warmup_sent_id", sparse=True)
        await db.ryn_email_otps.create_index("email", unique=True)
        await db.ryn_email_otps.create_index("expires_at", expireAfterSeconds=0)
        # warmup_sent RYN lookup index
        await db.warmup_sent.create_index("ryn_owner_user_id", sparse=True)
        await db.warmup_sent.create_index("ryn_listing_id", sparse=True)
        await db.inbound_messages.create_index([("user_id", 1), ("received_at", -1)])
        await db.inbound_messages.create_index([("user_id", 1), ("inbox_id", 1), ("received_at", -1)])
        await db.inbound_messages.create_index([("user_id", 1), ("is_read", 1), ("received_at", -1)])
        await db.inbound_messages.create_index("to")
        await db.inbound_messages.create_index("domain_id")
        await db.inbound_messages.create_index("thread_id")
        await db.webhooks.create_index("user_id")
        await db.outbound_replies.create_index([("user_id", 1), ("thread_id", 1)])
        await db.outbound_replies.create_index("thread_id")
        await db.outreach_chats.create_index("user_id")
        await db.outreach_chats.create_index([("user_id", 1), ("updated_at", -1)])
        await db.outreach_chat_messages.create_index("chat_id")
        await db.outreach_chat_messages.create_index([("chat_id", 1), ("created_at", 1)])
        await admin_db.error_logs.create_index("service")
        await admin_db.error_logs.create_index("severity")
        await admin_db.error_logs.create_index("error_type")
        await admin_db.error_logs.create_index("user_id")
        await admin_db.error_logs.create_index("resolved")
        await admin_db.error_logs.create_index([("created_at", -1)])
        await admin_db.billing_webhook_logs.create_index("provider")
        await admin_db.billing_webhook_logs.create_index("event_name")
        await admin_db.billing_webhook_logs.create_index("user_id")
        await admin_db.billing_webhook_logs.create_index("signature_valid")
        await admin_db.billing_webhook_logs.create_index([("received_at", -1)])
        await admin_db.billing_webhook_logs.create_index("id", unique=True)
        await admin_db.plans.create_index("id", unique=True)
        await admin_db.plans.create_index("active")
        await admin_db.plans.create_index("order")
        await admin_db.blogs.create_index("slug", unique=True)
        await admin_db.blogs.create_index("status")
        await admin_db.blogs.create_index("published_at")
        try:
            await admin_db.warmup_receiver_accounts.drop_index("email_1")
        except Exception:
            pass
        await admin_db.warmup_receiver_accounts.create_index([("email", 1), ("provider", 1)], unique=True)
        await admin_db.warmup_receiver_accounts.create_index("provider")
        await admin_db.warmup_receiver_accounts.create_index("is_active")
        await db.warmup_network_contacts.create_index("user_id")
        await db.warmup_network_contacts.create_index([("user_id", 1), ("email", 1)], unique=True)
        await db.warmup_network_email_otps.create_index([("user_id", 1), ("email", 1)], unique=True)
        await admin_db.outlook_receiver_oauth_states.create_index("state", unique=True)
        await admin_db.outlook_receiver_oauth_states.create_index("created_at", expireAfterSeconds=3600)
        await admin_db.gmail_receiver_oauth_states.create_index("state", unique=True)
        await admin_db.gmail_receiver_oauth_states.create_index("created_at", expireAfterSeconds=3600)
        await admin_db.support_bot_cache.create_index(
            [("question_hash", 1), ("data_version", 1)],
            unique=True,
        )
        await admin_db.support_bot_cache.create_index("created_at")
        # One pending dns_verify_domain job per domain (multi-instance safe)
        await admin_db.system_jobs.create_index(
            [("action_config.domain_id", 1)],
            unique=True,
            partialFilterExpression={"job_type": "dns_verify_domain", "status": "pending"},
        )
        await db.warmup_sent.create_index("inbox_id")
        await db.warmup_sent.create_index("receiver_account_id")
        await db.warmup_sent.create_index("message_id")
        await db.warmup_sent.create_index("replied_at")
        await db.warmup_sent.create_index("sent_at")
        await db.warmup_sent.create_index("thread_id")
        await db.warmup_threads.create_index("id", unique=True)
        await db.warmup_threads.create_index([("inbox_id", 1), ("receiver_account_id", 1), ("stage", 1)])
        await db.warmup_threads.create_index("next_action_at")
        await db.warmup_messages.create_index("thread_id")
        await db.warmup_messages.create_index("message_id")
        await db.warmup_messages.create_index([("thread_id", 1), ("sent_at", -1)])
        await db.warmup_send_templates.create_index("user_id")
        await db.inboxes.create_index([("status", 1), ("auto_warmup", 1), ("warmup_next_send_at", 1)])
        await db.campaign_deliverability_checks.create_index([("campaign_id", 1), ("checked_at", -1)])
        await db.campaign_deliverability_checks.create_index([("campaign_id", 1), ("classification", 1), ("checked_at", -1)])
        await db.campaign_deliverability_checks.create_index("checked_at")
        await db.campaign_deliverability_state.create_index(
            [("campaign_id", 1), ("domain_id", 1), ("subdomain_id", 1)],
            unique=True,
        )
        await db.campaign_deliverability_state.create_index("next_check_at")
        await db.campaign_deliverability_runs.create_index("id", unique=True)
        await db.campaign_deliverability_runs.create_index(
            [("campaign_id", 1), ("user_id", 1), ("created_at", -1)]
        )
        await db.campaign_enrichment_leads.create_index("id", unique=True)
        await db.campaign_enrichment_leads.create_index([("campaign_id", 1), ("created_at", -1)])
        await db.campaign_enrichment_leads.create_index([("user_id", 1), ("campaign_id", 1), ("created_at", -1)])
        await db.campaign_enrichment_leads.create_index([("campaign_id", 1), ("contact_id", 1)])
        # Workflow engine indexes
        await db.workflows.create_index("user_id")
        await db.workflow_runs.create_index([("workflow_id", 1), ("user_id", 1), ("started_at", -1)])
        await db.workflow_run_steps.create_index("workflow_run_id")
        await db.workflow_waits.create_index([("workflow_run_id", 1), ("node_id", 1)])
        await db.lifecycle_journeys.create_index([("user_id", 1), ("journey_name", 1)], unique=True)
        await db.lifecycle_email_sends.create_index("id", unique=True)
        await db.lifecycle_email_sends.create_index("idempotency_key", unique=True)
        await db.lifecycle_email_sends.create_index([("status", 1), ("scheduled_for", 1)])
        await db.lifecycle_email_sends.create_index("tracking_pixel_id", unique=True, sparse=True)
        await db.lifecycle_email_sends.create_index("click_token", unique=True, sparse=True)
        await db.lifecycle_email_sends.create_index("unsubscribe_token", unique=True, sparse=True)
        await db.lifecycle_events.create_index([("user_id", 1), ("created_at", -1)])
        await db.lifecycle_suppressions.create_index("user_id", unique=True)
        await db.sub_user_invitations.create_index("owner_id")
        await db.sub_user_invitations.create_index([("owner_id", 1), ("sub_user_email", 1)])
        await db.sub_user_invitations.create_index("sub_user_id")
        await _migrate_warmup_send_templates_to_paired()
        await _backfill_domain_normalized()
        await db.domains.create_index("domain_normalized", unique=True, sparse=True)
        # Public inbox placement test sessions — TTL auto-expire after 24h
        await db.public_placement_tests.create_index("id", unique=True)
        await db.public_placement_tests.create_index("client_ip")
        await db.public_placement_tests.create_index("expires_at", expireAfterSeconds=0)
        logging.info("Database indexes created successfully")
    except Exception as e:
        logging.error(f"Error creating database indexes: {e}")
    # Skip background tasks when running in localhost context (e.g. SKIP_BACKGROUND_TASKS=1 or request origin is local)
    skip_bg = os.environ.get("SKIP_BACKGROUND_TASKS", "").lower() in ("1", "true", "yes")
    if skip_bg:
        print("[CAMPAIGN_BATCH] skipping background tasks (localhost/SKIP_BACKGROUND_TASKS)", flush=True)
    else:
        print("[CAMPAIGN_BATCH] starting background tasks...", flush=True)
        await background_tasks.start()
        print("[CAMPAIGN_BATCH] startup complete (watch for 'automation tick' every 60s)", flush=True)
    yield
    # Shutdown
    if not skip_bg:
        await background_tasks.stop()
    client.close()


# Create the main app (docs/redoc disabled)
app = FastAPI(title="Email Outreach API", docs_url=None, redoc_url=None, lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Initialize services
plan_service = PlanService(db, admin_db)
gmail_service = GmailService(db, plan_service=plan_service, admin_db=admin_db)
llm_service = LLMService(db)
domain_service = DomainService(db, admin_db=admin_db)  # Pass admin_db for email provider config
smtp_service = SMTPService(db)
imap_reply_service = ImapReplyService(db, smtp_service)
notification_service_instance = NotificationService(db, smtp_service)
init_notification_service(notification_service_instance)
lifecycle_automation_service = LifecycleAutomationService(db, smtp_service)
email_service = EmailService(db, gmail_service, llm_service, smtp_service, imap_reply_service, plan_service=plan_service)
email_service.set_lifecycle_automation_service(lifecycle_automation_service)
workflow_service = WorkflowService()
tracking_service = TrackingService(db)
excel_service = ExcelService()
automation_service = AutomationService(
    admin_db=admin_db,
    app_db=db,
    email_service=email_service,
    workflow_service=workflow_service,
    domain_service=domain_service,
)
email_service.set_automation_service(automation_service)
warmup_llm_service = WarmupLLMService()
warmup_sender_service = WarmupSenderService(
    db,
    admin_db,
    smtp_service,
    gmail_service,
    warmup_llm_service=warmup_llm_service,
    email_service=email_service,
)
warmup_receiver_service = WarmupReceiverService(
    db,
    admin_db,
    smtp_service,
    warmup_llm_service=warmup_llm_service,
    email_service=email_service,
)
campaign_deliverability_service = CampaignDeliverabilityService(
    db=db,
    admin_db=admin_db,
    smtp_service=smtp_service,
    gmail_service=gmail_service,
    email_service=email_service,
)
webhook_event_service = WebhookEventService()
background_tasks = BackgroundTasks(
    db,
    domain_service,
    admin_db=admin_db,
    automation_service=automation_service,
    warmup_sender_service=warmup_sender_service,
    warmup_receiver_service=warmup_receiver_service,
    lifecycle_automation_service=lifecycle_automation_service,
)

# Initialize services in route modules
gmail.init_gmail_service(gmail_service)
llm.init_llm_service(llm_service)
outreach.init_llm_service(llm_service)
smart_leads.init_llm_service(llm_service)
contacts.init_excel_service(excel_service)
emails.init_email_services(gmail_service, email_service)
emails.init_plan_service_for_emails(plan_service)
emails.init_automation_service_for_emails(automation_service)
tracking.init_tracking_service(tracking_service)
tracking.init_workflow_service(workflow_service)
tracking.init_lifecycle_automation_service(lifecycle_automation_service)
domains.init_domain_service(domain_service)
subdomains.init_domain_service(domain_service)
inboxes.init_inbox_services(gmail_service, smtp_service)
admin_automation.init_automation_service(automation_service)
admin_core.init_campaign_deliverability_service(campaign_deliverability_service)
campaigns.init_campaign_deliverability_service(campaign_deliverability_service)
campaigns.init_automation_service(automation_service)
campaigns.init_campaign_email_service(email_service)
campaigns.init_workflow_service(workflow_service)
workflows.init_workflow_service(workflow_service)
auth.init_plan_service(plan_service)
auth.init_smtp_service(smtp_service)
auth.init_lifecycle_automation_service(lifecycle_automation_service)
domains.init_plan_service(plan_service)
domains.init_lifecycle_automation_service(lifecycle_automation_service)
subdomains.init_plan_service(plan_service)
campaigns.init_plan_service(plan_service)
inboxes.init_plan_service(plan_service)
inboxes.init_lifecycle_automation_service(lifecycle_automation_service)
reply_to.init_smtp_service(smtp_service)
admin_warmup.init_smtp_service(smtp_service)
warmup.init_warmup_sender_service(warmup_sender_service)
warmup.init_warmup_network_otp_smtp(smtp_service)
webhooks.init_smtp_service(smtp_service)
webhooks.init_workflow_service(workflow_service)
webhooks.init_lifecycle_automation_service(lifecycle_automation_service)
workspace.init_smtp_service(smtp_service)
rent_network.init_smtp_service(smtp_service)

# Include all routers
api_router.include_router(auth.router)
api_router.include_router(admin_auth.router)
api_router.include_router(admin_automation.router)
api_router.include_router(admin_core.router)
api_router.include_router(admin_infrastructure.router)
api_router.include_router(admin_warmup.router)
api_router.include_router(error_logs.router)
api_router.include_router(admin_billing_webhooks.router)
api_router.include_router(gmail.router)
api_router.include_router(llm.router)
api_router.include_router(smart_leads.router)
api_router.include_router(outreach.router, prefix="/outreach")
api_router.include_router(contacts.router)
api_router.include_router(contact_lists.router)
api_router.include_router(templates.router)
api_router.include_router(campaigns.router)
api_router.include_router(emails.router)
api_router.include_router(tracking.router)
api_router.include_router(analytics.router)
api_router.include_router(domains.router)
api_router.include_router(subdomains.router)
api_router.include_router(inboxes.router)
api_router.include_router(alerts.router)
api_router.include_router(inbox_emails.router)
api_router.include_router(mailbox_routes.router)
api_router.include_router(warmup.router)
api_router.include_router(health.router)
api_router.include_router(region.router)
billing.init_plan_service(plan_service)
lemonsqueezy_service = LemonSqueezyService(plan_service=plan_service)
billing.init_lemonsqueezy_service(lemonsqueezy_service)
billing.init_lifecycle_automation_service(lifecycle_automation_service)
billing.init_billing_notification_service(notification_service_instance)
billing.init_billing_automation_service(automation_service)
api_router.include_router(billing.router)
api_router.include_router(plans.router)
api_router.include_router(blogs.router)
api_router.include_router(settings.router)
api_router.include_router(reply_to.router)
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(tickets.router)
api_router.include_router(contact_route.router) 
api_router.include_router(support_bot.router)
api_router.include_router(workflows.router)
api_router.include_router(workspace.router)
api_router.include_router(rent_network.router)
api_router.include_router(admin_ryn.router)
public_tools.init_public_tools(admin_db=admin_db, db=db, smtp_service=smtp_service)
api_router.include_router(public_tools.router)

# Include the API router in the main app
app.include_router(api_router)


@app.middleware("http")
async def demo_mode_middleware(request: Request, call_next):
    """Short-circuit certain calls in demo mode so unauthenticated demo sessions don't 401
    and avoid hitting real business logic for demo-only requests.

    Demo mode is enabled when any of these are present:
    - ?demo=1 query param
    - X-Demo-Mode: 1 header
    - user_id=demo-user query param (explicit demo user)
    """
    query_params = request.query_params
    headers = request.headers

    is_demo = (
        query_params.get("demo") == "1"
        or headers.get("x-demo-mode") == "1"
        or query_params.get("user_id") == "demo-user"
    )

    # For demo requests, short-circuit ALL OPTIONS preflight calls to /api/* so we never
    # hit route handlers or dependencies.
    if is_demo and request.method == "OPTIONS" and request.url.path.startswith("/api/"):
        return JSONResponse(status_code=200, content={"ok": True})

    # Synthetic demo user for /api/auth/me so the frontend can treat demo like an authenticated session.
    if is_demo and request.url.path == "/api/auth/me":
        now = datetime.now(timezone.utc)
        payload = {
            "id": "demo-user",
            "email": "demo@pigeon.local",
            "first_name": "Demo",
            "last_name": "User",
            "plan_id": "demo",
            "subscription_status": "demo",
            "trial_ends_at": None,
            "trial_used_at": None,
            "subscription_start": None,
            "subscription_end": None,
            "two_fa_enabled": False,
            "credits_balance": 250,
            "credits_total_purchased": 250,
            "credits_total_earned": 40,
            "credits_total_spent": 30,
            "warmup_shared_pool_enabled": False,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        return JSONResponse(content=jsonable_encoder(payload))

    return await call_next(request)


@app.get("/")
async def root():
    """Redirect bare API domain to main frontend."""
    return RedirectResponse(
        url=(os.environ.get("FRONTEND_URL") or "http://localhost:8080").rstrip("/") + "/",
        status_code=307,
    )


# CORS: allowed origins come from CORS_ORIGINS; defaults to local dev hosts.
_env_origins = os.environ.get("CORS_ORIGINS", "http://localhost:8080,http://localhost:3000")
_cors_origins = [o.strip() for o in _env_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=list(dict.fromkeys(_cors_origins)),  # dedupe, preserve order
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["Content-Type", "Authorization", "X-Timezone", "X-Demo-Mode", "If-None-Match", "X-Workspace-Context"],
    expose_headers=["Content-Type", "ETag"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def _migrate_gmail_credentials_to_multi():
    """Migrate gmail_credentials to multi-account: add id, create inbox per credential."""
    cursor = db.gmail_credentials.find({"id": {"$exists": False}})
    async for doc in cursor:
        cred_id = str(uuid.uuid4())
        user_id = doc.get("user_id")
        gmail_email = doc.get("gmail_email", "")
        if not user_id:
            continue
        await db.gmail_credentials.update_one(
            {"_id": doc["_id"]},
            {"$set": {"id": cred_id}}
        )
        existing_inbox = await db.inboxes.find_one({"gmail_credentials_id": cred_id})
        if not existing_inbox:
            now = datetime.now(timezone.utc)
            await db.inboxes.insert_one({
                "id": cred_id,
                "user_id": user_id,
                "email": gmail_email,
                "sender_type": "gmail",
                "gmail_credentials_id": cred_id,
                "warmup_progress": 100,
                "daily_limit": 50,
                "sent_today": 0,
                "status": "ready",
                "created_at": now,
                "updated_at": now,
            })
        logging.info(f"Migrated gmail_credentials for user_id={user_id} to id={cred_id}")


async def _migrate_warmup_send_templates_to_paired():
    """Convert old warmup_send_templates (type+text) to new format (subject+body pairs). One-time migration."""
    try:
        cursor = db.warmup_send_templates.find({"type": {"$exists": True}}, {"user_id": 1})
        user_ids = set()
        async for doc in cursor:
            user_ids.add(doc["user_id"])
        for uid in user_ids:
            subject_docs = await db.warmup_send_templates.find(
                {"user_id": uid, "type": "subject"}
            ).sort("created_at", 1).to_list(None)
            body_docs = await db.warmup_send_templates.find(
                {"user_id": uid, "type": "body"}
            ).sort("created_at", 1).to_list(None)
            n = min(len(subject_docs), len(body_docs))
            if n == 0:
                await db.warmup_send_templates.delete_many({"user_id": uid, "type": {"$exists": True}})
                continue
            now = datetime.now(timezone.utc)
            new_docs = []
            for i in range(n):
                new_docs.append({
                    "id": str(uuid.uuid4()),
                    "user_id": uid,
                    "subject": subject_docs[i].get("text", ""),
                    "body": body_docs[i].get("text", ""),
                    "created_at": now,
                    "updated_at": now,
                })
            await db.warmup_send_templates.insert_many(new_docs)
            await db.warmup_send_templates.delete_many({"user_id": uid, "type": {"$exists": True}})
        if user_ids:
            logging.info("Migrated warmup_send_templates to paired (subject+body) for %s users", len(user_ids))
    except Exception as e:
        logging.error("Error migrating warmup_send_templates: %s", e)


async def _backfill_domain_normalized():
    """Backfill `domain_normalized` for legacy domain documents."""
    try:
        cursor = db.domains.find(
            {
                "$or": [
                    {"domain_normalized": {"$exists": False}},
                    {"domain_normalized": None},
                    {"domain_normalized": ""},
                ]
            },
            {"_id": 1, "domain": 1},
        )
        async for doc in cursor:
            raw_domain = (doc.get("domain") or "").strip().lower().rstrip(".")
            if not raw_domain:
                continue
            await db.domains.update_one(
                {"_id": doc["_id"]},
                {"$set": {"domain_normalized": raw_domain, "domain": raw_domain}},
            )
    except Exception as e:
        logging.error("Error backfilling domain_normalized: %s", e)
