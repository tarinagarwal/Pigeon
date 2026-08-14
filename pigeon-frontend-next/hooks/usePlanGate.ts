import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

type NumericResourceKey = "campaigns" | "domains" | "subdomains" | "inboxes";
type BooleanResourceKey = "warmup" | "ai_emails";

export type PlanResourceKey = NumericResourceKey | BooleanResourceKey;

export interface PlanGateResult {
  key: PlanResourceKey;
  /** Human friendly label, e.g. "campaigns", "connected inboxes" */
  label: string;
  /** Current usage (for numeric resources), null when not applicable or unknown */
  usage: number | null;
  /** Plan limit (for numeric resources), null when unlimited or unknown */
  limit: number | null;
  /** Remaining units before hitting the limit (numeric resources only) */
  remaining: number | null;
  /** True when the feature is locked or the numeric limit is reached */
  atLimit: boolean;
  /** Convenience flag: true when user is allowed to create/use this feature */
  canCreate: boolean;
  /** Short sentence explaining why the feature is locked / limited */
  reason: string;
  /** Upgrade helper text used in toasts / banners */
  upgradeLine: string;
  /** CTA label, e.g. \"Upgrade Plan\" */
  ctaLabel: string;
  /** Current plan name, if available */
  planName?: string;
}

const RESOURCE_LABELS: Record<PlanResourceKey, string> = {
  campaigns: "campaigns",
  domains: "domains",
  subdomains: "subdomains",
  inboxes: "connected inboxes",
  warmup: "warmup",
  ai_emails: "AI email variation",
};

/**
 * Centralized helper for plan/usage gating.
 *
 * Rules:
 * - Numeric limits use user.limits + user.usage, with -1 meaning unlimited.
 * - Warmup and AI email variation are treated as boolean features, controlled by user.limits.warmup.
 */
export function usePlanGate(key: PlanResourceKey): PlanGateResult {
  const { user } = useAuth();

  const result = useMemo<PlanGateResult>(() => {
    const label = RESOURCE_LABELS[key];
    const plan = user?.plan ?? undefined;
    const usage = user?.usage;
    const limits = user?.limits;
    const planName = plan?.name;

    // Default: no gating if we don't know anything about limits yet.
    if (!user || !limits) {
      return {
        key,
        label,
        usage: null,
        limit: null,
        remaining: null,
        atLimit: false,
        canCreate: true,
        reason: "",
        upgradeLine: `Upgrade at the Pricing page to unlock more ${label}.`,
        ctaLabel: "Upgrade Plan",
        planName,
      };
    }

    // Boolean features – controlled mainly by limits.warmup, treated as premium.
    if (key === "warmup" || key === "ai_emails") {
      const warmupEnabled = !!limits.warmup;
      const atLimit = !warmupEnabled;
      const reason = atLimit
        ? `Your current plan does not include ${key === "warmup" ? "inbox warmup" : "AI email variation"}.`
        : "";

      return {
        key,
        label,
        usage: null,
        limit: null,
        remaining: null,
        atLimit,
        canCreate: !atLimit,
        reason,
        upgradeLine: `Upgrade at the Pricing page to unlock ${label}.`,
        ctaLabel: "View Plans",
        planName,
      };
    }

    // Numeric resources – use usage/limits with -1 meaning unlimited.
    let limitValue: number | null = null;
    let usageValue: number | null = null;

    switch (key) {
      case "campaigns":
        limitValue = limits.max_campaigns ?? null;
        // Prefer active campaign usage for concurrency-based limits, with safe fallbacks.
        usageValue =
          (usage as any)?.active_campaigns ??
          (usage as any)?.campaigns_active ??
          usage?.campaigns ??
          null;
        break;
      case "domains":
        limitValue = limits.max_domains ?? null;
        usageValue = usage?.domains ?? null;
        break;
      case "subdomains":
        limitValue = limits.max_subdomains ?? null;
        usageValue = usage?.subdomains ?? null;
        break;
      case "inboxes":
        // For plan gating on "Create Inbox", we only care about domain-based inboxes.
        // They are tied 1:1 with subdomains, so use max_subdomains and smtp_inboxes.
        limitValue = limits.max_subdomains ?? null;
        usageValue = (usage as any)?.smtp_inboxes ?? usage?.inboxes ?? null;
        break;
      default:
        break;
    }

    // If no limit configured, treat as unlimited.
    if (limitValue == null || typeof limitValue !== "number") {
      return {
        key,
        label,
        usage: usageValue,
        limit: null,
        remaining: null,
        atLimit: false,
        canCreate: true,
        reason: "",
        upgradeLine: `Upgrade at the Pricing page to unlock more ${label}.`,
        ctaLabel: "Upgrade Plan",
        planName,
      };
    }

    // -1 means unlimited.
    if (limitValue === -1) {
      return {
        key,
        label,
        usage: usageValue,
        limit: null,
        remaining: null,
        atLimit: false,
        canCreate: true,
        reason: "",
        upgradeLine: "",
        ctaLabel: "Upgrade Plan",
        planName,
      };
    }

    const used = usageValue ?? 0;
    const atLimit = used >= limitValue;
    const remaining = Math.max(limitValue - used, 0);

    const upgradeLine = `Plan limit reached: maximum ${limitValue} ${label}. Upgrade at the Pricing page to add more.`;
    const reason = atLimit ? upgradeLine : "";

    return {
      key,
      label,
      usage: usageValue,
      limit: limitValue,
      remaining,
      atLimit,
      canCreate: !atLimit,
      reason,
      upgradeLine,
      ctaLabel: "Upgrade Plan",
      planName,
    };
  }, [key, user]);

  return result;
}

