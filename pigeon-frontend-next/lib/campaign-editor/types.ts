/** Shared campaign wizard form types (create + edit). */

export type CampaignEmailStep = {
  templateIds: string[];
  delay: number;
};

export type CampaignFormData = {
  name: string;
  inbox: string;
  senderType: "gmail" | "smtp";
  senderIds: string[];
  senderRotation: "round_robin" | "random";
  timezone: string;
  contactList: string;
  emails: CampaignEmailStep[];
  dailyLimit: number;
  startTime: string;
  endTime: string;
  scheduleWeekdays: number[];
  enableRotation: boolean;
  useAiGeneration: boolean;
  aiGenerationPrompt: string;
  aiGenerationProvider: string;
  useExternalEnrichment: boolean;
  externalEnrichmentPrompt: string;
  externalEnrichmentProvider: string;
  dailyLimitTouched?: boolean;
  campaignRealEngagementNetwork: boolean;
  campaignPersonalNetworkPool: boolean;
  campaignRealEngagementPercent: number;
  openTracking: boolean;
};

export type ReplyToFormState = {
  replyToType: "default" | "none" | "gmail" | "imap" | "custom";
  replyToId: string | null;
  replyToEmail: string;
};

export type ValidationTier = "draft" | "ready";
