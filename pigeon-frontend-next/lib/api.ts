import type {
  Domain,
  Subdomain,
  Inbox,
  CreateDomainRequest,
  CreateSubdomainRequest,
  CreateInboxRequest,
  DNSRecords,
  DNSProviderConnection,
  VerificationResults,
  GmailStatus,
  Campaign,
  CampaignJob,
  CampaignContact,
  CampaignEnrichmentLead,
  Contact,
  ContactHistory,
  EmailTemplate,
  ContactList,
  AudiencePreview,
  AnalyticsData,
  LLMConfig,
  SmartLeadsDiscoverRequest,
  SmartLeadsDiscoverResponse,
  SmartLeadsRunCreateRequest,
  SmartLeadsRunStatusResponse,
  SmartLeadsRunDetailResponse,
  SmartLeadsRunSummary,
  Alert,
  InboxEmail,
  InboundMessage,
  ReceivedEmailsPage,
  ReceivedThread,
  WarmupTimelineData,
  CampaignStats,
  CampaignStatsByTemplate,
  CampaignDeliverabilityRun,
  StartDeliverabilityTestResponse,
  Ticket,
  TicketComment,
  CreateTicketRequest,
  UpdateTicketRequest,
  CreateTicketCommentRequest,
  ReplyToImapConfig,
  Blog,
  OutreachChat,
  OutreachChatMessage,
  OutreachChatWithMessages,
  WarmupSharedPoolState,
  WarmupStats,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
} from '@/types/api';
import { getDemoData } from '@/lib/demo-data';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
const DEMO_STORAGE_KEY = 'demo_mode';
/** Same key AuthContext uses so we can treat stored demo user as demo mode even before URL/storage is set */
const AUTH_USER_KEY = 'auth_user';

/**
 * Active workspace context: when a sub-user switches into another workspace,
 * this is set to the owner's user_id. Every fetchAPI call then includes the
 * X-Workspace-Context header so the backend serves the owner's data.
 */
let _workspaceContext: string | null = null;

export function setWorkspaceContext(ownerId: string | null): void {
  _workspaceContext = ownerId;
}

export function getWorkspaceContext(): string | null {
  return _workspaceContext;
}

/** ETag cache for conditional GET (304) – keyed by stringified queryKey */
const etagStore = new Map<string, string>();

/** Context for list endpoints that support ETag/304. When provided, 304 responses return cached data. */
export type FetchEtagContext<T> = {
  queryKey: unknown[];
  getCachedData: () => T | undefined;
};

function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
      return true;
    }
    if (window.sessionStorage.getItem(DEMO_STORAGE_KEY) === '1') return true;
    if (window.localStorage.getItem(DEMO_STORAGE_KEY) === '1') {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
      return true;
    }
    // Stored user is demo-user (e.g. after refresh or race before sessionStorage was set)
    const stored = window.sessionStorage.getItem(AUTH_USER_KEY) || window.localStorage.getItem(AUTH_USER_KEY);
    if (stored) {
      try {
        const user = JSON.parse(stored) as { id?: string };
        if (user?.id === 'demo-user') {
          window.sessionStorage.setItem(DEMO_STORAGE_KEY, '1');
          return true;
        }
      } catch {
        // ignore parse errors
      }
    }
    return false;
  } catch {
    return false;
  }
}

function withDemoParam(endpoint: string): string {
  if (typeof window === 'undefined') return endpoint;
  if (!isDemoMode()) return endpoint;
  // Avoid duplicating the demo flag if it is already present
  if (endpoint.includes('demo=')) return endpoint;
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}demo=1`;
}

export interface ContactUploadErrorPayload {
  code: string;
  message: string;
  fix: string;
  detail?: string;
}

export class ContactUploadError extends Error {
  code: string;
  fix: string;
  detail: string;

  constructor(payload: ContactUploadErrorPayload) {
    super(payload.message);
    this.name = 'ContactUploadError';
    this.code = payload.code;
    this.fix = payload.fix;
    this.detail = payload.detail ?? payload.message;
  }
}

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  if (options?.headers) {
    const extra = new Headers(options.headers as HeadersInit);
    extra.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const demo = isDemoMode();
  if (demo) {
    headers.set('X-Demo-Mode', '1');
    const mock = getDemoData(options?.method ?? 'GET', endpoint);
    if (mock !== null) return mock as T;
  }

  // Workspace context: sub-user operating in another user's workspace
  if (_workspaceContext) {
    headers.set('X-Workspace-Context', _workspaceContext);
  }

  const endpointWithDemo = withDemoParam(endpoint);

  const response = await fetch(`${API_BASE_URL}${endpointWithDemo}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('auth_user');
      sessionStorage.removeItem('auth_user');
      if (!demo) window.location.href = '/login';
      throw new Error('Authentication required');
    }
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    const message =
      typeof error.detail === 'string'
        ? error.detail
        : Array.isArray(error.detail) && error.detail.length > 0
          ? error.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join('; ')
          : error.detail?.msg ?? response.statusText;
    throw new Error(message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

function normalizeReceivedEmailsPage(data: ReceivedEmailsPage | InboundMessage[]): ReceivedEmailsPage {
  if (Array.isArray(data)) {
    return { threads: data, has_more: false };
  }
  return {
    threads: data?.threads ?? [],
    has_more: Boolean(data?.has_more),
  };
}

/**
 * GET with ETag support. When context is provided and server returns 304,
 * returns cached data so the client does not re-apply the same payload.
 */
async function fetchAPIWithETag<T>(
  endpoint: string,
  options?: RequestInit,
  context?: FetchEtagContext<T>
): Promise<T> {
  const headers = new Headers({
    'Content-Type': 'application/json',
  });
  if (options?.headers) {
    const extra = new Headers(options.headers as HeadersInit);
    extra.forEach((value, key) => headers.set(key, value));
  }
  if (isDemoMode()) {
    headers.set('X-Demo-Mode', '1');
    const mock = getDemoData(options?.method ?? 'GET', endpoint);
    if (mock !== null) return mock as T;
  }
  if (context) {
    const key = JSON.stringify(context.queryKey);
    const etag = etagStore.get(key);
    if (etag) headers.set('If-None-Match', `"${etag}"`);
  }
  if (_workspaceContext) {
    headers.set('X-Workspace-Context', _workspaceContext);
  }
  const endpointWithDemo = withDemoParam(endpoint);
  const response = await fetch(`${API_BASE_URL}${endpointWithDemo}`, {
    ...options,
    method: options?.method ?? 'GET',
    headers,
    credentials: 'include',
  });
  if (response.status === 304 && context) {
    const cached = context.getCachedData();
    if (cached !== undefined) {
      return cached as T;
    }
    // Cache can be evicted while ETag remains in-memory; retry once without
    // If-None-Match so pages don't incorrectly render as empty arrays.
    const retryHeaders = new Headers(headers);
    retryHeaders.delete('If-None-Match');
    const retryResponse = await fetch(`${API_BASE_URL}${endpointWithDemo}`, {
      ...options,
      method: options?.method ?? 'GET',
      headers: retryHeaders,
      credentials: 'include',
    });
    if (!retryResponse.ok) {
      const error = await retryResponse.json().catch(() => ({ detail: retryResponse.statusText }));
      const message =
        typeof error.detail === 'string'
          ? error.detail
          : Array.isArray(error.detail) && error.detail.length > 0
            ? error.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join('; ')
            : error.detail?.msg ?? retryResponse.statusText;
      throw new Error(message || `HTTP error! status: ${retryResponse.status}`);
    }
    const retriedData = (await retryResponse.json()) as T;
    const retryEtag = retryResponse.headers.get('ETag');
    if (retryEtag) {
      etagStore.set(JSON.stringify(context.queryKey), retryEtag.replace(/^"|"$/g, ''));
    }
    return retriedData;
  }
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('auth_user');
      sessionStorage.removeItem('auth_user');
      if (!isDemoMode()) window.location.href = '/login';
      throw new Error('Authentication required');
    }
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    const message =
      typeof error.detail === 'string'
        ? error.detail
        : Array.isArray(error.detail) && error.detail.length > 0
          ? error.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join('; ')
          : error.detail?.msg ?? response.statusText;
    throw new Error(message || `HTTP error! status: ${response.status}`);
  }
  const data = (await response.json()) as T;
  if (context) {
    const etag = response.headers.get('ETag');
    if (etag) etagStore.set(JSON.stringify(context.queryKey), etag.replace(/^"|"$/g, ''));
  }
  return data;
}

