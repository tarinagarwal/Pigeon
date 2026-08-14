// API Type Definitions

export interface Domain {
  id: string;
  user_id: string;
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  sending_provider?: 'sendgrid' | 'email_infra'; // Domain-level outbound sending provider
  spf_verified: boolean;
  dkim_selector: string;
  dkim_verified: boolean;
  dmarc_verified: boolean;
  cname_verified?: boolean;
  mx_verified?: boolean;
  health_score: number;
  created_at: string;
  verified_at?: string;
  inbound_parse_enabled?: boolean;
  tracking_domain?: string | null;
  tracking_domain_verified?: boolean;
  tracking_domain_verified_at?: string | null;
  email_infra?: {
    enabled?: boolean;
    status?: string;
    domain_id?: string | null;
    mailbox_id?: string | null;
    vps_id?: string | null;
    mx_host?: string | null;
    inbound_webhook_url?: string | null;
    last_verify_dns?: Record<string, unknown> | null;
    last_error?: string | null;
    last_sync_at?: string;
  };
}

export interface InboundAttachment {
  filename: string;
  type?: string;
}

export interface InboundMessage {
  id: string;
  to: string;
  from: string;
  subject: string;
  body_text?: string;
  body_html?: string;
  received_at: string;
  user_id: string;
  inbox_id?: string | null;
  domain_id?: string | null;
  preview?: string;
  has_attachment?: boolean;
  attachments?: InboundAttachment[];
  spam_score?: number | null;
  spam_report?: string | null;
   /** Latest reply sent from the app to this inbound message (if any) */
  last_sent_reply_subject?: string | null;
  last_sent_reply_body?: string | null;
  last_sent_reply_at?: string | null;
  /** Thread id for grouping (Gmail-style). Same for all messages in one conversation. */
  thread_id?: string | null;
  /** Number of messages in this thread (when listing threads). */
  message_count?: number;
  /** Whether the user has opened this thread (MailBox read state). */
  is_read?: boolean;
  /** True when this thread includes an inbound reply linked to inbox warmup (warmup_sent). */
  warmup_thread?: boolean;
  /** Set on inbound documents when the message is a reply to a warmup send. */
  warmup_reply?: boolean;
  /** True when row is a compose/write-mail outbound message shown in MailBox lists. */
  compose_email?: boolean;
  /** Sender inbox email for compose rows (when available). */
  sender_email?: string;
}

/** Paginated MailBox thread list from GET /inbox/received. */
export interface ReceivedEmailsPage {
  threads: InboundMessage[];
  has_more: boolean;
}

/** One message in a received thread (inbound or outbound). */
export interface ReceivedThreadMessage {
  type: 'inbound' | 'outbound';
  id?: string;
  thread_id?: string;
  from?: string;
  to?: string;
  subject?: string;
  body_text?: string;
  body_html?: string;
  body?: string;
  received_at?: string;
  at?: string;
  preview?: string;
  /** Inbound: reply linked to a warmup send (warmup_sent). */
  warmup_reply?: boolean;
  [key: string]: unknown;
}

export interface ReceivedThread {
  thread_id: string;
  messages: ReceivedThreadMessage[];
}

export interface Subdomain {
  id: string;
  domain_id: string;
  subdomain: string;
  full_domain: string;
  status: 'pending' | 'verified';
  created_at: string;
}

export interface Inbox {
  id: string;
  user_id: string;
  domain_id?: string;
  subdomain_id?: string;
  email: string;
  sender_type: 'gmail' | 'smtp';
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  sender_name?: string;
  auto_sender_name?: string;
  effective_sender_name?: string;
  smtp_provider?: 'custom' | 'sendgrid' | 'pigeon';
  mailbox_id?: string;
  gmail_credentials_id?: string;
  auto_warmup?: boolean;
  /** When true, campaign sends use a tiered daily cap by inbox age (see create inbox). */
  campaign_rampup?: boolean;
  campaign_rampup_started_at?: string;
  warmup_progress: number;
  daily_limit: number;
  sent_today: number;
  status: 'warming' | 'ready' | 'paused';
  /** True when last 100 sent have zero opens/replies (warning tier) */
  warmup_warning?: boolean;
  /** True when last 200 sent have zero opens/replies (confirmed warm up required) */
  warm_up_required?: boolean;
  /** Warmup engagement mode: pool = artificial; network = own contacts; network_plus_shared = own + shared community pool */
  warmup_engagement_mode?: 'pool' | 'network' | 'network_plus_shared' | 'hybrid' | 'shared_pool';
  created_at: string;
  updated_at: string;
}

