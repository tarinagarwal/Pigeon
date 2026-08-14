/**
 * Demo mode mock data.
 *
 * When the app is in demo mode (sessionStorage demo_mode=1 or ?demo=1 in URL),
 * all fetchAPI / fetchAPIWithETag calls are short-circuited here —
 * no request is ever sent to the FastAPI backend.
 *
 * GET calls return realistic placeholder data.
 * Mutating calls (POST / PUT / PATCH / DELETE) throw a DemoReadOnlyError
 * so the UI can display a friendly "read-only demo" message.
 */

export class DemoReadOnlyError extends Error {
  constructor() {
    super('This is a read-only demo. Sign up to make changes.');
    this.name = 'DemoReadOnlyError';
  }
}

// ---------------------------------------------------------------------------
// Shared IDs used across fixture objects so foreign keys align
// ---------------------------------------------------------------------------
const D_USER = 'demo-user';
const D_DOMAIN_1 = 'demo-domain-1';
const D_DOMAIN_2 = 'demo-domain-2';
const D_SUBDOMAIN_1 = 'demo-subdomain-1';
const D_INBOX_1 = 'demo-inbox-1';
const D_INBOX_2 = 'demo-inbox-2';
const D_INBOX_3 = 'demo-inbox-3';
const D_CAMPAIGN_1 = 'demo-campaign-1';
const D_CAMPAIGN_2 = 'demo-campaign-2';
const D_TEMPLATE_1 = 'demo-template-1';
const D_TEMPLATE_2 = 'demo-template-2';
const D_LIST_1 = 'demo-list-1';
const D_LIST_2 = 'demo-list-2';

const now = () => new Date().toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DOMAINS = [
  {
    id: D_DOMAIN_1,
    user_id: D_USER,
    domain: 'outreach-demo.com',
    status: 'verified',
    sending_provider: 'sendgrid',
    spf_verified: true,
    dkim_selector: 'sendgrid',
    dkim_verified: true,
    dmarc_verified: true,
    cname_verified: true,
    mx_verified: true,
    health_score: 92,
    created_at: daysAgo(30),
    verified_at: daysAgo(29),
    inbound_parse_enabled: false,
  },
  {
    id: D_DOMAIN_2,
    user_id: D_USER,
    domain: 'growth-mail.io',
    status: 'verified',
    sending_provider: 'sendgrid',
    spf_verified: true,
    dkim_selector: 'sendgrid',
    dkim_verified: true,
    dmarc_verified: true,
    cname_verified: true,
    mx_verified: true,
    health_score: 87,
    created_at: daysAgo(20),
    verified_at: daysAgo(19),
    inbound_parse_enabled: false,
  },
];

const SUBDOMAINS = [
  {
    id: D_SUBDOMAIN_1,
    domain_id: D_DOMAIN_1,
    subdomain: 'mail',
    full_domain: 'mail.outreach-demo.com',
    status: 'verified',
    created_at: daysAgo(28),
  },
];

const INBOXES = [
  {
    id: D_INBOX_1,
    user_id: D_USER,
    domain_id: D_DOMAIN_1,
    subdomain_id: null,
    email: 'john@outreach-demo.com',
    sender_type: 'smtp',
    smtp_host: 'smtp.pigeon.ai',
    smtp_port: 587,
    smtp_username: 'john@outreach-demo.com',
    smtp_provider: 'pigeon',
    gmail_credentials_id: null,
    auto_warmup: true,
    warmup_progress: 78,
    daily_limit: 50,
    sent_today: 31,
    status: 'ready',
    warmup_warning: false,
    warm_up_required: false,
    created_at: daysAgo(25),
    updated_at: daysAgo(1),
  },
  {
    id: D_INBOX_2,
    user_id: D_USER,
    domain_id: D_DOMAIN_1,
    subdomain_id: null,
    email: 'sarah@outreach-demo.com',
    sender_type: 'smtp',
    smtp_host: 'smtp.pigeon.ai',
    smtp_port: 587,
    smtp_username: 'sarah@outreach-demo.com',
    smtp_provider: 'pigeon',
    gmail_credentials_id: null,
    auto_warmup: true,
    warmup_progress: 55,
    daily_limit: 40,
    sent_today: 18,
    status: 'warming',
    warmup_warning: false,
    warm_up_required: false,
    created_at: daysAgo(18),
    updated_at: daysAgo(1),
  },
  {
    id: D_INBOX_3,
    user_id: D_USER,
    domain_id: D_DOMAIN_2,
    subdomain_id: null,
    email: 'campaigns@growth-mail.io',
    sender_type: 'gmail',
    smtp_host: null,
    smtp_port: null,
    smtp_username: null,
    smtp_provider: null,
    gmail_credentials_id: 'demo-gmail-cred-1',
    auto_warmup: false,
    warmup_progress: 100,
    daily_limit: 100,
    sent_today: 42,
    status: 'ready',
    warmup_warning: false,
    warm_up_required: false,
    created_at: daysAgo(12),
    updated_at: daysAgo(1),
  },
];

