/** Client-safe pricing display helpers (used by /pricing UI). */

import type { PricingPlan, FeatureItem } from "@/lib/pricing";

export const DAILY_LIMIT_TOOLTIP =
  "Each inbox — Gmail or domain — safely sends up to 50 emails a day. So your limit is simply: number of inboxes × 50 a day, or about ×30 for the month. We cap it this way to protect your sender reputation and keep you out of spam.";

export const CAMPAIGNS_TOOLTIP =
  "How many campaigns you can run at the same time. For example, with a limit of 3 you can have 3 campaigns sending at once without pausing any of them.";

export const DOMAIN_WARMUP_TOOLTIP =
  "We automatically warm up your inboxes over about 30 days — sending gentle test emails and making sure they land in the inbox, not spam. This builds your sender reputation so your real campaigns are far more likely to reach people.";

export const API_ACCESS_TOOLTIP =
  "API access lets you read your data (campaigns, contacts, analytics, and more). It's read-only — you can't create or change anything through the API.";

export const GOOGLE_ACCOUNTS_TOOLTIP =
  "A Gmail inbox you connect to send and receive email — either sign in with Google (OAuth) or use a Google app password. Each Gmail inbox safely sends up to 50 emails a day.";

export const SUBDOMAINS_TOOLTIP =
  "A sending inbox on your own domain. From a domain like example.com you can create inboxes such as mail.example.com and send from them. Each domain inbox safely sends up to 50 emails a day.";

export const SENDING_INBOXES_TOOLTIP =
  "Your total sending mailboxes — Gmail inboxes plus domain inboxes added together. Each one safely sends up to 50 emails a day, and spreading sends across several inboxes protects your reputation.";

export type DailyLimitBreakdownItem = {
  count: number;
  type: string;
  isGoogle: boolean;
  perDay: number;
};

export function parseDailyLimitFormula(
  formula?: string | null
): { breakdown: DailyLimitBreakdownItem[]; totalInboxes: number } {
  if (!formula) {
    return { breakdown: [], totalInboxes: 0 };
  }
  const breakdown = formula.split(", ").map((part) => {
    const [countRaw, typeRaw = ""] = part.split("×");
    const count = parseInt(countRaw, 10) || 0;
    const type = typeRaw.trim();
    const isGoogle = type.toLowerCase().includes("google");
    const perDay = count * 50;
    return { count, type, isGoogle, perDay };
  });
  const totalInboxes = breakdown.reduce((sum, item) => sum + item.count, 0);
  return { breakdown, totalInboxes };
}

export function getDailyLimitBreakdown(plan: PricingPlan): {
  breakdown: DailyLimitBreakdownItem[];
  totalInboxes: number;
} {
  const ga = plan.max_google_accounts ?? 0;
  const sub = plan.max_subdomains ?? 0;
  const hasNumericLimits =
    (typeof plan.max_google_accounts === "number" && plan.max_google_accounts >= 0) ||
    (typeof plan.max_subdomains === "number" && plan.max_subdomains >= 0);
  if (hasNumericLimits) {
    const breakdown: DailyLimitBreakdownItem[] = [];
    if (ga > 0) {
      breakdown.push({ count: ga, type: "Google", isGoogle: true, perDay: ga * 50 });
    }
    if (sub > 0) {
      breakdown.push({ count: sub, type: "Subdomains", isGoogle: false, perDay: sub * 50 });
    }
    return { breakdown, totalInboxes: ga + sub };
  }
  return parseDailyLimitFormula(plan.dailyLimitFormula);
}

export function hasExplicitMonthlySmtpLimit(plan: PricingPlan): boolean {
  const v = plan.max_monthly_smtp_emails;
  return typeof v === "number" && v >= 0;
}

export function getExplicitMonthlySmtpEmails(plan: PricingPlan): number | null {
  return hasExplicitMonthlySmtpLimit(plan) ? plan.max_monthly_smtp_emails! : null;
}

export function getDerivedDailyTotal(plan: PricingPlan): number | null {
  const { breakdown } = getDailyLimitBreakdown(plan);
  if (breakdown.length === 0) return null;
  return breakdown.reduce((sum, item) => sum + item.perDay, 0);
}

export function descriptionWithValues(description: string, plan: PricingPlan): string {
  const googleLabel =
    plan.googleAccounts === "—"
      ? "No Gmail inboxes"
      : `${plan.googleAccounts} Gmail ${plan.googleAccounts === "1" ? "inbox" : "inboxes"}`;
  return (
    description
      .replace(/\{\{googleAccounts\}\}/gi, googleLabel)
      .replace(/\{\{domains\}\}/g, plan.domains)
      .replace(/\{\{subdomains\}\}/g, plan.subdomains)
      .replace(/\{\{campaigns\}\}/g, plan.campaigns)
      .replace(/\{\{dailyEmails\}\}/g, plan.dailyEmails)
      // Keep vocabulary consistent with the rest of the page even when the
      // stored copy still says "Google account(s)".
      .replace(/(\d+)\s+Google accounts?/gi, (_m, n: string) =>
        `${n} Gmail ${n === "1" ? "inbox" : "inboxes"}`
      )
      .replace(/Google accounts?/gi, "Gmail inboxes")
      // Tidy up "1 <plural>" pluralization from stored copy.
      .replace(/\b1 inboxes\b/g, "1 inbox")
      .replace(/\b1 campaigns\b/g, "1 campaign")
      .replace(/\b1 domains\b/g, "1 domain")
  );
}

