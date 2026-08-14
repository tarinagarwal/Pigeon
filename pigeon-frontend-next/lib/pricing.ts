/** Shared pricing types and mapping for SSR + client. */

export type FeatureItem = { text: string; included: boolean };

export type PricingPlan = {
  id: string;
  name: string;
  price: string;
  description: string;
  badge?: string | null;
  bestFor?: string;
  features: FeatureItem[];
  dailyLimit?: string;
  dailyLimitFormula?: string;
  cta: string;
  ctaSubtext?: string;
  popular: boolean;
  googleAccounts: string;
  domains: string;
  subdomains: string;
  campaigns: string;
  dailyEmails: string;
  warmup: boolean;
  support: string;
  max_google_accounts?: number;
  max_subdomains?: number;
  max_monthly_smtp_emails?: number;
};

function displayFromNumeric(
  num: number | string | undefined | null,
  display: string | undefined | null,
  fallback: string,
  zeroDash = false
): string {
  const n =
    typeof num === "number"
      ? num
      : typeof num === "string"
        ? parseInt(num, 10)
        : NaN;
  if (!Number.isNaN(n)) {
    if (n === -1) return "Custom";
    if (zeroDash && n === 0) return "—";
    return n >= 1000 ? n.toLocaleString() : String(n);
  }
  return display ?? fallback;
}

export function mapApiPlanToPricingPlan(p: Record<string, unknown>): PricingPlan {
  const dailyEmailsVal = displayFromNumeric(
    undefined,
    p.daily_emails_display as string | undefined,
    "50"
  );
  return {
    id: (p.id as string) ?? "",
    name: (p.name as string) ?? "",
    price: (p.price as string) ?? "0",
    description: (p.description as string) ?? "",
    badge: (p.badge as string | null) ?? null,
    bestFor: (p.best_for as string) ?? undefined,
    features: Array.isArray(p.features) ? (p.features as FeatureItem[]) : [],
    dailyLimit: (p.daily_limit as string) ?? dailyEmailsVal,
    dailyLimitFormula: (p.daily_limit_formula as string) ?? undefined,
    cta: (p.cta as string) ?? "Get started",
    ctaSubtext: (p.cta_subtext as string) ?? undefined,
    popular: Boolean(p.popular),
    googleAccounts: displayFromNumeric(
      p.max_google_accounts as number | undefined,
      p.google_accounts_display as string | undefined,
      "—",
      true
    ),
    domains: displayFromNumeric(p.max_domains as number | string | undefined, p.domains_display as string | undefined, "1"),
    subdomains: displayFromNumeric(p.max_subdomains as number | string | undefined, p.subdomains_display as string | undefined, "1"),
    campaigns: displayFromNumeric(p.max_campaigns as number | string | undefined, undefined, "1"),
    dailyEmails: dailyEmailsVal,
    warmup: Boolean(p.warmup),
    support: (p.support as string) ?? "Community",
    max_google_accounts:
      typeof p.max_google_accounts === "number" && p.max_google_accounts >= 0
        ? p.max_google_accounts
        : undefined,
    max_subdomains:
      typeof p.max_subdomains === "number" && p.max_subdomains >= 0
        ? p.max_subdomains
        : undefined,
    max_monthly_smtp_emails:
      typeof p.max_monthly_smtp_emails === "number"
        ? p.max_monthly_smtp_emails
        : p.max_monthly_smtp_emails != null
          ? Number(p.max_monthly_smtp_emails)
          : undefined,
  };
}
