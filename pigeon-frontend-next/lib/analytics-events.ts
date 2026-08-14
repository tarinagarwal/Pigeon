"use client";

export type ActivationEventName =
  | "setup_step_viewed"
  | "setup_step_completed"
  | "setup_continue_clicked"
  | "dashboard_primary_cta_clicked"
  | "auth_signup_completed"
  | "auth_login_completed";

export function trackEvent(
  name: ActivationEventName,
  payload: Record<string, unknown> = {}
) {
  if (typeof window === "undefined") return;

  const event = {
    name,
    payload,
    ts: Date.now(),
  };

  // Simple in-app event stream for future analytics wiring.
  window.dispatchEvent(new CustomEvent("pigeon:analytics", { detail: event }));

  // Optional GTM/dataLayer compatibility.
  const dataLayer = (window as Window & { dataLayer?: Array<Record<string, unknown>> }).dataLayer;
  if (Array.isArray(dataLayer)) {
    dataLayer.push({ event: name, ...payload });
  }
}