const TEMPLATES = [
  {
    id: D_TEMPLATE_1,
    user_id: D_USER,
    name: 'Cold Intro — SaaS Founders',
    subject: 'Quick question about {{company}}',
    body: `Hi {{first_name}},\n\nI noticed {{company}} is scaling fast — congrats on that.\n\nWe help SaaS teams like yours book 3–5 extra demos a week through targeted cold email. Mind if I share a quick overview?\n\nBest,\nJohn`,
    body_type: 'plain',
    sequence_number: 1,
    created_at: daysAgo(22),
    updated_at: daysAgo(5),
  },
  {
    id: D_TEMPLATE_2,
    user_id: D_USER,
    name: 'Follow-up Day 3',
    subject: 'Re: Quick question about {{company}}',
    body: `Hi {{first_name}},\n\nJust following up on my note from a few days ago — wanted to make sure it didn't get lost.\n\nWe've helped companies like Acme Corp and TechFlow add $40k+ ARR in under 90 days. Happy to share the case study.\n\nWorth a 15-min call?\n\nJohn`,
    body_type: 'plain',
    sequence_number: 2,
    created_at: daysAgo(22),
    updated_at: daysAgo(5),
  },
];

const CONTACT_LISTS = [
  {
    id: D_LIST_1,
    user_id: D_USER,
    name: 'SaaS Founders — Series A',
    description: 'Series A founders from Crunchbase export, Q4 2024',
    contact_ids: [],
    contact_count: 150,
    created_at: daysAgo(21),
    updated_at: daysAgo(3),
  },
  {
    id: D_LIST_2,
    user_id: D_USER,
    name: 'Enterprise CTOs',
    description: 'LinkedIn Sales Nav export — enterprise tech',
    contact_ids: [],
    contact_count: 87,
    created_at: daysAgo(14),
    updated_at: daysAgo(2),
  },
];

const CONTACTS = [
  { id: 'dc1', user_id: D_USER, email: 'alex.chen@acmecorp.com', first_name: 'Alex', last_name: 'Chen', company: 'Acme Corp', industry: 'SaaS', custom_fields: {}, status: 'replied', sent_count: 2, blocked: false, created_at: daysAgo(20) },
  { id: 'dc2', user_id: D_USER, email: 'priya.sharma@techflow.io', first_name: 'Priya', last_name: 'Sharma', company: 'TechFlow', industry: 'FinTech', custom_fields: {}, status: 'opened', sent_count: 1, blocked: false, created_at: daysAgo(19) },
  { id: 'dc3', user_id: D_USER, email: 'mark.johnson@growthco.com', first_name: 'Mark', last_name: 'Johnson', company: 'GrowthCo', industry: 'MarTech', custom_fields: {}, status: 'sent', sent_count: 1, blocked: false, created_at: daysAgo(18) },
  { id: 'dc4', user_id: D_USER, email: 'lisa.wang@nexusai.com', first_name: 'Lisa', last_name: 'Wang', company: 'NexusAI', industry: 'AI/ML', custom_fields: {}, status: 'pending', sent_count: 0, blocked: false, created_at: daysAgo(17) },
  { id: 'dc5', user_id: D_USER, email: 'tom.nguyen@cloudpeak.io', first_name: 'Tom', last_name: 'Nguyen', company: 'CloudPeak', industry: 'DevOps', custom_fields: {}, status: 'opened', sent_count: 1, blocked: false, created_at: daysAgo(16) },
];