export interface WarmupNetworkContact {
  id: string;
  user_id: string;
  email: string;
  label?: string;
  created_at: string;
  updated_at: string;
}

export interface WarmupRecentSend {
  id: string;
  inbox_email: string;
  receiver_email: string;
  engagement_mode: 'pool' | 'network' | 'shared_pool' | 'quick';
  subject: string;
  sent_at: string;
}

export interface WarmupStats {
  sent_count_7d: number;
  replied_count_7d: number;
  replied_count_7d_pool_only?: number;
}

export interface WarmupSharedPoolEligibility {
  total_contacts: number;
  gmail_contacts: number;
  outlook_contacts: number;
  other_contacts: number;
  /** Gmail + Outlook only; eligibility ignores other providers. */
  gmail_outlook_contacts: number;
  required_total_contacts: number;
  required_gmail_contacts_at_minimum: number;
  required_outlook_contacts_at_minimum: number;
  required_gmail_contacts_for_current_total: number;
  required_outlook_contacts_for_current_total: number;
  qualifies: boolean;
  gmail_share: number;
  outlook_share: number;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface WarmupSharedPoolState {
  credits: {
    balance: number;
    total_purchased: number;
    total_earned: number;
    total_spent: number;
    cost_per_send: number;
    reward_per_rental: number;
    credits_held: number;
  };
  contributor: {
    enabled: boolean;
    eligibility: WarmupSharedPoolEligibility;
  };
  marketplace: {
    active_contributors: number;
    available_contacts: number;
    can_use_shared_pool: boolean;
  };
  transactions: CreditTransaction[];
}

export interface CreateDomainRequest {
  user_id: string;
  domain: string;
}

export interface CreateSubdomainRequest {
  subdomain: string;
}

export interface CreateInboxRequest {
  user_id: string;
  domain_id?: string;
  subdomain_id?: string;
  email: string;
  sender_type: 'gmail' | 'smtp';
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  sender_name?: string;
  smtp_password?: string;
  smtp_provider?: 'custom' | 'sendgrid' | 'pigeon';
  mailbox_id?: string;
  gmail_credentials_id?: string;
  daily_limit?: number;
  auto_warmup?: boolean;
  campaign_rampup?: boolean;
}

export interface DNSRecords {
  provider?: string; // Current email provider
  spf: {
    type: string;
    name: string;
    value: string;
    verified?: boolean;
  };
  dkim: {
    type: string;
    name: string;
    value: string;
    verified?: boolean;
  };
  dmarc: {
    type: string;
    name: string;
    value: string;
    verified?: boolean;
  };
  provider_specific?: {
    sendgrid_info?: {
      note: string;
      documentation: string;
    };
    mx_records?: Array<{
      type: string;
      name: string;
      value: string;
      priority: number;
      note?: string;
    }>;
    mx_records_optional?: Array<{
      type: string;
      name: string;
      value: string;
      priority: number;
      note?: string;
    }>;
    cname_records?: Array<{
      type: string;
      name: string;
      value: string;
      note?: string;
    }>;
  };
  email_infra?: {
    enabled: boolean;
    domain_id?: string | null;
    status?: string | null;
    vps_id?: string | null;
    mx_host?: string | null;
    inbound_webhook_url?: string | null;
    dkim?: string | null;
    spf?: string | null;
    dmarc?: string | null;
    last_verify_dns?: Record<string, unknown> | null;
    last_error?: string | null;
  };
  tracking?: {
    cname_target: string;
    configured_domain?: string | null;
    configured_verified?: boolean;
  };
}

export interface DNSProviderConnection {
  provider: "cloudflare" | "godaddy" | "namecheap" | "clouddns";
  connected: boolean;
  credential_previews?: Record<string, string>;
  updated_at?: string;
}

export interface VerificationResults {
  spf_verified: boolean;
  dkim_verified: boolean;
  dmarc_verified: boolean;
  spf_record_found?: string;
  dkim_record_found?: string;
  dmarc_record_found?: string;
  cname_verified?: boolean;
  mx_verified?: boolean;
}

export interface GmailAccount {
  id: string;
  email: string;
  sent_today: number;
  auth_method?: string; // "app_password" when added via email+password
}

export interface GmailStatus {
  connected: boolean;
  email?: string;
  sent_today?: number;
  accounts?: GmailAccount[];
}

export interface CampaignJob {
  id: string;
  job_type: string;
  status: string;
  scheduled_at?: string;
  started_at?: string;
  finished_at?: string;
  error_message?: string;
  action_config?: { campaign_id?: string };
  created_at?: string;
}

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  sender_name?: string;
  daily_limit: number;
  template_ids: string[];
  contact_list_ids: string[];
  contact_ids: string[];
  status: 'draft' | 'active' | 'paused' | 'completed' | 'pending';
  ai_prompt?: string;
  ai_provider?: string;
  use_ai_generation?: boolean;
  ai_generation_prompt?: string;
  ai_generation_provider?: string;
  /** Serper + LLM: search public snippets per lead, compact, then personalize template */
  use_external_enrichment?: boolean;
  external_enrichment_prompt?: string;
  external_enrichment_provider?: string;
  field_mapping: Record<string, string>;
  email_sequence: Array<{
    template_id: string;
    delay_days: number;
  }>;
  start_date?: string;
  start_time: string;
  end_time: string;
  /** Days to send: 0=Monday … 6=Sunday. Default Mon–Fri. */
  schedule_weekdays?: number[];
  timezone?: string;
  follow_up_delay_days?: number;
  sender_type: 'gmail' | 'smtp';
  sender_ids: string[];
  sender_rotation: 'round_robin' | 'random';
  rotation_enabled?: boolean;
  reply_to_type?: 'none' | 'gmail' | 'imap' | 'default' | 'custom';
  reply_to_id?: string | null;
  reply_to_email?: string | null;
  ab_winner_template_id?: string | null;
  ab_winner_set_at?: string | null;
  archived?: boolean;
  /** Include your saved Warmup Network emails as recipients; company is sampled from the selected list, names from each email. */
  campaign_real_engagement_network?: boolean;
  /** Rent additional recipients from the shared personal-network pool (1 credit per new recipient). */
  campaign_personal_network_pool?: boolean;
  /** Percentage of campaign daily volume reserved for real engagement recipients (20/40/60/80/100). */
  campaign_real_engagement_percent?: number;
  /** Toggle hidden tracking-pixel insertion for open tracking. */
  open_tracking?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReplyToImapConfig {
  id: string;
  user_id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  created_at?: string;
  updated_at?: string;
}

export interface Contact {
  id: string;
  user_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  industry?: string;
  custom_fields: Record<string, any>;
  status: 'pending' | 'sent' | 'opened' | 'clicked' | 'replied' | 'unsubscribed' | 'failed';
  sent_count?: number;
  blocked?: boolean;
  manual_unblock?: boolean;
  created_at: string;
}

export interface ContactHistoryEvent {
  type: 'sent' | 'opened' | 'clicked' | 'replied' | 'unsubscribed' | 'link_clicked';
  timestamp?: string;
  campaign_name?: string;
  campaign_id?: string;
  email_log_id?: string;
  subject?: string;
  url?: string;
  click_count?: number;
  metadata?: Record<string, any>;
}

export interface ContactHistory {
  contact: Contact;
  events: ContactHistoryEvent[];
  stats: {
    total_sent: number;
    total_opened: number;
    total_clicked: number;
    total_replied: number;
    total_link_clicks: number;
  };
  campaigns: { id: string; name: string }[];
}

export interface EmailTemplate {
  id: string;
  user_id: string;
  name: string;
  subject: string;
  body: string;
  body_type?: "html" | "plain" | "rich";
  sequence_number: number;
  created_at: string;
  updated_at: string;
}

export interface LLMConfig {
  user_id: string;
  provider: string;
  api_key?: string;  // Optional - not returned from API for security, but used when saving
  model_name?: string;
  created_at?: string;  // Optional when saving; backend sets it; present when returned from API
}

/** Who you want to reach — used to build web searches and AI steps in Smart Leads. */
export interface SmartLeadsAudience {
  target_company?: string;
  industry?: string;
  geography?: string;
  company_size?: string;
  job_titles_or_roles?: string;
  keywords?: string;
  audience_notes?: string;
  search_query_override?: string;
}

export interface SmartLeadsDiscoverRequest {
  ai_provider: string;
  audience: SmartLeadsAudience;
  num_results?: number;
}

export interface SmartLeadsDiscoverResponse {
  search_query: string;
  serper: {
    organic: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      position?: number;
      date?: string;
    }>;
    credits?: number;
  };
  ai: Record<string, unknown> | null;
  ai_raw: string | null;
}