/** Region (country) from request - no auth. Used for Pricing/Settings India vs rest. Sends browser timezone for fallback detection. */
async function fetchRegion(options?: { timezone?: string }): Promise<{ country_code: string | null; is_india: boolean | null }> {
  const tz = options?.timezone ?? (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  const url = tz ? `${API_BASE_URL}/region?timezone=${encodeURIComponent(tz)}` : `${API_BASE_URL}/region`;
  const headers: HeadersInit = {};
  if (tz) headers['X-Timezone'] = tz;
  const response = await fetch(url, { headers, credentials: 'include' });
  if (!response.ok) return { country_code: null, is_india: null };
  return response.json();
}

export const api = {
  region: {
    get: fetchRegion,
  },
  domains: {
    list: (): Promise<Domain[]> =>
      fetchAPI<Domain[]>(`/domains`),

    create: (data: CreateDomainRequest): Promise<Domain> =>
      fetchAPI<Domain>('/domains', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    get: (domainId: string): Promise<Domain> =>
      fetchAPI<Domain>(`/domains/${domainId}`),

    verify: (domainId: string): Promise<{ verification_results: VerificationResults; health_score: number }> =>
      fetchAPI(`/domains/${domainId}/verify`, {
        method: 'POST',
      }),

    syncToProvider: (domainId: string): Promise<{ message: string; provider: string; verified: boolean; records_count: number }> =>
      fetchAPI(`/domains/${domainId}/sync-to-provider`, {
        method: 'POST',
      }),

    getDNSRecords: (domainId: string): Promise<DNSRecords> =>
      fetchAPI<DNSRecords>(`/domains/${domainId}/dns-records`),

    setTrackingDomain: (domainId: string, trackingDomain: string): Promise<Domain> =>
      fetchAPI<Domain>(`/domains/${domainId}/tracking-domain`, {
        method: 'PUT',
        body: JSON.stringify({ tracking_domain: trackingDomain }),
      }),

    verifyTrackingDomain: (
      domainId: string
    ): Promise<{ verification: { valid: boolean; message?: string }; domain: Domain | null }> =>
      fetchAPI(`/domains/${domainId}/verify-tracking-domain`, {
        method: 'POST',
      }),

    createEmailInfra: (domainId: string): Promise<Domain> =>
      fetchAPI<Domain>(`/domains/${domainId}/email-infra`, {
        method: 'POST',
      }),

    deleteEmailInfra: (domainId: string): Promise<Domain> =>
      fetchAPI<Domain>(`/domains/${domainId}/email-infra`, {
        method: 'DELETE',
      }),

    setSendingProvider: (
      domainId: string,
      provider: 'sendgrid' | 'email_infra',
    ): Promise<Domain> =>
      fetchAPI<Domain>(`/domains/${domainId}/sending-provider`, {
        method: 'POST',
        body: JSON.stringify({ sending_provider: provider }),
      }),

    delete: (domainId: string): Promise<{ message: string }> =>
      fetchAPI(`/domains/${domainId}`, {
        method: 'DELETE',
      }),

    verifyReceivingMx: (domainId: string): Promise<{ valid: boolean; message: string }> =>
      fetchAPI(`/domains/${domainId}/verify-receiving-mx`, {
        method: 'POST',
      }),

    enableReceiving: (domainId: string): Promise<Domain> =>
      fetchAPI<Domain>(`/domains/${domainId}/enable-receiving`, {
        method: 'POST',
      }),

    disableReceiving: (domainId: string): Promise<Domain> =>
      fetchAPI<Domain>(`/domains/${domainId}/disable-receiving`, {
        method: 'POST',
      }),

    listDNSProviders: (): Promise<{ providers: DNSProviderConnection[] }> =>
      fetchAPI(`/dns-providers`),

    connectDNSProvider: (
      provider: DNSProviderConnection["provider"],
      credentials: Record<string, string>
    ): Promise<{ provider: string; connected: boolean }> =>
      fetchAPI(`/dns-providers/${provider}`, {
        method: "PUT",
        body: JSON.stringify(credentials),
      }),

    disconnectDNSProvider: (
      provider: DNSProviderConnection["provider"]
    ): Promise<{ provider: string; connected: boolean }> =>
      fetchAPI(`/dns-providers/${provider}`, {
        method: "DELETE",
      }),

    autoSetupDNS: (
      domainId: string,
      provider: DNSProviderConnection["provider"]
    ): Promise<{ message: string; provider: string; result: unknown }> =>
      fetchAPI(`/domains/${domainId}/auto-dns-setup`, {
        method: "POST",
        body: JSON.stringify({ provider }),
      }),

    startBulkBackground: (
      payload:
        | { mode: "subdomains"; domain_id: string; names: string[] }
        | { mode: "domains"; domains: string[] }
    ): Promise<{ job_id: string; status: string; total_count: number }> =>
      fetchAPI("/domains/bulk/background", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    getBulkBackgroundJob: (
      jobId: string
    ): Promise<{
      id: string;
      status: "queued" | "running" | "completed" | "completed_with_errors" | "failed";
      total_count: number;
      processed_count: number;
      created_count: number;
      failed_count: number;
      skipped_count: number;
      results: Array<{ domain: string; status: string; attempts: number; error?: string }>;
    }> =>
      fetchAPI(`/domains/bulk/background/${encodeURIComponent(jobId)}`),
  },

  subdomains: {
    create: (domainId: string, subdomain: string): Promise<Subdomain> =>
      fetchAPI<Subdomain>(`/domains/${domainId}/subdomains`, {
        method: 'POST',
        body: JSON.stringify({ subdomain }),
      }),

    list: (domainId: string): Promise<Subdomain[]> =>
      fetchAPI<Subdomain[]>(`/domains/${domainId}/subdomains`),

    delete: (subdomainId: string): Promise<{ message: string }> =>
      fetchAPI(`/subdomains/${subdomainId}`, {
        method: 'DELETE',
      }),
  },

  inboxes: {
    list: (
      userId: string,
      context?: FetchEtagContext<Inbox[]>
    ): Promise<Inbox[]> =>
      context
        ? fetchAPIWithETag<Inbox[]>(`/inboxes?user_id=${userId}`, undefined, context)
        : fetchAPI<Inbox[]>(`/inboxes?user_id=${userId}`),

    create: (data: CreateInboxRequest): Promise<Inbox> =>
      fetchAPI<Inbox>('/inboxes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    addGmailAppPassword: (data: { email: string; password: string }): Promise<Inbox> =>
      fetchAPI<Inbox>('/inboxes/gmail-app-password', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    get: (inboxId: string): Promise<Inbox> =>
      fetchAPI<Inbox>(`/inboxes/${inboxId}`),

    update: (inboxId: string, data: Partial<CreateInboxRequest>): Promise<Inbox> =>
      fetchAPI<Inbox>(`/inboxes/${inboxId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    patchStatus: (inboxId: string, data: { status?: 'warming' | 'ready' | 'paused'; auto_warmup?: boolean }): Promise<Inbox> =>
      fetchAPI<Inbox>(`/inboxes/${inboxId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    pause: (inboxId: string): Promise<Inbox> =>
      fetchAPI<Inbox>(`/inboxes/${inboxId}/pause`, { method: 'POST' }),

    resume: (inboxId: string, body?: { warmup_engagement_mode?: 'pool' | 'network' | 'network_plus_shared' | 'hybrid' | 'shared_pool' }): Promise<Inbox> =>
      fetchAPI<Inbox>(`/inboxes/${inboxId}/resume`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),

    test: (inboxId: string): Promise<{ connected: boolean }> =>
      fetchAPI(`/inboxes/${inboxId}/test`, {
        method: 'POST',
      }),

    forceReady: (inboxId: string): Promise<{ message: string }> =>
      fetchAPI(`/inboxes/${inboxId}/force-ready`, {
        method: 'POST',
      }),

    setMailboxPassword: (
      inboxId: string,
      password: string
    ): Promise<{ message: string }> =>
      fetchAPI(`/inboxes/${inboxId}/mailbox-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),

    delete: (inboxId: string): Promise<{ message: string }> =>
      fetchAPI(`/inboxes/${inboxId}`, {
        method: 'DELETE',
      }),

    spamScore: (
      userId: string
    ): Promise<{
      scores: {
        inbox_id: string;
        email: string;
        stop_forum_spam_ok: boolean;
        message: string;
        frequency?: number | null;
      }[];
    }> =>
      fetchAPI(
        `/inboxes/spam-score?user_id=${encodeURIComponent(userId)}`
      ),
  },

  gmail: {
    getAuthUrl: (userId: string, credentialId?: string): Promise<{ auth_url: string }> =>
      fetchAPI(
        credentialId
          ? `/gmail/auth?user_id=${userId}&credential_id=${encodeURIComponent(credentialId)}`
          : `/gmail/auth?user_id=${userId}`
      ),

    getStatus: (userId: string): Promise<GmailStatus> =>
      fetchAPI<GmailStatus>(`/gmail/status?user_id=${userId}`),

    disconnect: (userId: string, credentialId: string): Promise<{ message: string }> =>
      fetchAPI(`/gmail/disconnect?user_id=${userId}&credential_id=${encodeURIComponent(credentialId)}`, {
        method: 'DELETE',
      }),

    disconnectByInboxId: (userId: string, inboxId: string): Promise<{ message: string }> =>
      fetchAPI(`/gmail/disconnect?user_id=${userId}&inbox_id=${encodeURIComponent(inboxId)}`, {
        method: 'DELETE',
      }),
  },

  campaigns: {
    list: (
      userId: string,
      params?: { archived?: boolean; skip?: number; limit?: number }
    ): Promise<Campaign[]> => {
      const searchParams = new URLSearchParams({ user_id: userId });
      if (params?.archived !== undefined) {
        searchParams.set("archived", String(params.archived));
      }
      if (params?.skip !== undefined) {
        searchParams.set("skip", String(params.skip));
      }
      if (params?.limit !== undefined) {
        searchParams.set("limit", String(params.limit));
      }
      return fetchAPI<Campaign[]>(`/campaigns?${searchParams.toString()}`);
    },

    create: (data: Campaign): Promise<Campaign> =>
      fetchAPI<Campaign>('/campaigns', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    get: (campaignId: string): Promise<Campaign> =>
      fetchAPI<Campaign>(`/campaigns/${campaignId}`),

    update: (campaignId: string, data: Partial<Campaign>): Promise<Campaign> =>
      fetchAPI<Campaign>(`/campaigns/${campaignId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    start: (campaignId: string, options?: { scheduled_at?: string }): Promise<{ message: string }> =>
      fetchAPI(`/campaigns/${campaignId}/start`, {
        method: 'POST',
        body: options?.scheduled_at != null ? JSON.stringify({ scheduled_at: options.scheduled_at }) : undefined,
      }),

    pause: (campaignId: string): Promise<{ message: string }> =>
      fetchAPI(`/campaigns/${campaignId}/pause`, {
        method: 'POST',
      }),

    delete: (campaignId: string): Promise<{ message: string }> =>
      fetchAPI(`/campaigns/${campaignId}`, {
        method: 'DELETE',
      }),

    setArchived: (campaignId: string, archived: boolean): Promise<Campaign> =>
      fetchAPI<Campaign>(`/campaigns/${campaignId}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived }),
      }),

    sendBatch: (campaignId: string): Promise<{ message: string; sent: number; errors: any[] }> =>
      fetchAPI(`/campaigns/${campaignId}/send-batch`, {
        method: 'POST',
      }),

    getStats: (campaignId: string): Promise<CampaignStats> =>
      fetchAPI<CampaignStats>(`/campaigns/${campaignId}/stats`),

    getStatsByTemplate: (campaignId: string): Promise<CampaignStatsByTemplate> =>
      fetchAPI<CampaignStatsByTemplate>(`/campaigns/${campaignId}/stats-by-template`),

    getJobs: (campaignId: string): Promise<{ jobs: CampaignJob[] }> =>
      fetchAPI<{ jobs: CampaignJob[] }>(`/campaigns/${campaignId}/jobs`),

    stopJob: (campaignId: string, jobId: string): Promise<CampaignJob> =>
      fetchAPI<CampaignJob>(`/campaigns/${campaignId}/jobs/${jobId}/stop`, {
        method: 'POST',
      }),

    getContacts: (campaignId: string): Promise<CampaignContact[]> =>
      fetchAPI<CampaignContact[]>(`/campaigns/${campaignId}/contacts`),

    getLeads: (
      campaignId: string,
      params?: { skip?: number; limit?: number; search?: string }
    ): Promise<{ leads: CampaignEnrichmentLead[]; total: number; skip: number; limit: number }> => {
      const qs = new URLSearchParams();
      if (params?.skip != null) qs.set("skip", String(params.skip));
      if (params?.limit != null) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      const query = qs.toString();
      return fetchAPI<{ leads: CampaignEnrichmentLead[]; total: number; skip: number; limit: number }>(
        `/campaigns/${campaignId}/leads${query ? `?${query}` : ""}`
      );
    },
    updateLeadTracker: (
      campaignId: string,
      leadId: string,
      data: { tracker_status?: "new" | "contacted" | "in_progress" | "follow_up" | "qualified" | "disqualified"; tracker_note?: string }
    ): Promise<CampaignEnrichmentLead> =>
      fetchAPI<CampaignEnrichmentLead>(`/campaigns/${campaignId}/leads/${leadId}/tracker`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    complianceStatus: (campaignIds: string[]): Promise<Record<string, { ok: boolean; errors: string[] }>> =>
      campaignIds.length === 0
        ? Promise.resolve({})
        : fetchAPI<Record<string, { ok: boolean; errors: string[] }>>(
            `/campaigns/compliance-status?ids=${encodeURIComponent(campaignIds.join(","))}`
          ),

    /** Queues a background placement test; poll listDeliverabilityRuns for status. */
    startDeliverabilityTest: (campaignId: string): Promise<StartDeliverabilityTestResponse> =>
      fetchAPI<StartDeliverabilityTestResponse>(`/campaigns/${campaignId}/deliverability-test`, {
        method: 'POST',
      }),

    listDeliverabilityRuns: (campaignId: string): Promise<{ runs: CampaignDeliverabilityRun[] }> =>
      fetchAPI<{ runs: CampaignDeliverabilityRun[] }>(`/campaigns/${campaignId}/deliverability-runs`),
  },

  contacts: {
    list: (userId: string, skip?: number, limit?: number): Promise<{ contacts: Contact[]; total: number }> =>
      fetchAPI<{ contacts: Contact[]; total: number }>(`/contacts?user_id=${userId}&skip=${skip || 0}&limit=${limit || 100}`),

    create: (userId: string, data: Partial<Contact>): Promise<Contact> =>
      fetchAPI<Contact>(`/contacts?user_id=${userId}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (contactId: string, userId: string, data: Partial<Contact>): Promise<{ message: string }> =>
      fetchAPI(`/contacts/${contactId}?user_id=${userId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (contactId: string, userId: string): Promise<{ message: string }> =>
      fetchAPI(`/contacts/${contactId}?user_id=${userId}`, {
        method: 'DELETE',
      }),

    getHistory: (contactId: string): Promise<ContactHistory> =>
      fetchAPI<ContactHistory>(`/contacts/${contactId}/history`),

    deleteMultiple: (userId: string, contactIds: string[]): Promise<{ message: string }> =>
      fetchAPI(`/contacts?user_id=${userId}`, {
        method: 'DELETE',
        body: JSON.stringify({ contact_ids: contactIds }),
      }),

    unblock: (userId: string, contactIds?: string[]): Promise<{ message: string; unblocked: number }> =>
      fetchAPI(`/contacts/unblock?user_id=${userId}`, {
        method: 'POST',
        body: JSON.stringify({ contact_ids: contactIds ?? null }),
      }),

    block: (userId: string, contactIds: string[]): Promise<{ message: string; blocked: number }> =>
      fetchAPI(`/contacts/block?user_id=${userId}`, {
        method: 'POST',
        body: JSON.stringify({ contact_ids: contactIds }),
      }),

    upload: async (userId: string, file: File): Promise<{ message: string; total_rows: number; available_fields: string[]; preview: any[]; contacts_data?: any[] }> => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE_URL}/contacts/upload?user_id=${userId}`, {
        method: 'POST',
        headers: {},
        body: formData,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const payload =
          typeof data.detail === 'object' && data.detail?.code
            ? data.detail
            : {
                code: 'UPLOAD_FAILED',
                message: data.detail ?? data.message ?? res.statusText ?? 'Upload failed',
                fix: 'Check the file format and size, then try again. Use the example CSV if unsure.',
                detail: typeof data.detail === 'string' ? data.detail : undefined,
              };
        throw new ContactUploadError(payload);
      }
      return data;
    },

    save: (userId: string, contactsData: any[], fieldMapping: Record<string, string>, listName?: string, listId?: string): Promise<{ message: string; list_id?: string; list_name?: string }> =>
      fetchAPI('/contacts/save', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, contacts_data: contactsData, field_mapping: fieldMapping, list_name: listName, list_id: listId }),
      }),

    removeRiskyEmails: (
      userId: string,
      listId?: string,
      includeCatchAll?: boolean
    ): Promise<{
      job_id: string | null;
      message: string;
      status: string;
      total_to_check?: number;
      total_checked?: number;
      deleted?: number;
      stats?: {
        invalid_syntax: number;
        mx_fail: number;
        stop_forum_spam_block: number;
        catch_all?: number;
      };
      list_id?: string | null;
      list_name?: string | null;
      include_catch_all?: boolean;
    }> =>
      fetchAPI(
        '/contacts/remove-risky-emails?user_id=' +
          encodeURIComponent(userId) +
          (listId ? '&list_id=' + encodeURIComponent(listId) : '') +
          (includeCatchAll ? '&include_catch_all=true' : ''),
        {
        method: 'POST',
        }
      ),

    getRemoveRiskyEmailsStatus: (jobId?: string | null): Promise<{
      job_id: string;
      status: string;
      total_to_check: number;
      checked_so_far: number;
      risky_count: number;
      deleted: number;
      stats: {
        invalid_syntax: number;
        mx_fail: number;
        stop_forum_spam_block: number;
        catch_all?: number;
      };
      include_catch_all?: boolean;
      error?: string;
      updated_at?: string;
    } | { status: 'not_found'; job_id?: string | null }> =>
      fetchAPI(
        jobId
          ? `/contacts/remove-risky-emails/status?job_id=${encodeURIComponent(jobId)}`
          : '/contacts/remove-risky-emails/status'
      ),

    stopRemoveRiskyEmails: (jobId: string): Promise<{ message: string; job_id: string; status: string }> =>
      fetchAPI(`/contacts/remove-risky-emails/stop?job_id=${encodeURIComponent(jobId)}`, {
        method: 'POST',
      }),

    getRemoveRiskyEmailsHistory: (
      skip: number = 0,
      limit: number = 50
    ): Promise<{
      jobs: Array<{
        job_id: string;
        status: string;
        list_id?: string | null;
        list_name?: string | null;
        total_to_check: number;
        checked_so_far: number;
        risky_count: number;
        deleted: number;
        stats: {
          invalid_syntax?: number;
          mx_fail?: number;
          stop_forum_spam_block?: number;
          catch_all?: number;
        };
        include_catch_all?: boolean;
        error?: string;
        created_at?: string;
        updated_at?: string;
      }>;
      total: number;
    }> =>
      fetchAPI(
        `/contacts/remove-risky-emails/jobs/history?skip=${encodeURIComponent(String(skip))}&limit=${encodeURIComponent(String(limit))}`
      ),
  },

  contactLists: {
    list: (userId: string): Promise<ContactList[]> =>
      fetchAPI<ContactList[]>(`/contact-lists?user_id=${userId}`),

    create: (userId: string, name: string, contactIds?: string[], description?: string): Promise<ContactList> =>
      fetchAPI<ContactList>('/contact-lists', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, name, contact_ids: contactIds || [], description }),
      }),

    update: (listId: string, data: Partial<ContactList>): Promise<{ message: string }> =>
      fetchAPI(`/contact-lists/${listId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (listId: string): Promise<{ message: string }> =>
      fetchAPI(`/contact-lists/${listId}`, {
        method: 'DELETE',
      }),

    getAudiencePreview: (listId: string, userId: string): Promise<AudiencePreview> =>
      fetchAPI<AudiencePreview>(`/contact-lists/${listId}/audience-preview?user_id=${userId}`),

    getContacts: (listId: string, skip?: number, limit?: number): Promise<{ contacts: Contact[]; total: number; list_name: string }> =>
      fetchAPI(`/contact-lists/${listId}/contacts?skip=${skip || 0}&limit=${limit || 100}`),

    addContacts: (listId: string, contactIds: string[]): Promise<{ message: string }> =>
      fetchAPI(`/contact-lists/${listId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ contact_ids: contactIds }),
      }),
  },

  templates: {
    list: (userId: string): Promise<EmailTemplate[]> =>
      fetchAPI<EmailTemplate[]>(`/templates?user_id=${userId}`),

    create: (data: EmailTemplate): Promise<EmailTemplate> =>
      fetchAPI<EmailTemplate>('/templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    update: (templateId: string, data: EmailTemplate): Promise<EmailTemplate> =>
      fetchAPI<EmailTemplate>(`/templates/${templateId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (templateId: string): Promise<{ message: string }> =>
      fetchAPI(`/templates/${templateId}`, {
        method: 'DELETE',
      }),

    deleteMultiple: (templateIds: string[]): Promise<{ message: string }> =>
      Promise.all(templateIds.map((id) => fetchAPI(`/templates/${id}`, { method: 'DELETE' }))).then(
        () => ({ message: 'Templates deleted' })
      ),
  },

  analytics: {
    get: (userId: string, campaignId?: string, days?: number): Promise<AnalyticsData> =>
      fetchAPI<AnalyticsData>(`/analytics?user_id=${userId}${campaignId ? `&campaign_id=${campaignId}` : ''}${days ? `&days=${days}` : ''}`),

    getTimeline: (userId: string, days?: number, campaignId?: string): Promise<any[]> =>
      fetchAPI(`/analytics/timeline?user_id=${userId}&days=${days || 7}${campaignId ? `&campaign_id=${campaignId}` : ''}`),

    getSendingHourly: (userId: string, days?: number): Promise<{ hour: number; count: number }[]> =>
      fetchAPI(`/analytics/sending-hourly?user_id=${userId}&days=${days || 7}`),

    getSendingByInbox: (userId: string, days?: number): Promise<{ sender_id: string; email: string; count: number }[]> =>
      fetchAPI(`/analytics/sending-by-inbox?user_id=${userId}&days=${days || 7}`),

    getSendingByCampaign: (userId: string, days?: number): Promise<{ campaign_id: string; name: string; count: number }[]> =>
      fetchAPI(`/analytics/sending-by-campaign?user_id=${userId}&days=${days || 7}`),

    getSendingInsights: (userId: string, days?: number): Promise<{
      total_sent: number;
      peak_hour_utc: number | null;
      top_inbox_email: string | null;
      top_campaign_name: string | null;
    }> =>
      fetchAPI(`/analytics/sending-insights?user_id=${userId}&days=${days || 7}`),

    getBestSendTime: (
      userId: string,
      timezone: string,
      days?: number,
      campaignId?: string
    ): Promise<{
      best_hour: number | null;
      best_hour_label: string | null;
      open_rate: number | null;
      based_on_sent: number;
      message: string;
      top_hours: { hour: number; label: string; open_rate: number; sent: number }[];
    }> =>
      fetchAPI(
        `/analytics/best-send-time?user_id=${userId}&timezone=${encodeURIComponent(timezone)}&days=${days ?? 30}${campaignId ? `&campaign_id=${campaignId}` : ''}`
      ),
  },

  llm: {
    getConfigs: (userId: string): Promise<LLMConfig[]> =>
      fetchAPI<LLMConfig[]>(`/llm/configs?user_id=${userId}`),

    checkConfig: (userId: string): Promise<{ configured: boolean; providers: string[] }> =>
      fetchAPI(`/llm/check-config?user_id=${userId}`),

    saveConfig: (config: LLMConfig): Promise<{ message: string }> =>
      fetchAPI('/llm/config', {
        method: 'POST',
        body: JSON.stringify(config),
      }),

    deleteConfig: (userId: string, provider: string): Promise<{ message: string }> =>
      fetchAPI(`/llm/config/${provider}?user_id=${userId}`, {
        method: 'DELETE',
      }),

    generateTemplate: (userId: string, provider: string, prompt: string): Promise<{ content: string }> =>
      fetchAPI('/llm/generate-template', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, provider, prompt }),
      }),
  },

  smartLeads: {
    discover: (body: SmartLeadsDiscoverRequest): Promise<SmartLeadsDiscoverResponse> =>
      fetchAPI<SmartLeadsDiscoverResponse>('/smart-leads/discover', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    createRun: (body: SmartLeadsRunCreateRequest): Promise<{ run_id: string; status: string }> =>
      fetchAPI('/smart-leads/runs', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    continueRun: (runId: string): Promise<{ run_id: string; status: string }> =>
      fetchAPI(`/smart-leads/runs/${encodeURIComponent(runId)}/continue`, {
        method: 'POST',
      }),

    stopRun: (runId: string): Promise<{ run_id: string; status: string }> =>
      fetchAPI(`/smart-leads/runs/${encodeURIComponent(runId)}/stop`, {
        method: 'POST',
      }),

    getRunStatus: (runId: string): Promise<SmartLeadsRunStatusResponse> =>
      fetchAPI<SmartLeadsRunStatusResponse>(`/smart-leads/runs/${encodeURIComponent(runId)}/status`),

    listRuns: (
      skip = 0,
      limit = 30
    ): Promise<{ runs: SmartLeadsRunSummary[]; total: number; skip: number; limit: number }> =>
      fetchAPI(`/smart-leads/runs?skip=${skip}&limit=${limit}`),

    getRunDetail: (runId: string): Promise<SmartLeadsRunDetailResponse> =>
      fetchAPI<SmartLeadsRunDetailResponse>(`/smart-leads/runs/${encodeURIComponent(runId)}`),
  },

  outreach: {
    getIntent: (
      userId: string,
      provider: string,
      message: string,
      context: {
        templates_in_session?: Array<{
          id: string;
          name?: string;
          subject?: string;
          sequence_step?: number;
          variant?: number;
        }>;
        existing_sequences_summary?: string;
        selected_list_id?: string | null;
        contact_lists?: Array<{ id: string; name: string; contact_count?: number }>;
        base_name?: string;
        recent_messages?: Array<{ role: string; content: string }>;
        last_action?: string;
        just_created_templates?: boolean;
        created_campaign_id?: string | null;
      }
    ): Promise<{
      action: string;
      params: Record<string, unknown>;
      reply?: string;
      steps?: Array<{ tool: string; args: Record<string, unknown> }>;
    }> =>
      fetchAPI('/outreach/intent', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, provider, message, context }),
      }),

    generatePostTemplateReply: (body: {
      user_id: string;
      provider: string;
      created_names: string[];
      count: number;
      compliance_note?: string;
    }): Promise<{ reply: string }> =>
      fetchAPI('/outreach/post-template-reply', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    parseStepsVariants: (
      userId: string,
      provider: string,
      message: string
    ): Promise<{ steps: number; variants: number }> =>
      fetchAPI('/outreach/parse-steps-variants', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, provider, message }),
      }),

    act: (
      chatId: string,
      body: {
        message: string;
        role?: 'user' | 'assistant';
        ai_provider: string;
        ui_hints?: Record<string, unknown>;
      }
    ): Promise<{
      messages: OutreachChatMessage[];
      ui_actions: Array<Record<string, unknown>>;
      state: Record<string, unknown>;
    }> =>
      fetchAPI(withDemoParam(`/outreach/chats/${chatId}/act`), {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    listChats: (): Promise<OutreachChat[]> =>
      fetchAPI<OutreachChat[]>(withDemoParam('/outreach/chats')),

    getChat: (chatId: string): Promise<OutreachChatWithMessages> =>
      fetchAPI<OutreachChatWithMessages>(withDemoParam(`/outreach/chats/${chatId}`)),

    createChat: (title?: string): Promise<OutreachChat> =>
      fetchAPI<OutreachChat>(withDemoParam('/outreach/chats'), {
        method: 'POST',
        body: JSON.stringify({ title: title ?? 'Outreach 1' }),
      }),

    updateChat: (
      chatId: string,
      data: { title?: string; meta?: Record<string, unknown> }
    ): Promise<OutreachChat> =>
      fetchAPI<OutreachChat>(withDemoParam(`/outreach/chats/${chatId}`), {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    addMessage: (
      chatId: string,
      data: { role: 'user' | 'assistant'; content: string; payload?: Record<string, unknown> }
    ): Promise<OutreachChatMessage> =>
      fetchAPI<OutreachChatMessage>(withDemoParam(`/outreach/chats/${chatId}/messages`), {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    deleteChat: (chatId: string): Promise<{ deleted: boolean }> =>
      fetchAPI(withDemoParam(`/outreach/chats/${chatId}`), { method: 'DELETE' }),
  },

  alerts: {
    list: (userId: string): Promise<Alert[]> =>
      fetchAPI<Alert[]>(`/alerts?user_id=${userId}`),

    markRead: (alertId: string, userId: string): Promise<{ message: string }> =>
      fetchAPI(`/alerts/${alertId}/read?user_id=${userId}`, {
        method: 'POST',
      }),

    delete: (alertId: string, userId: string): Promise<{ deleted: boolean }> =>
      fetchAPI(`/alerts/${alertId}?user_id=${userId}`, {
        method: 'DELETE',
      }),
  },

  tickets: {
    list: (status?: string): Promise<Ticket[]> =>
      fetchAPI<Ticket[]>(status ? `/tickets?status=${status}` : '/tickets'),

    create: (data: CreateTicketRequest): Promise<Ticket> =>
      fetchAPI<Ticket>('/tickets', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    get: (ticketId: string): Promise<Ticket> =>
      fetchAPI<Ticket>(`/tickets/${ticketId}`),

    update: (ticketId: string, data: UpdateTicketRequest): Promise<Ticket> =>
      fetchAPI<Ticket>(`/tickets/${ticketId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (ticketId: string): Promise<{ deleted: boolean }> =>
      fetchAPI(`/tickets/${ticketId}`, { method: 'DELETE' }),

    getComments: (ticketId: string): Promise<TicketComment[]> =>
      fetchAPI<TicketComment[]>(`/tickets/${ticketId}/comments`),

    addComment: (ticketId: string, data: CreateTicketCommentRequest): Promise<TicketComment> =>
      fetchAPI<TicketComment>(`/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  billing: {
    razorpay: {
      createSubscription: (planId: string, annual?: boolean): Promise<{ subscription_id: string; short_url?: string; key_id: string }> =>
        fetchAPI('/billing/razorpay/create-subscription', {
          method: 'POST',
          body: JSON.stringify({ plan_id: planId, annual: !!annual }),
        }),
      getSubscription: (): Promise<{
        subscription: { id: string; status: string; plan_id: string; current_start: string | null; current_end: string | null; charge_at?: number; billing_cycle?: "monthly" | "annual" } | null;
        short_url: string | null;
      }> =>
        fetchAPI('/billing/razorpay/subscription'),
      cancelSubscription: (cancelAtCycleEnd: boolean): Promise<{ message: string }> =>
        fetchAPI('/billing/razorpay/cancel-subscription', {
          method: 'POST',
          body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd }),
        }),
      updatePlan: (planId: string, scheduleChangeAt: 'now' | 'cycle_end'): Promise<{ message: string }> =>
        fetchAPI('/billing/razorpay/update-plan', {
          method: 'POST',
          body: JSON.stringify({ plan_id: planId, schedule_change_at: scheduleChangeAt }),
        }),
    },
    lemonSqueezy: {
      createCheckout: (planId: string, annual?: boolean): Promise<{ checkout_url: string }> =>
        fetchAPI('/billing/lemon-squeezy/create-checkout', {
          method: 'POST',
          body: JSON.stringify({ plan_id: planId, annual: !!annual }),
        }),
      getSubscription: (): Promise<{
        subscription: { id: string; status: string; plan_id: string; current_start: string | null; current_end: string | null; billing_cycle?: "monthly" | "annual" } | null;
        customer_portal_url: string | null;
      }> =>
        fetchAPI('/billing/lemon-squeezy/subscription'),
      updatePlanNow: (planId: string): Promise<{ message: string }> =>
        fetchAPI('/billing/lemon-squeezy/update-plan', {
          method: 'POST',
          body: JSON.stringify({ plan_id: planId }),
        }),
    },
    credits: {
      getTopupConfig: (): Promise<{
        credits: number;
        is_india: boolean;
        provider: 'razorpay' | 'lemon_squeezy';
        amount: { value: number; display: string; currency: 'INR' | 'USD'; subunits: number };
        provider_configured: boolean;
        current_balance: number;
      }> => fetchAPI('/billing/credits/topup-config'),
      createRazorpayOrder: (): Promise<{
        topup_id: string;
        order_id: string;
        amount: number;
        currency: 'INR';
        credits: number;
        key_id: string;
      }> =>
        fetchAPI('/billing/credits/razorpay/create-order', {
          method: 'POST',
        }),
      verifyRazorpayOrder: (data: {
        order_id: string;
        payment_id: string;
        signature: string;
      }): Promise<{ message: string; credits_added: number; balance: number }> =>
        fetchAPI('/billing/credits/razorpay/verify', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      createLemonCheckout: (): Promise<{ checkout_url: string; credits: number }> =>
        fetchAPI('/billing/credits/lemon-squeezy/create-checkout', {
          method: 'POST',
        }),
    },
  },

  inbox: {
    getEmails: (
      userId: string,
      filter?: string,
      context?: FetchEtagContext<InboxEmail[]>
    ): Promise<InboxEmail[]> =>
      context
        ? fetchAPIWithETag<InboxEmail[]>(
            `/inbox/emails?user_id=${userId}${filter ? `&filter=${filter}` : ''}`,
            undefined,
            context
          )
        : fetchAPI<InboxEmail[]>(`/inbox/emails?user_id=${userId}${filter ? `&filter=${filter}` : ''}`),
    
    markAsRead: (emailId: string, userId: string): Promise<{ message: string }> =>
      fetchAPI(`/inbox/emails/${emailId}/read?user_id=${userId}`, {
        method: 'PUT',
      }),
    
    archive: (emailId: string, userId: string): Promise<{ message: string }> =>
      fetchAPI(`/inbox/emails/${emailId}/archive?user_id=${userId}`, {
        method: 'PUT',
      }),

    toggleStar: (emailId: string, userId: string): Promise<{ message: string; starred: boolean }> =>
      fetchAPI(`/inbox/emails/${emailId}/star?user_id=${userId}`, {
        method: 'PUT',
      }),

    delete: (emailId: string, userId: string): Promise<{ message: string }> =>
      fetchAPI(`/inbox/emails/${emailId}?user_id=${userId}`, {
        method: 'DELETE',
      }),
    
    tag: (emailId: string, userId: string, tag: string): Promise<{ message: string }> =>
      fetchAPI(`/inbox/emails/${emailId}/tag?user_id=${userId}`, {
        method: 'POST',
        body: JSON.stringify({ tag }),
      }),
    
    markAllAsRead: (userId: string): Promise<{ message: string; modified_count?: number }> =>
      fetchAPI(`/inbox/emails/mark-all-read?user_id=${userId}`, {
        method: 'PUT',
      }),
    
    archiveAll: (userId: string): Promise<{ message: string }> =>
      fetchAPI(`/inbox/emails/archive-all?user_id=${userId}`, {
        method: 'PUT',
      }),

    getReceivedEmails: (
      userId: string,
      params?: { inbox_id?: string; domain_id?: string; limit?: number; offset?: number; unread_only?: boolean },
      context?: FetchEtagContext<ReceivedEmailsPage>
    ): Promise<ReceivedEmailsPage> => {
      const searchParams = new URLSearchParams({ user_id: userId });
      if (params?.inbox_id) searchParams.set('inbox_id', params.inbox_id);
      if (params?.domain_id) searchParams.set('domain_id', params.domain_id);
      if (params?.limit != null) searchParams.set('limit', String(params.limit));
      if (params?.offset != null) searchParams.set('offset', String(params.offset));
      if (params?.unread_only) searchParams.set('unread_only', 'true');
      const url = `/inbox/received?${searchParams.toString()}`;
      const request = context
        ? fetchAPIWithETag<ReceivedEmailsPage | InboundMessage[]>(url, undefined, context as FetchEtagContext<ReceivedEmailsPage | InboundMessage[]>)
        : fetchAPI<ReceivedEmailsPage | InboundMessage[]>(url);
      return request.then(normalizeReceivedEmailsPage);
    },

    getReceivedEmail: (messageId: string, userId: string): Promise<InboundMessage> =>
      fetchAPI<InboundMessage>(`/inbox/received/${messageId}?user_id=${userId}`),

    getReceivedThread: (threadId: string, userId: string): Promise<ReceivedThread> =>
      fetchAPI<ReceivedThread>(`/inbox/received/thread/${threadId}?user_id=${userId}`),

    markReceivedThreadAsRead: (threadId: string, userId: string): Promise<{ message: string; modified_count?: number }> =>
      fetchAPI(`/inbox/received/thread/${threadId}/read?user_id=${userId}`, { method: 'PUT' }),

    deleteReceivedThread: (threadId: string, userId: string): Promise<{ message: string; deleted_inbound?: number; deleted_replies?: number }> =>
      fetchAPI(`/inbox/received/thread/${threadId}?user_id=${userId}`, { method: 'DELETE' }),

    sendReceivedReply: (
      messageId: string,
      userId: string,
      subject: string,
      body: string,
      cc?: string
    ): Promise<{ message_id?: string; status: string }> =>
      fetchAPI(`/inbox/received/${messageId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, subject, body, ...(cc ? { cc } : {}) }),
      }),

    sendCompose: (
      userId: string,
      toEmail: string,
      subject: string,
      body: string,
      inboxId?: string,
      cc?: string
    ): Promise<{ message_id?: string; status: string }> =>
      fetchAPI('/inbox/compose', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          to_email: toEmail,
          subject,
          body,
          ...(inboxId ? { inbox_id: inboxId } : {}),
          ...(cc?.trim() ? { cc: cc.trim() } : {}),
        }),
      }),
  },

  /** Mailbox-scoped API (uses mailbox_auth_token cookie). Use after mailbox login. */
  mailbox: {
    getMe: (): Promise<{ inbox: Inbox; user_id: string }> =>
      fetchAPI<{ inbox: Inbox; user_id: string }>('/mailbox/me'),
    getReceived: (
      params?: { domain_id?: string; limit?: number; offset?: number }
    ): Promise<ReceivedEmailsPage> => {
      const searchParams = new URLSearchParams();
      if (params?.domain_id) searchParams.set('domain_id', params.domain_id);
      if (params?.limit != null) searchParams.set('limit', String(params.limit));
      if (params?.offset != null) searchParams.set('offset', String(params.offset));
      const url = `/mailbox/received?${searchParams.toString()}`;
      return fetchAPI<ReceivedEmailsPage | InboundMessage[]>(url).then(normalizeReceivedEmailsPage);
    },
    getReceivedThread: (threadId: string): Promise<ReceivedThread> =>
      fetchAPI<ReceivedThread>(`/mailbox/received/thread/${threadId}`),
    markReceivedThreadAsRead: (threadId: string): Promise<{ message: string; modified_count?: number }> =>
      fetchAPI(`/mailbox/received/thread/${threadId}/read`, { method: 'PUT' }),
    deleteReceivedThread: (threadId: string): Promise<{ message: string; deleted_inbound?: number; deleted_replies?: number }> =>
      fetchAPI(`/mailbox/received/thread/${threadId}`, { method: 'DELETE' }),
    getReceivedEmail: (messageId: string): Promise<InboundMessage> =>
      fetchAPI<InboundMessage>(`/mailbox/received/${messageId}`),
    sendReceivedReply: (userId: string, messageId: string, subject: string, body: string, cc?: string): Promise<{ message_id?: string; status: string }> =>
      fetchAPI(`/mailbox/received/${messageId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, subject, body, ...(cc ? { cc } : {}) }),
      }),
    sendCompose: (userId: string, toEmail: string, subject: string, body: string, inboxId?: string, cc?: string): Promise<{ message_id?: string; status: string }> =>
      fetchAPI('/mailbox/compose', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          to_email: toEmail,
          subject,
          body,
          ...(inboxId ? { inbox_id: inboxId } : {}),
          ...(cc?.trim() ? { cc: cc.trim() } : {}),
        }),
      }),
  },

  warmup: {
    getTimeline: (): Promise<WarmupTimelineData[]> =>
      fetchAPI<WarmupTimelineData[]>('/warmup/timeline'),
    getStats: (): Promise<WarmupStats> =>
      fetchAPI<WarmupStats>('/warmup/stats'),
    getSendTemplates: (): Promise<{
      templates: { id: string; subject: string; body: string; body_type: 'html' | 'plain' | 'rich'; created_at: string }[];
    }> => fetchAPI('/warmup/send-templates'),
    createSendTemplate: (params: {
      subject: string;
      body: string;
      body_type?: 'html' | 'plain' | 'rich';
    }): Promise<{
      id: string;
      subject: string;
      body: string;
      body_type: 'html' | 'plain' | 'rich';
      created_at: string;
      updated_at: string;
    }> =>
      fetchAPI('/warmup/send-templates', {
        method: 'POST',
        body: JSON.stringify({
          subject: params.subject,
          body: params.body,
          body_type: params.body_type ?? 'plain',
        }),
      }),
    updateSendTemplate: (
      templateId: string,
      data: { subject?: string; body?: string; body_type?: 'html' | 'plain' | 'rich' }
    ): Promise<{
      id: string;
      subject: string;
      body: string;
      body_type: 'html' | 'plain' | 'rich';
      created_at: string;
      updated_at: string;
    }> =>
      fetchAPI(`/warmup/send-templates/${templateId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    deleteSendTemplate: (templateId: string): Promise<{ message: string }> =>
      fetchAPI(`/warmup/send-templates/${templateId}`, { method: 'DELETE' }),

    // Warmup Network contacts
    getNetworkContacts: (): Promise<{
      contacts: { id: string; user_id: string; email: string; label?: string; created_at: string; updated_at: string }[];
      settings: { contact_daily_limit: number };
    }> =>
      fetchAPI('/warmup/network'),
    updateNetworkSettings: (data: { contact_daily_limit: number }): Promise<{ settings: { contact_daily_limit: number } }> =>
      fetchAPI('/warmup/network/settings', { method: 'PATCH', body: JSON.stringify(data) }),
    sendNetworkContactVerify: (
      email: string
    ): Promise<{ message: string; provider?: string }> =>
      fetchAPI('/warmup/network/verify/send', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    createNetworkContact: (data: {
      email: string;
      otp: string;
      label?: string;
    }): Promise<{ id: string; user_id: string; email: string; label?: string; created_at: string; updated_at: string }> =>
      fetchAPI('/warmup/network', { method: 'POST', body: JSON.stringify(data) }),
    deleteNetworkContact: (contactId: string): Promise<{ message: string }> =>
      fetchAPI(`/warmup/network/${contactId}`, { method: 'DELETE' }),
    getSharedPoolState: (): Promise<WarmupSharedPoolState> =>
      fetchAPI('/warmup/shared-pool'),
    updateSharedPoolEnrollment: (enabled: boolean): Promise<WarmupSharedPoolState> =>
      fetchAPI('/warmup/shared-pool/enrollment', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }),

    // Recent sends for transparency
    getRecentSends: (limit?: number): Promise<{ sends: { id: string; inbox_email: string; receiver_email: string; engagement_mode: 'pool' | 'network' | 'shared_pool' | 'quick'; subject: string; sent_at: string }[] }> =>
      fetchAPI(`/warmup/recent-sends${limit ? `?limit=${limit}` : ''}`),

    // Sent logs — paginated warmup send history across all engagement modes
    getSentLogs: (params?: { limit?: number; offset?: number; engagement_mode?: string; since_hours?: number }): Promise<{ total: number; items: { id: string; inbox_email: string; receiver_email: string; engagement_mode: 'pool' | 'network' | 'shared_pool' | 'quick'; subject: string; sent_at: string; replied_at?: string | null }[] }> => {
      const q = new URLSearchParams();
      if (params?.limit != null) q.set('limit', String(params.limit));
      if (params?.offset != null) q.set('offset', String(params.offset));
      if (params?.engagement_mode) q.set('engagement_mode', params.engagement_mode);
      if (params?.since_hours != null) q.set('since_hours', String(params.since_hours));
      const qs = q.toString();
      return fetchAPI(`/warmup/sent-logs${qs ? `?${qs}` : ''}`);
    },

    // Quick Engagement — send one warmup email immediately to a specific recipient
    quickSend: (inbox_id: string, recipient_email: string): Promise<{ sent: boolean }> =>
      fetchAPI('/warmup/quick-send', {
        method: 'POST',
        body: JSON.stringify({ inbox_id, recipient_email }),
      }),
    domainMailTest: (domain_id: string): Promise<{
      sent: boolean;
      test_id: string;
      reverse_test_id?: string | null;
      domain_id: string;
      domain?: string;
      sender_inbox_id?: string;
      sender_email?: string;
      recipient_email?: string;
      recipient_source?: "connected_gmail" | "backend_receiver_pool";
      sender_check?: { ok: boolean; message: string };
      recipient_check?: { ok: boolean; message: string };
      receive_signal?: { ok: boolean; status: "pending" | "success"; message: string };
      reverse_flow?: { enabled: boolean; status?: "pending" | "success" | "failed"; message: string };
      message?: string;
    }> =>
      fetchAPI('/warmup/domain-mail-test', {
        method: 'POST',
        body: JSON.stringify({ domain_id }),
      }),
    domainMailTestStatus: (test_id: string): Promise<{
      test_id: string;
      sent: boolean;
      sender_email?: string;
      recipient_email?: string;
      receive_signal: {
        ok: boolean;
        status: "pending" | "success";
        opened_at?: string | null;
        replied_at?: string | null;
        message: string;
      };
    }> =>
      fetchAPI(`/warmup/domain-mail-test/${encodeURIComponent(test_id)}/status`),
  },

  emails: {
    checkReplies: (userId: string): Promise<{ message: string; replies_found: number }> =>
      fetchAPI(`/emails/check-replies?user_id=${userId}`, { method: 'POST' }),

    sendReply: (
      userId: string,
      emailLogId: string,
      subject: string,
      body: string,
      cc?: string
    ): Promise<{ message_id?: string; status: string }> =>
      fetchAPI('/emails/reply', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, email_log_id: emailLogId, subject, body, ...(cc ? { cc } : {}) }),
      }),

    sendTemplateTest: (
      userId: string,
      templateId: string,
      toEmail: string,
      senderId?: string,
      options?: { useAiVariation?: boolean; aiProvider?: string; aiPrompt?: string; contactId?: string }
    ): Promise<{ message: string; subject: string; to: string; message_id?: string }> =>
      fetchAPI('/emails/send-test', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          template_id: templateId,
          test_email: toEmail,
          ...(senderId != null && senderId !== '' ? { sender_id: senderId } : {}),
          ...(options?.contactId ? { contact_id: options.contactId } : {}),
          ...(options?.useAiVariation && options?.aiProvider && options?.aiPrompt
            ? { use_ai_variation: true, ai_provider: options.aiProvider, ai_prompt: options.aiPrompt }
            : {}),
        }),
      }),

    sendSmtpTemplateTest: (
      userId: string,
      templateId: string,
      inboxId: string,
      toEmail: string,
      options?: { useAiVariation?: boolean; aiProvider?: string; aiPrompt?: string; contactId?: string }
    ): Promise<{ message: string; subject: string; to: string; message_id?: string }> =>
      fetchAPI('/emails/send-smtp-test', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          template_id: templateId,
          inbox_id: inboxId,
          test_email: toEmail,
          ...(options?.contactId ? { contact_id: options.contactId } : {}),
          ...(options?.useAiVariation && options?.aiProvider && options?.aiPrompt
            ? { use_ai_variation: true, ai_provider: options.aiProvider, ai_prompt: options.aiPrompt }
            : {}),
        }),
      }),

    sendConnectionTest: (
      userId: string,
      toEmail: string,
      senderId?: string
    ): Promise<{ message: string; subject: string; to: string; message_id?: string }> =>
      fetchAPI('/emails/send-connection-test', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          to_email: toEmail,
          ...(senderId != null && senderId !== '' ? { sender_id: senderId } : {}),
        }),
      }),

    sendSmtpConnectionTest: (
      userId: string,
      inboxId: string,
      toEmail: string
    ): Promise<{ message: string; subject: string; to: string; message_id?: string }> =>
      fetchAPI('/emails/send-smtp-connection-test', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, inbox_id: inboxId, to_email: toEmail }),
      }),
  },

  activity: {
    getActivity: (userId: string, limit: number = 10): Promise<{ activities: any[] }> =>
      fetchAPI(`/analytics/activity?user_id=${userId}&limit=${limit}`),
  },

  auth: {
    getMe: (): Promise<any> =>
      fetchAPI('/auth/me'),

    updateProfile: (data: { first_name?: string; last_name?: string; company?: string }): Promise<any> =>
      fetchAPI('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),

    changePassword: (current_password: string, new_password: string): Promise<{ message: string }> =>
      fetchAPI('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password, new_password }),
      }),

    update2FA: (enabled: boolean): Promise<{ two_fa_enabled: boolean; user: any }> =>
      fetchAPI('/auth/2fa', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      }),

    getSessions: (): Promise<{ id: string; device: string; location: string; last_active: string; current?: boolean }[]> =>
      fetchAPI('/auth/sessions'),

    revokeOtherSessions: (): Promise<{ message: string }> =>
      fetchAPI('/auth/sessions/revoke-others', { method: 'POST' }),
  },

  settings: {
    get: (): Promise<{
      user_id: string;
      notifications: Record<string, boolean>;
      compliance: Record<string, any>;
      email_infra?: { enabled: boolean };
      default_reply_to_type?: string | null;
      default_reply_to_id?: string | null;
    }> =>
      fetchAPI('/settings'),

    update: (payload: {
      notifications?: Record<string, boolean>;
      compliance?: { spam_words?: string; max_links_per_email?: number; max_images_per_email?: number; require_unsubscribe_link?: boolean };
      email_infra?: { enabled?: boolean };
      default_reply_to_type?: string | null;
      default_reply_to_id?: string | null;
    }): Promise<any> =>
      fetchAPI('/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    getGoogleOAuthConfig: (): Promise<{ user_oauth_configured: boolean; google_client_id_configured: boolean; use_app_google_oauth: boolean }> =>
      fetchAPI('/settings/google-oauth'),

    updateGoogleOAuthConfig: (payload: { google_client_id?: string; google_client_secret?: string; use_app_google_oauth?: boolean }): Promise<{ user_oauth_configured: boolean; google_client_id_configured: boolean; use_app_google_oauth: boolean }> =>
      fetchAPI('/settings/google-oauth', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    getGmailOAuthStatus: (): Promise<{ user_oauth_configured: boolean; app_default_enabled: boolean }> =>
      fetchAPI('/settings/gmail-oauth-status'),

    getSerper: (): Promise<{ serper_configured: boolean }> => fetchAPI('/settings/serper'),

    updateSerper: (payload: { serper_api_key?: string | null }): Promise<{ serper_configured: boolean }> =>
      fetchAPI('/settings/serper', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    getZeroBounce: (): Promise<{ zerobounce_configured: boolean }> => fetchAPI('/settings/zerobounce'),

    updateZeroBounce: (payload: { zerobounce_api_key?: string | null }): Promise<{ zerobounce_configured: boolean }> =>
      fetchAPI('/settings/zerobounce', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    testZeroBounceValidate: (payload: {
      email: string;
      timeout?: number | null;
      activity_data?: boolean | null;
      verify_plus?: boolean | null;
    }): Promise<{
      request: {
        url: string;
        email: string;
        timeout?: number | null;
        activity_data?: boolean | null;
        verify_plus?: boolean | null;
        api_key_present: boolean;
      };
      ok: boolean;
      zerobounce_response: Record<string, unknown> | null;
      error: string | null;
      validation: Record<string, unknown>;
    }> =>
      fetchAPI('/settings/zerobounce/test-validate', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  replyToImap: {
    list: (): Promise<ReplyToImapConfig[]> =>
      fetchAPI<ReplyToImapConfig[]>('/reply-to-imap-configs'),

    create: (payload: { email: string; imap_host: string; imap_port?: number; imap_username: string; imap_password: string }): Promise<ReplyToImapConfig> =>
      fetchAPI<ReplyToImapConfig>('/reply-to-imap-configs', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    update: (configId: string, payload: { email?: string; imap_host?: string; imap_port?: number; imap_username?: string; imap_password?: string }): Promise<ReplyToImapConfig> =>
      fetchAPI<ReplyToImapConfig>(`/reply-to-imap-configs/${configId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    delete: (configId: string): Promise<{ message: string }> =>
      fetchAPI(`/reply-to-imap-configs/${configId}`, { method: 'DELETE' }),

    test: (configId: string): Promise<{ message: string }> =>
      fetchAPI(`/reply-to-imap-configs/${configId}/test`, { method: 'POST' }),
  },

  /** Public plans list (no auth required). Served from Next.js API (MongoDB). */
  plans: {
    list: (): Promise<{ plans: any[] }> =>
      fetch('/api/plans', { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error('Failed to fetch plans');
        return r.json() as Promise<{ plans: any[] }>;
      }),
    /** Single plan by id (for /pricing/[planId]). Includes plans not shown on main pricing (active: false). */
    get: (planId: string): Promise<{ plan: any }> =>
      fetch(`/api/plans/${encodeURIComponent(planId)}`, { credentials: 'include' }).then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Plan not found' : 'Failed to fetch plan');
        return r.json() as Promise<{ plan: any }>;
      }),
  },

  /** Public contact form (no auth). Served from Next.js API (MongoDB). */
  contact: {
    submit: (data: {
      name: string;
      email: string;
      subject: string;
      message: string;
      company?: string;
      phone?: string;
    }): Promise<{ message: string; id: string }> =>
      fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      }).then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error((err as { message?: string })?.message ?? 'Failed to submit');
        }
        return r.json() as Promise<{ message: string; id: string }>;
      }),
  },

  webhooks: {
    list: (): Promise<{ id: string; url: string; events: string[] }[]> =>
      fetchAPI('/webhooks'),

    create: (url: string, events: string[]): Promise<{ id: string; url: string; events: string[] }> =>
      fetchAPI('/webhooks', {
        method: 'POST',
        body: JSON.stringify({ url, events }),
      }),

    update: (webhookId: string, data: { url?: string; events?: string[] }): Promise<any> =>
      fetchAPI(`/webhooks/${webhookId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    delete: (webhookId: string): Promise<{ message: string }> =>
      fetchAPI(`/webhooks/${webhookId}`, { method: 'DELETE' }),
  },

  blogs: {
    list: (page?: number, limit?: number, tag?: string | null): Promise<{ blogs: Blog[]; total: number; page: number; limit: number }> => {
      const params = new URLSearchParams();
      if (page != null) params.set('page', String(page));
      if (limit != null) params.set('limit', String(limit));
      if (tag != null && tag !== '') params.set('tag', tag);
      const qs = params.toString();
      return fetchAPI<{ blogs: Blog[]; total: number; page: number; limit: number }>(
        `/blogs${qs ? `?${qs}` : ''}`,
      );
    },

    getBySlug: (slug: string): Promise<Blog> =>
      fetchAPI<Blog>(`/blogs/${encodeURIComponent(slug)}`),

    getRelated: (slug: string, limit?: number): Promise<{ blogs: Blog[] }> => {
      const params = new URLSearchParams();
      if (limit != null) params.set('limit', String(limit));
      const qs = params.toString();
      return fetchAPI<{ blogs: Blog[] }>(
        `/blogs/${encodeURIComponent(slug)}/related${qs ? `?${qs}` : ''}`,
      );
    },
  },

  workflows: {
    list: (userId: string): Promise<{ workflows: Workflow[] }> =>
      fetchAPI<{ workflows: Workflow[] }>(`/workflows?user_id=${encodeURIComponent(userId)}`),

    create: (data: Partial<Workflow>): Promise<Workflow> =>
      fetchAPI<Workflow>('/workflows', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    get: (workflowId: string): Promise<Workflow> =>
      fetchAPI<Workflow>(`/workflows/${encodeURIComponent(workflowId)}`),

    update: (workflowId: string, data: Partial<Workflow>): Promise<Workflow> =>
      fetchAPI<Workflow>(`/workflows/${encodeURIComponent(workflowId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    activate: (workflowId: string): Promise<Workflow> =>
      fetchAPI<Workflow>(`/workflows/${encodeURIComponent(workflowId)}/activate`, {
        method: 'POST',
      }),

    pause: (workflowId: string): Promise<Workflow> =>
      fetchAPI<Workflow>(`/workflows/${encodeURIComponent(workflowId)}/pause`, {
        method: 'POST',
      }),

    listRuns: (workflowId: string, limit: number = 20): Promise<{ runs: WorkflowRun[] }> =>
      fetchAPI<{ runs: WorkflowRun[] }>(
        `/workflows/${encodeURIComponent(workflowId)}/runs?limit=${limit}`,
      ),

    getRunWithSteps: (
      runId: string,
    ): Promise<{ run: WorkflowRun; steps: WorkflowRunStep[] }> =>
      fetchAPI<{ run: WorkflowRun; steps: WorkflowRunStep[] }>(
        `/workflows/runs/${encodeURIComponent(runId)}`,
      ),
    stopRun: (
      runId: string,
    ): Promise<{ run: WorkflowRun }> =>
      fetchAPI<{ run: WorkflowRun }>(
        `/workflows/runs/${encodeURIComponent(runId)}/stop`,
        {
          method: 'POST',
        },
      ),
    test: (
      workflowId: string,
      triggerContext?: Record<string, unknown>,
    ): Promise<{ run: WorkflowRun; steps?: WorkflowRunStep[] }> =>
      fetchAPI<{ run: WorkflowRun; steps?: WorkflowRunStep[] }>(
        `/workflows/${encodeURIComponent(workflowId)}/test`,
        {
          method: 'POST',
          body: JSON.stringify(
            triggerContext ? { trigger_context: triggerContext } : {},
          ),
        },
      ),
    delete: (workflowId: string): Promise<{ deleted: boolean }> =>
      fetchAPI<{ deleted: boolean }>(`/workflows/${encodeURIComponent(workflowId)}`, {
        method: 'DELETE',
      }),
  },

  workspace: {
    listSubUsers: (): Promise<{ sub_users: SubUserEntry[] }> =>
      fetchAPI<{ sub_users: SubUserEntry[] }>('/workspace/sub-users'),

    addSubUser: (data: {
      email: string;
      name?: string;
      permissions?: SubUserPermissionsPayload;
    }): Promise<{ sub_user: SubUserEntry; message: string }> =>
      fetchAPI<{ sub_user: SubUserEntry; message: string }>('/workspace/sub-users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),

    updateSubUser: (
      invitationId: string,
      data: { permissions: SubUserPermissionsPayload; name?: string },
    ): Promise<{ sub_user: SubUserEntry }> =>
      fetchAPI<{ sub_user: SubUserEntry }>(`/workspace/sub-users/${encodeURIComponent(invitationId)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),

    removeSubUser: (invitationId: string): Promise<{ deleted: boolean }> =>
      fetchAPI<{ deleted: boolean }>(`/workspace/sub-users/${encodeURIComponent(invitationId)}`, {
        method: 'DELETE',
      }),

    getMyAccess: (): Promise<{
      is_sub_user: boolean;
      permissions?: SubUserPermissionsPayload;
      workspace_owner_id?: string;
    }> => fetchAPI('/workspace/my-access'),

    getAvailableWorkspaces: (): Promise<{ workspaces: AvailableWorkspace[] }> =>
      fetchAPI<{ workspaces: AvailableWorkspace[] }>('/workspace/available'),
  },
};

export interface SubUserPermissionsPayload {
  dashboard: boolean;
  inbox: boolean;
  campaigns: boolean;
  contacts: boolean;
  templates: boolean;
  workflows: boolean;
  analytics: boolean;
  tracking: boolean;
  domains: boolean;
  inboxes: boolean;
  warmup: boolean;
  settings: boolean;
}

export interface SubUserEntry {
  id: string;
  owner_id: string;
  sub_user_email: string;
  sub_user_id?: string | null;
  name?: string | null;
  status: string;
  permissions: SubUserPermissionsPayload;
  invited_at: string;
  updated_at: string;
}

export interface AvailableWorkspace {
  owner_id: string;
  owner_name: string;
  owner_email: string;
  owner_company?: string | null;
  permissions: SubUserPermissionsPayload;
}