const CAMPAIGNS = [
  {
    id: D_CAMPAIGN_1,
    user_id: D_USER,
    name: 'Q4 SaaS Outreach',
    sender_name: 'John from Pigeon',
    daily_limit: 80,
    template_ids: [D_TEMPLATE_1, D_TEMPLATE_2],
    contact_list_ids: [D_LIST_1],
    contact_ids: [],
    status: 'active',
    ai_prompt: null,
    ai_provider: null,
    use_ai_generation: false,
    ai_generation_prompt: null,
    ai_generation_provider: null,
    use_external_enrichment: false,
    external_enrichment_prompt: null,
    external_enrichment_provider: null,
    field_mapping: { first_name: 'first_name', company: 'company' },
    email_sequence: [
      { template_id: D_TEMPLATE_1, delay_days: 0 },
      { template_id: D_TEMPLATE_2, delay_days: 3 },
    ],
    start_date: daysAgo(15),
    start_time: '09:00',
    end_time: '17:00',
    timezone: 'America/New_York',
    follow_up_delay_days: 3,
    sender_type: 'smtp',
    sender_ids: [D_INBOX_1, D_INBOX_2],
    sender_rotation: 'round_robin',
    rotation_enabled: true,
    reply_to_type: 'default',
    reply_to_id: null,
    reply_to_email: null,
    ab_winner_template_id: null,
    ab_winner_set_at: null,
    archived: false,
    created_at: daysAgo(16),
    updated_at: daysAgo(1),
  },
  {
    id: D_CAMPAIGN_2,
    user_id: D_USER,
    name: 'Enterprise Lead Gen',
    sender_name: 'Sarah — Pigeon',
    daily_limit: 60,
    template_ids: [D_TEMPLATE_1],
    contact_list_ids: [D_LIST_2],
    contact_ids: [],
    status: 'paused',
    ai_prompt: null,
    ai_provider: null,
    use_ai_generation: false,
    ai_generation_prompt: null,
    ai_generation_provider: null,
    use_external_enrichment: false,
    external_enrichment_prompt: null,
    external_enrichment_provider: null,
    field_mapping: { first_name: 'first_name', company: 'company' },
    email_sequence: [{ template_id: D_TEMPLATE_1, delay_days: 0 }],
    start_date: daysAgo(8),
    start_time: '08:00',
    end_time: '18:00',
    timezone: 'America/Chicago',
    follow_up_delay_days: 4,
    sender_type: 'smtp',
    sender_ids: [D_INBOX_2],
    sender_rotation: 'round_robin',
    rotation_enabled: false,
    reply_to_type: 'default',
    reply_to_id: null,
    reply_to_email: null,
    ab_winner_template_id: null,
    ab_winner_set_at: null,
    archived: false,
    created_at: daysAgo(9),
    updated_at: daysAgo(2),
  },
];

const CAMPAIGN_STATS = {
  [D_CAMPAIGN_1]: { sent: 312, opened: 101, clicked: 28, replied: 19, openRate: 32.4, clickRate: 9.0, replyRate: 6.1, health: 88 },
  [D_CAMPAIGN_2]: { sent: 87, opened: 24, clicked: 6, replied: 5, openRate: 27.6, clickRate: 6.9, replyRate: 5.7, health: 82 },
};

const CAMPAIGN_STATS_BY_TEMPLATE = {
  [D_CAMPAIGN_1]: {
    byTemplate: [
      { templateId: D_TEMPLATE_1, templateName: 'Cold Intro — SaaS Founders', sent: 150, opened: 55, clicked: 18, replied: 12, openRate: 36.7, clickRate: 12.0, replyRate: 8.0 },
      { templateId: D_TEMPLATE_2, templateName: 'Follow-up Day 3', sent: 162, opened: 46, clicked: 10, replied: 7, openRate: 28.4, clickRate: 6.2, replyRate: 4.3 },
    ],
  },
  [D_CAMPAIGN_2]: {
    byTemplate: [
      { templateId: D_TEMPLATE_1, templateName: 'Cold Intro — SaaS Founders', sent: 87, opened: 24, clicked: 6, replied: 5, openRate: 27.6, clickRate: 6.9, replyRate: 5.7 },
    ],
  },
};

const ANALYTICS: Record<string, unknown> = {
  total_sent: 399,
  total_failed: 4,
  total_delivered: 395,
  total_pending: 0,
  total_opened: 125,
  total_clicked: 34,
  total_replied: 24,
  open_rate: 31.6,
  click_rate: 8.5,
  reply_rate: 6.0,
  deliverability_rate: 99.0,
  sent_change: 12.4,
  open_rate_change: 2.1,
  click_rate_change: 0.5,
  reply_rate_change: 1.2,
  deliverability_rate_change: 0.0,
};

