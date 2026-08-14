/**
 * Build CSV / JSON exports for Smart Leads run detail (companies, people, emails, LinkedIn URLs).
 */

import type {
  SmartLeadsCompanyRow,
  SmartLeadsEmailRow,
  SmartLeadsPersonRow,
  SmartLeadsRunDetailResponse,
} from "@/types/api";

function norm(s?: string | null): string {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Match a guessed email row to a person by name + company. */
export function matchEmailToPerson(
  person: SmartLeadsPersonRow,
  emails: SmartLeadsEmailRow[],
): SmartLeadsEmailRow | undefined {
  const fn = norm(person.full_name);
  const cn = norm(person.company_name);
  if (!fn) return undefined;
  const exact = emails.find(
    (e) => norm(e.full_name) === fn && (!cn || norm(e.company_name) === cn),
  );
  if (exact) return exact;
  return emails.find((e) => norm(e.full_name) === fn);
}

export interface SmartLeadsExportRow {
  company_name: string;
  company_linkedin_url: string;
  company_website_url: string;
  company_snippet: string;
  person_full_name: string;
  person_job_title: string;
  person_linkedin_url: string;
  person_snippet: string;
  work_email: string;
  email_confidence: string;
  email_pattern: string;
  /** Same categories as the Smart Leads UI badges */
  email_validation: string;
  email_smtp_status: string;
  email_catch_all: string;
  email_llm_score: string;
  email_zerobounce_status: string;
}

const CSV_COLUMNS: (keyof SmartLeadsExportRow)[] = [
  "company_name",
  "company_linkedin_url",
  "company_website_url",
  "company_snippet",
  "person_full_name",
  "person_job_title",
  "person_linkedin_url",
  "person_snippet",
  "work_email",
  "email_confidence",
  "email_pattern",
  "email_validation",
  "email_smtp_status",
  "email_catch_all",
  "email_llm_score",
  "email_zerobounce_status",
];

/** Labels aligned with SmartLeadsClient table badges (empty when no email on row). */
export function smartLeadsEmailValidationFields(email: SmartLeadsEmailRow | undefined): {
  email_validation: string;
  email_smtp_status: string;
  email_catch_all: string;
  email_llm_score: string;
  email_zerobounce_status: string;
} {
  if (!email?.email) {
    return {
      email_validation: "",
      email_smtp_status: "",
      email_catch_all: "",
      email_llm_score: "",
      email_zerobounce_status: "",
    };
  }
  const v = email.validation;
  const st = v?.smtp_status ?? "";
  const catchAll = Boolean(v?.catch_all);
  const strong =
    v?.mailbox_verified_strong === true ||
    (v?.mailbox_verified_strong == null && st === "valid" && !catchAll);
  const isRcptWeakCatchAll = st === "valid" && catchAll;
  const isProbe = st === "sent_probe";

  let email_validation = "";
  if (strong) email_validation = "Mailbox verified";
  else if (isRcptWeakCatchAll) email_validation = "Catch-all / risky";
  else if (isProbe) email_validation = catchAll ? "Probe sent · risky domain" : "Probe sent";
  else if (v && st) email_validation = "MX OK";

  const llmScore = v?.llm_candidate_score;
  const zb = v?.zerobounce_status;
  return {
    email_validation,
    email_smtp_status: st,
    email_catch_all: catchAll ? "yes" : v?.catch_all === false ? "no" : "",
    email_llm_score: typeof llmScore === "number" ? String(llmScore) : "",
    email_zerobounce_status: typeof zb === "string" && zb ? zb : "",
  };
}

function companyById(companies: SmartLeadsCompanyRow[]): Map<string, SmartLeadsCompanyRow> {
  return new Map(companies.map((c) => [c.id, c]));
}

function companyByName(companies: SmartLeadsCompanyRow[], name: string): SmartLeadsCompanyRow | undefined {
  const n = norm(name);
  return companies.find((c) => norm(c.name) === n);
}

/**
 * One row per person (with company + optional matched email).
 * Adds company-only rows for companies with no people.
 * Adds email-only rows for emails that didn’t match a person.
 */
export function buildSmartLeadsExportRows(detail: SmartLeadsRunDetailResponse): SmartLeadsExportRow[] {
  const { companies, people, emails } = detail;
  const cmap = companyById(companies);
  const usedEmailIds = new Set<string>();
  const rows: SmartLeadsExportRow[] = [];

  for (const p of people) {
    const c = p.company_id ? cmap.get(p.company_id) : undefined;
    const email = matchEmailToPerson(p, emails);
    if (email) usedEmailIds.add(email.id);
    const vf = smartLeadsEmailValidationFields(email);

    rows.push({
      company_name: c?.name || p.company_name || "",
      company_linkedin_url: c?.linkedin_url || "",
      company_website_url: c?.website_url || "",
      company_snippet: clip(c?.snippet || "", 800),
      person_full_name: p.full_name || "",
      person_job_title: p.title || "",
      person_linkedin_url: p.linkedin_url || "",
      person_snippet: clip(p.snippet || "", 800),
      work_email: email?.email || "",
      email_confidence: email?.confidence || "",
      email_pattern: email?.pattern || "",
      ...vf,
    });
  }

  const peopleCompanyIds = new Set(people.map((p) => p.company_id).filter(Boolean) as string[]);
  for (const c of companies) {
    if (!peopleCompanyIds.has(c.id)) {
      rows.push({
        company_name: c.name || "",
        company_linkedin_url: c.linkedin_url || "",
        company_website_url: c.website_url || "",
        company_snippet: clip(c.snippet || "", 800),
        person_full_name: "",
        person_job_title: "",
        person_linkedin_url: "",
        person_snippet: "",
        work_email: "",
        email_confidence: "",
        email_pattern: "",
        email_validation: "",
        email_smtp_status: "",
        email_catch_all: "",
        email_llm_score: "",
        email_zerobounce_status: "",
      });
    }
  }

  for (const e of emails) {
    if (usedEmailIds.has(e.id)) continue;
    const co = companyByName(companies, e.company_name || "");
    rows.push({
      company_name: co?.name || e.company_name || "",
      company_linkedin_url: co?.linkedin_url || "",
      company_website_url: co?.website_url || "",
      company_snippet: clip(co?.snippet || "", 800),
      person_full_name: e.full_name || "",
      person_job_title: "",
      person_linkedin_url: "",
      person_snippet: "",
      work_email: e.email || "",
      email_confidence: e.confidence || "",
      email_pattern: e.pattern || "",
      ...smartLeadsEmailValidationFields(e),
    });
  }

  return rows;
}

function escapeCsvCell(v: string): string {
  const s = String(v).replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) return `"${s}"`;
  return s;
}

