/**
 * Mirrors backend services/plan_service.py outbound gating for client-side UX
 * (toasts, disabled actions) before the API responds.
 */

export type OutboundGateUser = {
  subscription_status?: string | null;
  subscription_start?: string | null;
  subscription_end?: string | null;
  plan_id?: string | null;
};

function parseCalendarDate(val: unknown): Date | null {
  if (val == null) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return new Date(Date.UTC(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate()));
  }
  const s = String(val).trim();
  if (!s) return null;
  try {
    if (s.includes("T")) {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return null;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    const y = parseInt(s.slice(0, 4), 10);
    const m = parseInt(s.slice(5, 7), 10) - 1;
    const day = parseInt(s.slice(8, 10), 10);
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(day)) return null;
    return new Date(Date.UTC(y, m, day));
  } catch {
    return null;
  }
}

function todayUtcDate(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function subscriptionBlocksOutbound(subscriptionStatus: string | null | undefined): boolean {
  return (subscriptionStatus || "").trim().toLowerCase() === "pending";
}

function cancelledPaidPeriodEnded(user: OutboundGateUser): boolean {
  const status = (user.subscription_status || "").trim().toLowerCase();
  if (status !== "cancelled") return false;
  const pid = (user.plan_id || "").trim().toLowerCase();
  if (!pid || pid === "free") return false;
  const endD = parseCalendarDate(user.subscription_end);
  if (!endD) return false;
  return todayUtcDate().getTime() > endD.getTime();
}

function subscriptionOutsidePaidWindow(user: OutboundGateUser): boolean {
  const pid = (user.plan_id || "").trim().toLowerCase();
  if (!pid || pid === "free") return false;
  const endD = parseCalendarDate(user.subscription_end);
  if (!endD) return false;
  const today = todayUtcDate().getTime();
  if (endD && today > endD.getTime()) return true;
  return false;
}

/** True when warmup / campaign outbound should be blocked (matches backend). */
export function userSubscriptionBlocksOutbound(user: OutboundGateUser | null | undefined): boolean {
  if (!user) return false;
  if (subscriptionBlocksOutbound(user.subscription_status)) return true;
  const status = (user.subscription_status || "").trim().toLowerCase();
  if (status === "cancelled") return cancelledPaidPeriodEnded(user);
  if (subscriptionOutsidePaidWindow(user)) return true;
  return false;
}

export function outboundSubscriptionBlockMessage(user: OutboundGateUser | null | undefined): string | null {
  if (!user || !userSubscriptionBlocksOutbound(user)) return null;
  if (subscriptionBlocksOutbound(user.subscription_status)) {
    return "Your subscription payment is pending. Update billing in Settings → Billing to send email.";
  }
  if (cancelledPaidPeriodEnded(user)) {
    return (
      "Your subscription is cancelled and the current billing period has ended. " +
      "Renew in Settings → Billing to send email."
    );
  }
  return (
    "Your subscription is outside the current billing period (From/To dates). " +
    "Check Settings → Billing to renew or fix your plan before sending."
  );
}

export function formatSubscriptionDate(val: string | null | undefined): string {
  const d = parseCalendarDate(val);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

export function formatSubscriptionStatus(status: string | null | undefined): string {
  const s = (status || "").trim();
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