function buildTimeline() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const sent = Math.floor(5 + Math.random() * 25);
    const opened = Math.floor(sent * (0.25 + Math.random() * 0.15));
    const replied = Math.floor(opened * (0.1 + Math.random() * 0.1));
    return { day, sent, opened, replied };
  });
}

function buildHourly() {
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: h >= 8 && h <= 18 ? Math.floor(5 + Math.random() * 20) : Math.floor(Math.random() * 3),
  }));
}

const WARMUP_STATS = {
  sent_count_7d: 84,
  replied_count_7d: 11,
  replied_count_7d_pool_only: 8,
};

function buildWarmupTimeline() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const target = Math.min(10 + i * 3, 100);
    const volume = Math.floor(target * (0.85 + Math.random() * 0.15));
    return { day, volume, target };
  });
}

const INBOX_EMAILS = [
  {
    id: 'die1',
    sender: 'Alex Chen',
    senderEmail: 'alex.chen@acmecorp.com',
    subject: 'Re: Quick question about Acme Corp',
    preview: "Thanks for reaching out! I'd love to learn more about your solution…",
    body: "Thanks for reaching out! I'd love to learn more about your solution. Could we schedule a 15-min call this week?",
    originalBody: 'Hi Alex,\n\nI noticed Acme Corp is scaling fast…',
    lastSentReplyBody: null,
    time: daysAgo(1),
    isRead: false,
    isStarred: true,
    hasAttachment: false,
    campaign: 'Q4 SaaS Outreach',
    labels: ['Interested'],
    replySource: 'reply_to',
  },
  {
    id: 'die2',
    sender: 'Priya Sharma',
    senderEmail: 'priya.sharma@techflow.io',
    subject: 'Re: Quick question about TechFlow',
    preview: "Interesting timing — we've actually been evaluating cold email tools…",
    body: "Interesting timing — we've actually been evaluating cold email tools. Can you send over a case study?",
    originalBody: 'Hi Priya,\n\nI noticed TechFlow is scaling fast…',
    lastSentReplyBody: null,
    time: daysAgo(2),
    isRead: true,
    isStarred: false,
    hasAttachment: false,
    campaign: 'Q4 SaaS Outreach',
    labels: ['Follow-up'],
    replySource: 'reply_to',
  },
];

const SETTINGS = {
  user_id: D_USER,
  timezone: 'America/New_York',
  default_daily_limit: 50,
  reply_tracking: true,
  open_tracking: true,
  click_tracking: false,
  unsubscribe_link: true,
  signature: '',
};

const ALERTS = [
  {
    id: 'demo-alert-1',
    user_id: D_USER,
    type: 'info',
    title: 'You\'re in demo mode',
    message: 'This is a read-only tour. Sign up to start sending real campaigns.',
    time: now(),
    is_read: false,
    actionable: true,
    action_link: '/signup',
    created_at: now(),
  },
];

const LLM_CONFIGS = [
  {
    user_id: D_USER,
    provider: 'openai',
    model_name: 'gpt-4o-mini',
    created_at: daysAgo(10),
  },
];

// ---------------------------------------------------------------------------
// Router — matches endpoint paths against fixture data
// ---------------------------------------------------------------------------

/**
 * Returns mock data for a given HTTP method + endpoint, or null if the
 * endpoint has no mock (caller should proceed to backend in that case).
 *
 * Throws DemoReadOnlyError for mutating methods so the UI can display
 * a friendly "read-only demo" message.
 */