export interface SmartLeadsRunCreateRequest {
  ai_provider: string;
  audience: SmartLeadsAudience;
  max_emails?: number;
  /** Result pages per company search (more = deeper results, more API usage). */
  company_search_pages?: number;
  /** Result pages per people search at each company. */
  employee_search_pages?: number;
  /** How many different searches to run to find companies. */
  company_queries?: number;
  /** How many different searches per company to find people. */
  employee_queries_per_company?: number;
  /** Optional cap on companies from search (default 100 on server if omitted). */
  max_companies?: number;
  /** Max people to save per company after search. */
  max_people_per_company?: number;
}

export interface SmartLeadsRunSummary {
  id: string;
  user_id?: string;
  status?: string;
  stage?: string;
  stage_detail?: string;
  progress_percent?: number;
  stats?: { companies?: number; people?: number; emails?: number; mx_ok?: number };
  error?: string | null;
  audience?: SmartLeadsAudience;
  company_search_pages?: number;
  employee_search_pages?: number;
  company_queries?: number;
  employee_queries_per_company?: number;
  max_companies?: number;
  max_people_per_company?: number;
  /** @deprecated Old runs only; email guessing is per company now. */
  max_people_in_email_prompt?: number;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface SmartLeadsRunStatusResponse {
  run_id: string;
  status?: string;
  stage?: string;
  stage_detail?: string;
  progress_percent?: number;
  stats: { companies?: number; people?: number; emails?: number; mx_ok?: number };
  error?: string | null;
  updated_at?: string;
}

export interface SmartLeadsCompanyRow {
  id: string;
  run_id: string;
  name?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
  snippet?: string | null;
  company_emails?: string[];
}

export interface SmartLeadsPersonRow {
  id: string;
  run_id: string;
  company_id?: string;
  company_name?: string | null;
  full_name?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  snippet?: string | null;
}

export interface SmartLeadsEmailRow {
  id: string;
  run_id: string;
  email: string;
  full_name?: string | null;
  company_name?: string | null;
  pattern?: string | null;
  confidence?: string | null;
  emails_json?: string;
  validation?: {
    valid?: boolean;
    syntax_ok?: boolean;
    mx_ok?: boolean;
    stop_forum_spam_ok?: boolean;
    normalized?: string | null;
    messages?: string[];
    /** SMTP RCPT result: valid = server accepted recipient; sent_probe may appear on legacy stored rows only */
    smtp_status?: string;
    /** Random RCPT to same MX also accepted — RCPT alone does not prove the mailbox exists */
    catch_all?: boolean;
    /** RCPT valid and domain is not catch-all (strongest SMTP check signal here) */
    mailbox_verified_strong?: boolean;
    /** 1–10 from Smart Leads ranking step (higher = LLM thinks more likely this person's inbox) */
    llm_candidate_score?: number;
    /** ZeroBounce validate API status when ZEROBOUNCE_API_KEY is set (e.g. valid, invalid, catch-all, unknown) */
    zerobounce_status?: string | null;
    zerobounce_sub_status?: string | null;
    zerobounce_error?: string | null;
    zerobounce?: Record<string, unknown> | null;
  };
}

export interface SmartLeadsRunDetailResponse {
  run: SmartLeadsRunSummary & {
    ai_provider?: string;
    max_emails?: number;
    company_search_pages?: number;
    employee_search_pages?: number;
    company_queries?: number;
    employee_queries_per_company?: number;
    max_companies?: number;
    max_people_per_company?: number;
    /** @deprecated Old runs only. */
    max_people_in_email_prompt?: number;
  };
  companies: SmartLeadsCompanyRow[];
  people: SmartLeadsPersonRow[];
  emails: SmartLeadsEmailRow[];
}

export interface AnalyticsData {
  total_sent: number;
  total_failed?: number;
  total_delivered?: number;
  total_pending?: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  deliverability_rate?: number;
  sent_change?: number;
  open_rate_change?: number;
  click_rate_change?: number;
  reply_rate_change?: number;
  deliverability_rate_change?: number;
}

export interface ContactList {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  contact_ids: string[];
  created_at: string;
  updated_at: string;
  contact_count?: number;
}

export interface AudiencePreview {
  total_contacts: number;
  verified: number;
  duplicates_removed: number;
  pending: number;
  blocked: number;
}

export interface Alert {
  id: string;
  user_id: string;
  type: "warning" | "error" | "info" | "success";
  title: string;
  message: string;
  time: string;
  is_read: boolean;
  actionable: boolean;
  /** Optional link for "Take action" (e.g. from admin-created alerts) */
  action_link?: string;
  created_at: string;
}

export interface InboxEmail {
  id: string;
  sender: string;
  senderEmail: string;
  /** Connected inbox email used to send campaign email/replies (if known). */
  sentFromInboxEmail?: string;
  subject: string;
  preview: string;
  body?: string;
  /** Message we sent (for context); the main body is the contact's reply */
  originalBody?: string;
  /** Our reply sent from the app (so thread shows "Your reply") */
  lastSentReplyBody?: string | null;
  time: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachment: boolean;
  campaign?: string;
  labels: string[];
  /** How this reply was received: reply_to (Gmail/IMAP) or domain_received (inbound to domain) */
  replySource?: "reply_to" | "domain_received";
  /** Gmail-style thread: ordered messages (our_send, their_reply, our_reply, ...) */
  messages?: Array<{
    type: 'our_send' | 'their_reply' | 'our_reply';
    body: string;
    at: string | null;
    from: 'us' | 'them';
    /** Optional HTML body for this message, when available */
    body_html?: string;
    /** Optional subject for this specific message */
    subject?: string;
  }>;
}

export interface WarmupTimelineData {
  day: string;
  volume: number;
  target: number;
}

export interface CampaignContactEvent {
  type: string;
  timestamp: string;
  metadata: Record<string, any>;
}

export interface CampaignContact {
  id: string;
  campaign_id: string;
  contact_id: string;
  user_id: string;
  status: 'pending' | 'sent' | 'opened' | 'clicked' | 'replied' | 'unsubscribed' | 'failed';
  last_activity?: string;
  events: CampaignContactEvent[];
  created_at: string;
  updated_at: string;
  contact_details?: Contact;
  /** Total link clicks by this contact in this campaign */
  click_count?: number;
}

export interface CampaignEnrichmentLead {
  id: string;
  user_id: string;
  campaign_id: string;
  contact_id: string;
  template_id: string;
  email_log_id?: string | null;
  provider?: string | null;
  queries?: string[];
  phone_query?: string | null;
  query_context?: Record<string, any>;
  serper_rows?: Array<Record<string, any>>;
  phone_search_rows?: Array<Record<string, any>>;
  selected_read_more_urls?: string[];
  page_extractions?: Array<Record<string, any>>;
  compacted_facts?: string | null;
  lead_object?: {
    person_name?: string | null;
    job_title?: string | null;
    person_linkedin_url?: string | null;
    company_name?: string | null;
    company_domain?: string | null;
    company_website_url?: string | null;
    company_phone?: string | null;
    company_phone_extension?: string | null;
    company_phone_candidates?: string[];
    company_summary?: string | null;
    recent_news?: string[];
    [key: string]: any;
  };
  status?: string;
  error?: string | null;
  tracker_status?: "new" | "contacted" | "in_progress" | "follow_up" | "qualified" | "disqualified";
  tracker_note?: string | null;
  tracker_updated_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface CampaignStats {
  sent: number;
  opened: number;
  clicked?: number;
  replied: number;
  complained?: number;
  openRate: number;
  clickRate?: number;
  replyRate: number;
  spamRate?: number;
  health: number;
}

export interface CampaignStatsByTemplateItem {
  templateId: string;
  templateName: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
}

export interface CampaignStatsByTemplate {
  byTemplate: CampaignStatsByTemplateItem[];
}

/** Placement probe classification from campaign deliverability service */
export type DeliverabilityClassification = 'spam' | 'inbox' | 'unknown' | 'error';

export interface DeliverabilityTestResultRow {
  domain_id?: string;
  subdomain_id?: string;
  root_label?: string;
  classification: DeliverabilityClassification;
  receiver_provider?: string;
}

export interface DeliverabilityTestSummary {
  checked: number;
  spam: number;
  inbox: number;
  unknown: number;
  error: number;
}

export interface DeliverabilityTestResultPayload {
  campaign_id: string;
  summary: DeliverabilityTestSummary;
  results: DeliverabilityTestResultRow[];
}

export type DeliverabilityRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CampaignDeliverabilityRun {
  id: string;
  campaign_id: string;
  user_id: string;
  status: DeliverabilityRunStatus;
  error?: string | null;
  result?: DeliverabilityTestResultPayload | null;
  created_at: string;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface StartDeliverabilityTestResponse {
  ok: boolean;
  campaign_id: string;
  run_id: string;
  status: string;
}

// Support tickets
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Ticket {
  id: string;
  user_id: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  author_type: 'user' | 'admin';
  body: string;
  created_at: string;
}

export interface CreateTicketRequest {
  subject: string;
  description: string;
  priority?: TicketPriority;
}

export interface UpdateTicketRequest {
  subject?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
}

export interface CreateTicketCommentRequest {
  body: string;
}

// Blog (public)
export interface Blog {
  id: string;
  title: string;
  slug: string;
  content?: string;
  excerpt?: string | null;
  author?: string | null;
  featured_image_url?: string | null;
  keywords?: string | null;
  tags?: string[] | null;
  status: string;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
}

// AI Campaign Studio (outreach) chat persistence
export interface OutreachChat {
  id: string;
  user_id: string;
  title: string;
  meta?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachChatMessage {
  id: string;
  chat_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

export interface OutreachChatWithMessages extends OutreachChat {
  messages: OutreachChatMessage[];
}

// Workflow engine (email workflows)

export interface WorkflowTrigger {
  type: 'onCampaignStarted' | 'onEmailSent' | 'onEmailOpened' | 'onEmailReplied';
  campaign_id?: string | null;
  list_id?: string | null;
  contact_id?: string | null;
}

export interface WorkflowNode {
  id: string;
  type: string;
  config: Record<string, any>;
  label?: string | null;
  position_x?: number | null;
  position_y?: number | null;
}

export interface WorkflowEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  label?: string | null;
}

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  scope: 'campaign' | 'list' | 'contact' | 'global';
  trigger: WorkflowTrigger;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  user_id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  trigger_context: Record<string, any>;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunStep {
  id: string;
  workflow_run_id: string;
  node_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  retry_count: number;
  context_before?: Record<string, any> | null;
  context_after?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}
