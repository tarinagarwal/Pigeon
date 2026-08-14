/**
 * Marketing conversion analytics – event labels for KPIs (doc section 8.3).
 * Wired to GA4 (Measurement ID G-RHXVEGZF2X, Stream ID 13586194862).
 *
 * Events:
 * - cta_click: { event_label: "hero_start_trial" | "pricing_start_trial" | ... }
 * - signup_start, signup_complete, contact_submit
 */

declare global {
  interface Window {
    gtag?: (
      command: "event" | "config" | "js",
      targetId: string,
      params?: Record<string, unknown>
    ) => void;
  }
}

export type CtaClickLabel =
  | "hero_start_trial"
  | "social_proof_bar_start_trial"
  | "social_proof_bar_book_demo"
  | "pricing_start_trial"
  | "final_cta_start_trial"
  | "book_demo"
  | "book_demo_header"
  | "features_start_trial"
  | "testimonials_start_trial"
  | "blog_start_trial"
  | "tools_start_trial"
  | "comparisons_start_trial"
  | "use_cases_start_trial"
  | "resources_start_trial";

function sendEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
): void {
  if (typeof window === "undefined") return;
  window.gtag?.("event", eventName, params as Record<string, unknown>);
  if (process.env.NODE_ENV === "development") {
    console.debug("[marketing]", eventName, params);
  }
}

export function trackCtaClick(label: CtaClickLabel): void {
  sendEvent("cta_click", { event_label: label });
}

export function trackSignupStart(): void {
  sendEvent("signup_start");
}

export function trackSignupComplete(): void {
  sendEvent("signup_complete");
}

export function trackContactSubmit(): void {
  sendEvent("contact_submit");
}