export function getDemoData(method: string, endpoint: string): unknown {
  const m = method.toUpperCase();

  // Strip query string for routing
  const path = endpoint.split('?')[0].replace(/\/$/, '');

  // ---- Mutations: block all write operations ----
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    // Allow /api/demo/logout silently
    if (path === '/api/demo/logout') return { ok: true };
    if (path === '/smart-leads/discover') {
      return {
        search_query: 'demo query',
        serper: {
          organic: [
            {
              title: 'Example Company — Careers',
              link: 'https://example.com/careers',
              snippet: 'We are hiring sales leaders in enterprise SaaS…',
              position: 1,
            },
          ],
          credits: 1,
        },
        ai: {
          summary:
            'Demo mode: Smart Leads shows a sample result. Sign in with a real account and configure SERPER_API_KEY on the server to run live searches.',
          audience_fit: 'This is static demo data.',
          top_results: [
            {
              title: 'Example Company — Careers',
              url: 'https://example.com/careers',
              relevance_score: 8,
              why_it_matters: 'Illustrative match for your ICP.',
            },
          ],
          suggested_follow_up_searches: ['VP sales SaaS Series B Bay Area'],
          outreach_angles: ['Mention recent hiring growth from careers page'],
        },
        ai_raw: null,
      };
    }
    if (path === '/smart-leads/runs') {
      return { run_id: 'demo-smart-leads-run', status: 'running' };
    }
    const smartContinueMatch = path.match(/^\/smart-leads\/runs\/([^/]+)\/continue$/);
    if (smartContinueMatch) {
      return { run_id: smartContinueMatch[1], status: 'running' };
    }
    const deliverabilityMatch = path.match(/^\/campaigns\/([^/]+)\/deliverability-test$/);
    if (deliverabilityMatch) {
      const cid = deliverabilityMatch[1];
      return {
        ok: true,
        campaign_id: cid,
        run_id: 'demo-placement-run-1',
        status: 'queued',
      };
    }
    throw new DemoReadOnlyError();
  }

  // ---- GET routes ----

  // /domains
  if (path === '/domains') return DOMAINS;

  // /domains/:id
  const domainMatch = path.match(/^\/domains\/([^/]+)$/);
  if (domainMatch) {
    return DOMAINS.find((d) => d.id === domainMatch[1]) ?? DOMAINS[0];
  }

  // /domains/:id/subdomains
  const subdomainListMatch = path.match(/^\/domains\/([^/]+)\/subdomains$/);
  if (subdomainListMatch) return SUBDOMAINS;

  // /domains/:id/dns-records
  if (path.match(/^\/domains\/[^/]+\/dns-records$/)) {
    return {
      provider: 'sendgrid',
      spf: { type: 'TXT', name: '@', value: 'v=spf1 include:sendgrid.net ~all', verified: true },
      dkim: { type: 'TXT', name: 'sendgrid._domainkey', value: 'v=DKIM1; k=rsa; p=MIGfMA0G...', verified: true },
      dmarc: { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=quarantine;', verified: true },
    };
  }

  // /inboxes
  if (path === '/inboxes') return INBOXES;

  // /inboxes/:id
  const inboxMatch = path.match(/^\/inboxes\/([^/]+)$/);
  if (inboxMatch) {
    return INBOXES.find((i) => i.id === inboxMatch[1]) ?? INBOXES[0];
  }

  // /campaigns
  if (path === '/campaigns') return CAMPAIGNS;

  // /campaigns/:id
  const campaignMatch = path.match(/^\/campaigns\/([^/]+)$/);
  if (campaignMatch) {
    return CAMPAIGNS.find((c) => c.id === campaignMatch[1]) ?? CAMPAIGNS[0];
  }

  // /campaigns/:id/stats
  const campaignStatsMatch = path.match(/^\/campaigns\/([^/]+)\/stats$/);
  if (campaignStatsMatch) {
    const key = campaignStatsMatch[1] as keyof typeof CAMPAIGN_STATS;
    return CAMPAIGN_STATS[key] ?? CAMPAIGN_STATS[D_CAMPAIGN_1];
  }

  // /campaigns/:id/stats-by-template
  const campaignStatsByTplMatch = path.match(/^\/campaigns\/([^/]+)\/stats-by-template$/);
  if (campaignStatsByTplMatch) {
    const key = campaignStatsByTplMatch[1] as keyof typeof CAMPAIGN_STATS_BY_TEMPLATE;
    return CAMPAIGN_STATS_BY_TEMPLATE[key] ?? CAMPAIGN_STATS_BY_TEMPLATE[D_CAMPAIGN_1];
  }

  // /campaigns/:id/deliverability-runs
  const deliverabilityRunsGet = path.match(/^\/campaigns\/([^/]+)\/deliverability-runs$/);
  if (deliverabilityRunsGet) {
    const cid = deliverabilityRunsGet[1];
    const now = new Date().toISOString();
    return {
      runs: [
        {
          id: 'demo-placement-run-1',
          campaign_id: cid,
          user_id: D_USER,
          status: 'completed',
          error: null,
          result: {
            campaign_id: cid,
            summary: { checked: 4, spam: 0, inbox: 3, unknown: 1, error: 0 },
            results: [
              { root_label: 'demo-mail.example.com', classification: 'inbox', receiver_provider: 'gmail' },
              { root_label: 'demo-mail.example.com', classification: 'inbox', receiver_provider: 'outlook' },
              { root_label: 'outreach.example.com', classification: 'unknown', receiver_provider: 'gmail' },
              { root_label: 'outreach.example.com', classification: 'inbox', receiver_provider: 'outlook' },
            ],
          },
          created_at: now,
          updated_at: now,
          started_at: now,
          completed_at: now,
        },
      ],
    };
  }

  // /campaigns/:id/jobs
  if (path.match(/^\/campaigns\/[^/]+\/jobs$/)) {
    return [];
  }

  // /campaigns/:id/contacts
  if (path.match(/^\/campaigns\/[^/]+\/contacts$/)) {
    return CONTACTS.map((c) => ({
      id: `cc-${c.id}`,
      campaign_id: D_CAMPAIGN_1,
      contact_id: c.id,
      user_id: D_USER,
      status: c.status,
      last_activity: daysAgo(1),
      events: [],
      created_at: c.created_at,
      updated_at: daysAgo(1),
      contact_details: c,
      click_count: 0,
    }));
  }

  // /contacts
  if (path === '/contacts') {
    return { contacts: CONTACTS, total: CONTACTS.length };
  }

  // /contacts/:id/history
  const contactHistoryMatch = path.match(/^\/contacts\/([^/]+)\/history$/);
  if (contactHistoryMatch) {
    const c = CONTACTS.find((x) => x.id === contactHistoryMatch[1]) ?? CONTACTS[0];
    return {
      contact: c,
      events: [
        { type: 'sent', timestamp: daysAgo(5), campaign_name: 'Q4 SaaS Outreach', campaign_id: D_CAMPAIGN_1 },
        { type: 'opened', timestamp: daysAgo(4), campaign_name: 'Q4 SaaS Outreach', campaign_id: D_CAMPAIGN_1 },
        { type: 'replied', timestamp: daysAgo(3), campaign_name: 'Q4 SaaS Outreach', campaign_id: D_CAMPAIGN_1 },
      ],
      stats: { total_sent: 1, total_opened: 1, total_clicked: 0, total_replied: 1, total_link_clicks: 0 },
      campaigns: [{ id: D_CAMPAIGN_1, name: 'Q4 SaaS Outreach' }],
    };
  }

  // /contact-lists
  if (path === '/contact-lists') return CONTACT_LISTS;

  // /contact-lists/:id
  const listMatch = path.match(/^\/contact-lists\/([^/]+)$/);
  if (listMatch) {
    return CONTACT_LISTS.find((l) => l.id === listMatch[1]) ?? CONTACT_LISTS[0];
  }

  // /contact-lists/:id/audience-preview
  if (path.match(/^\/contact-lists\/[^/]+\/audience-preview$/)) {
    return { total_contacts: 150, verified: 142, duplicates_removed: 3, pending: 5, blocked: 0 };
  }

  // /contact-lists/:id/contacts
  if (path.match(/^\/contact-lists\/[^/]+\/contacts$/)) {
    return CONTACTS;
  }

  // /templates
  if (path === '/templates') return TEMPLATES;

  // /templates/:id
  const templateMatch = path.match(/^\/templates\/([^/]+)$/);
  if (templateMatch) {
    return TEMPLATES.find((t) => t.id === templateMatch[1]) ?? TEMPLATES[0];
  }

  // /analytics
  if (path === '/analytics') return ANALYTICS;

  // /analytics/timeline
  if (path === '/analytics/timeline') return buildTimeline();

  // /analytics/sending-hourly
  if (path === '/analytics/sending-hourly') return buildHourly();

  // /analytics/sending-by-inbox
  if (path === '/analytics/sending-by-inbox') {
    return [
      { inbox_email: 'john@outreach-demo.com', count: 220 },
      { inbox_email: 'sarah@outreach-demo.com', count: 91 },
      { inbox_email: 'campaigns@growth-mail.io', count: 88 },
    ];
  }

  // /analytics/sending-by-campaign
  if (path === '/analytics/sending-by-campaign') {
    return [
      { campaign_name: 'Q4 SaaS Outreach', count: 312 },
      { campaign_name: 'Enterprise Lead Gen', count: 87 },
    ];
  }

  // /analytics/sending-insights
  if (path === '/analytics/sending-insights') {
    return {
      total_sent: 399,
      peak_hour_utc: 14,
      top_inbox_email: 'john@outreach-demo.com',
      top_campaign_name: 'Q4 SaaS Outreach',
    };
  }

  // /analytics/best-send-time
  if (path === '/analytics/best-send-time') {
    return { best_hour_utc: 14, best_day: 'Tuesday', confidence: 'high' };
  }

  // /analytics/activity
  if (path === '/analytics/activity') {
    return {
      activities: [
        { type: 'email_sent', timestamp: daysAgo(0), description: 'Sent to alex.chen@acmecorp.com', campaign: 'Q4 SaaS Outreach' },
        { type: 'email_opened', timestamp: daysAgo(0), description: 'alex.chen@acmecorp.com opened your email', campaign: 'Q4 SaaS Outreach' },
        { type: 'email_replied', timestamp: daysAgo(1), description: 'priya.sharma@techflow.io replied to your email', campaign: 'Q4 SaaS Outreach' },
      ],
    };
  }

  // /alerts
  if (path === '/alerts') return ALERTS;

  // /warmup/stats
  if (path === '/warmup/stats') return WARMUP_STATS;

  // /warmup/timeline
  if (path === '/warmup/timeline') return buildWarmupTimeline();

  // /warmup/send-templates
  if (path === '/warmup/send-templates') return [];

  // /inbox/emails
  if (path === '/inbox/emails') return INBOX_EMAILS;

  // /inbox/received
  if (path === '/inbox/received') return INBOX_EMAILS;

  // /inbox/received/:id
  if (path.match(/^\/inbox\/received\/[^/]+$/)) return INBOX_EMAILS[0] ?? null;

  // /gmail/status
  if (path === '/gmail/status') {
    return {
      connected: true,
      email: 'campaigns@growth-mail.io',
      sent_today: 42,
      accounts: [{ id: 'demo-gmail-cred-1', email: 'campaigns@growth-mail.io', sent_today: 42 }],
    };
  }

  // /llm/configs
  if (path === '/llm/configs') return LLM_CONFIGS;

  // /llm/check-config
  if (path === '/llm/check-config') return { configured: true, provider: 'openai' };

  // /outreach/chats
  if (path === '/outreach/chats') return [];

  // /settings
  if (path === '/settings') return SETTINGS;

  // /settings/google-oauth
  if (path === '/settings/google-oauth') return { client_id: null, client_secret: null };

  // /settings/gmail-oauth-status
  if (path === '/settings/gmail-oauth-status') return { configured: false };

  // /settings/serper
  if (path === '/settings/serper') return { serper_configured: false };

  // /smart-leads/runs (list)
  if (path === '/smart-leads/runs') {
    return {
      runs: [],
      total: 0,
      skip: 0,
      limit: 30,
    };
  }

  const smartStatusMatch = path.match(/^\/smart-leads\/runs\/([^/]+)\/status$/);
  if (smartStatusMatch) {
    return {
      run_id: smartStatusMatch[1],
      status: 'completed',
      stage: 'done',
      stage_detail: 'Demo mode',
      progress_percent: 100,
      stats: { companies: 0, people: 0, emails: 0, mx_ok: 0 },
      error: null,
      updated_at: new Date().toISOString(),
    };
  }

  const smartDetailMatch = path.match(/^\/smart-leads\/runs\/([^/]+)$/);
  if (smartDetailMatch) {
    const rid = smartDetailMatch[1];
    return {
      run: {
        id: rid,
        status: 'completed',
        stage: 'done',
        stats: { companies: 0, people: 0, emails: 0, mx_ok: 0 },
        created_at: new Date().toISOString(),
      },
      companies: [],
      people: [],
      emails: [],
    };
  }

  // /reply-to-imap-configs
  if (path === '/reply-to-imap-configs') return [];

  // /webhooks
  if (path === '/webhooks') return [];

  // /tickets
  if (path === '/tickets') return [];

  // /auth/sessions
  if (path === '/auth/sessions') return { sessions: [] };

  // /auth/me — handled by /api/demo/me Next.js route, but guard here too
  if (path === '/auth/me') return null;

  // /region
  if (path === '/region') return { country_code: null, is_india: null };

  // Unknown endpoint — return null so caller can decide what to do
  return null;
}
