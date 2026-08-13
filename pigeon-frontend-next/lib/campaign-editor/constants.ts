import { CalendarClock, Eye, Mail, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CampaignFormData } from "./types";

/** Unified 5-step campaign wizard (Basics → Audience → Sequence → Delivery → Review). */
export const CAMPAIGN_WIZARD_STEPS: { id: number; title: string; icon: LucideIcon }[] = [
  { id: 1, title: "Basics", icon: Settings },
  { id: 2, title: "Audience", icon: Users },
  { id: 3, title: "Email sequence", icon: Mail },
  { id: 4, title: "Delivery", icon: CalendarClock },
  { id: 5, title: "Review", icon: Eye },
];

export const TZ_LABELS: Record<string, string> = {
  "America/New_York": "Eastern Time (ET)",
  "America/Chicago": "Central Time (CT)",
  "America/Denver": "Mountain Time (MT)",
  "America/Los_Angeles": "Pacific Time (PT)",
  "Europe/London": "London (GMT)",
  /** IANA deprecated Asia/Calcutta in favor of Asia/Kolkata; normalize API values to Kolkata in UI. */
  "Asia/Kolkata": "India (IST)",
};

/** 0=Mon … 6=Sun — matches backend (Python weekday). Default Mon–Fri. */
export const DEFAULT_SCHEDULE_WEEKDAYS: number[] = [0, 1, 2, 3, 4];

export const WEEKDAY_TOGGLE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
];

export const AI_GENERATION_PROMPT_PRESETS = [
  "Rewrite this email to sound natural, human, and non-salesy while keeping the same message and all variables.",
  "Rewrite this email to improve clarity and flow, keeping the intent and all variables unchanged.",
  "Rewrite this email to increase replies without adding hype or sales language. Keep variables intact.",
  "Rewrite this email to sound warm and conversational, but still professional. Do not change any variables.",
  "Rewrite this email to be concise and skimmable while preserving meaning and variables.",
  "Rewrite this email to remove spammy phrasing and make it inbox-safe. Keep all variables.",
  "Rewrite this email to sound like a real person wrote it, not AI or marketing copy. Keep variables unchanged.",
  "Rewrite this email to be more approachable and low-pressure while keeping the same intent and variables.",
  "Rewrite this email to improve tone for cold outreach and keep all personalization variables exactly the same.",
  "Rewrite this email to sound helpful and relevant to the recipient without changing the core message or variables.",
];

const INBOX_RECOMMEND_EMAILS_PER_DAY = 35;
const INBOX_RECOMMEND_MIN = 3;

export function getRecommendedInboxesAndSpread(listSize: number): { inboxes: number; spreadDays: number } {
  if (listSize <= 0) return { inboxes: INBOX_RECOMMEND_MIN, spreadDays: 1 };
  const inboxes = Math.max(INBOX_RECOMMEND_MIN, Math.ceil(listSize / 10 / INBOX_RECOMMEND_EMAILS_PER_DAY));
  const spreadDays = Math.max(1, Math.ceil(listSize / (inboxes * INBOX_RECOMMEND_EMAILS_PER_DAY)));
  return { inboxes, spreadDays };
}

export function getStartNowScheduleInTimezone(tz: string): { startTime: string; endTime: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const startTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const endH = (hour + 12) % 24;
  const endTime = `${String(endH).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { startTime, endTime };
}

export function getRootDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-2).join(".");
}

export function defaultCampaignFormData(): CampaignFormData {
  return {
    name: "",
    inbox: "",
    senderType: "smtp",
    senderIds: [],
    senderRotation: "random",
    timezone: "America/New_York",
    contactList: "",
    emails: [{ templateIds: [""], delay: 0 }],
    dailyLimit: 30,
    startTime: "09:00",
    endTime: "17:00",
    scheduleWeekdays: [...DEFAULT_SCHEDULE_WEEKDAYS],
    enableRotation: true,
    useAiGeneration: false,
    aiGenerationPrompt: "",
    aiGenerationProvider: "",
    useExternalEnrichment: false,
    externalEnrichmentPrompt: "",
    externalEnrichmentProvider: "",
    campaignRealEngagementNetwork: false,
    campaignPersonalNetworkPool: false,
    campaignRealEngagementPercent: 60,
    openTracking: true,
  };
}