export function getFeatureDisplay(
  feature: FeatureItem,
  plan: PricingPlan
): { text: string; included: boolean } {
  const t = feature.text.toLowerCase();
  // These matchers auto-populate count/toggle lines from the plan's numeric fields.
  // They must only fire on the dedicated count/toggle line (e.g. "5 campaigns"),
  // not on unrelated marketing copy that happens to share a word (e.g. "AI Campaign Studio").
  const startsWithDigit = /^\s*\d/.test(feature.text);
  if (
    startsWithDigit &&
    ((t.includes("domain") && t.includes("subdomain")) || (t.includes("domains") && t.includes("subdomains")))
  ) {
    const domainLabel = plan.domains === "1" ? "domain" : "domains";
    const inboxLabel = plan.subdomains === "1" ? "domain inbox" : "domain inboxes";
    return { text: `${plan.domains} ${domainLabel}, ${plan.subdomains} ${inboxLabel}`, included: true };
  }
  if (startsWithDigit && t.includes("campaign")) {
    const campaignLabel = plan.campaigns === "1" ? "campaign" : "campaigns";
    return { text: `${plan.campaigns} ${campaignLabel}`, included: true };
  }
  if (startsWithDigit && t.includes("google account")) {
    const label =
      plan.googleAccounts === "—"
        ? "No Gmail inboxes"
        : `${plan.googleAccounts} Gmail ${plan.googleAccounts === "1" ? "inbox" : "inboxes"}`;
    return { text: label, included: plan.googleAccounts !== "—" && plan.googleAccounts !== "0" };
  }
  if (t.includes("domain warmup")) {
    // Keep the stored copy (e.g. "Automatic domain warmup & auto-reroute") — only
    // the included/excluded state is driven dynamically by the plan's warmup flag.
    return { text: feature.text, included: plan.warmup };
  }
  return { text: feature.text, included: feature.included };
}

export function getMonthlyEmails(plan: PricingPlan): string | null {
  const explicitMonthly = getExplicitMonthlySmtpEmails(plan);
  if (explicitMonthly != null) return explicitMonthly.toLocaleString();

  const derivedDaily = getDerivedDailyTotal(plan);
  if (derivedDaily != null && derivedDaily > 0) return (derivedDaily * 30).toLocaleString();
  if (!plan.dailyEmails) return null;
  const match = plan.dailyEmails.match(/[\d,]+/);
  if (!match) return null;
  const daily = parseInt(match[0].replace(/,/g, ""), 10);
  if (!daily || Number.isNaN(daily)) return null;
  return (daily * 30).toLocaleString();
}

export function getDailyEmailsForTable(plan: PricingPlan): string {
  const explicitMonthly = getExplicitMonthlySmtpEmails(plan);
  if (explicitMonthly != null) return Math.round(explicitMonthly / 30).toLocaleString();

  const derived = getDerivedDailyTotal(plan);
  if (derived != null && derived > 0) return derived.toLocaleString();
  return plan.dailyEmails ?? "—";
}

/** Emails a single inbox (Gmail or domain) can safely send per day. */
export const EMAILS_PER_INBOX_PER_DAY = 50;

/** Total sending inboxes = Gmail inboxes + domain inboxes. Uses display values so it works even when raw limits are absent. */
export function getSendingInboxCount(plan: PricingPlan): number | null {
  if (plan.googleAccounts === "Custom" || plan.subdomains === "Custom") return null;
  const gmail = plan.googleAccounts === "—" ? 0 : parseInt(plan.googleAccounts.replace(/,/g, ""), 10) || 0;
  const domain = parseInt(plan.subdomains.replace(/,/g, ""), 10) || 0;
  return gmail + domain;
}

/** Display string for the "total sending inboxes" row/label. */
export function getSendingInboxDisplay(plan: PricingPlan): string {
  const count = getSendingInboxCount(plan);
  if (count == null) return "Custom";
  return count > 0 ? count.toLocaleString() : "—";
}

/**
 * Plain, always-consistent daily line derived from the SAME figure shown as monthly,
 * e.g. "≈ 250 emails a day". We deliberately avoid "inboxes × 50" math here: plans can
 * carry an explicit monthly cap that isn't inbox-count × 50, so multiplying would
 * contradict the headline. Daily is just the monthly figure ÷ 30.
 */
export function getCapacitySubtext(plan: PricingPlan): string | null {
  const daily = getDailyEmailsForTable(plan);
  if (!daily || daily === "—") return null;
  return `≈ ${daily} emails a day`;
}

/** Monthly USD amounts; Custom / free handled separately. */
export function displayPrice(plan: PricingPlan):
  | "Custom"
  | { monthly: number; annual: number } {
  if (plan.price === "Custom") return "Custom";
  if (plan.price === "0") return { monthly: 0, annual: 0 };
  const p = parseInt(plan.price, 10);
  return { monthly: p, annual: Math.round(p * 0.83 * 12) };
}
