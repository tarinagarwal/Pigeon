import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function detectRegion(request: NextRequest): { country_code: string | null; is_india: boolean | null } {
  const country =
    request.headers.get("cf-ipcountry") ||
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("x-country-code") ||
    null;
  const is_india = country ? country.toUpperCase() === "IN" : null;
  return { country_code: country, is_india };
}

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const { country_code, is_india } = detectRegion(request);

  return NextResponse.json({
    id: "demo-user",
    email: "demo@pigeon.local",
    first_name: "Demo",
    last_name: "User",
    plan_id: "demo",
    subscription_status: "demo",
    trial_ends_at: null,
    trial_used_at: null,
    subscription_start: null,
    subscription_end: null,
    two_fa_enabled: false,
    created_at: now,
    updated_at: now,
    country_code,
    is_india,
    plan: {
      id: "demo",
      name: "Demo",
      price: "0",
      description: "Read-only demo plan with placeholder data.",
      max_domains: 2,
      max_subdomains: 3,
      max_google_accounts: 1,
      max_campaigns: 3,
      warmup: true,
      support: "Demo",
    },
    limits: {
      max_domains: 2,
      max_subdomains: 3,
      max_google_accounts: 1,
      max_campaigns: 3,
      max_monthly_smtp_emails: 3000,
      warmup: true,
    },
    usage: {
      domains: 2,
      subdomains: 2,
      campaigns: 2,
      inboxes: 3,
      smtp_inboxes: 2,
      gmail_inboxes: 1,
      emails_today: 42,
      smtp_emails_month: 1200,
      gmail_emails_month: 1800,
    },
  });
}