export function exportRowsToCsv(rows: SmartLeadsExportRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((k) => escapeCsvCell(row[k] ?? "")).join(","),
  );
  // BOM helps Excel recognize UTF-8
  return "\uFEFF" + [header, ...lines].join("\r\n");
}

export function buildSmartLeadsExportPayload(detail: SmartLeadsRunDetailResponse) {
  const run = detail.run;
  return {
    exported_at: new Date().toISOString(),
    run_id: run.id,
    run_status: run.status,
    run_created_at: run.created_at,
    companies: detail.companies.map((c) => ({
      id: c.id,
      name: c.name ?? null,
      linkedin_url: c.linkedin_url ?? null,
      website_url: c.website_url ?? null,
      snippet: c.snippet ?? null,
    })),
    people: detail.people.map((p) => ({
      id: p.id,
      company_id: p.company_id ?? null,
      company_name: p.company_name ?? null,
      full_name: p.full_name ?? null,
      title: p.title ?? null,
      linkedin_url: p.linkedin_url ?? null,
      snippet: p.snippet ?? null,
    })),
    emails: detail.emails.map((e) => ({
      id: e.id,
      email: e.email,
      full_name: e.full_name ?? null,
      company_name: e.company_name ?? null,
      pattern: e.pattern ?? null,
      confidence: e.confidence ?? null,
      validation: e.validation ?? null,
    })),
    joined_rows: buildSmartLeadsExportRows(detail),
  };
}

export function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function defaultExportBasename(runId: string): string {
  const short = runId.replace(/-/g, "").slice(0, 8);
  const d = new Date().toISOString().slice(0, 10);
  return `smart-leads-${short}-${d}`;
}
