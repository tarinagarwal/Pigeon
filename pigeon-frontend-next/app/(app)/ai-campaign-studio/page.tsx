"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { useTemplates, useCreateTemplate, useUpdateTemplate, useDeleteTemplate, useDeleteTemplates } from "@/hooks/useTemplates";
import { useContactLists } from "@/hooks/useContacts";
import { useLLMConfigs, useGenerateTemplate } from "@/hooks/useLLM";
import { useCreateCampaign, useStartCampaign } from "@/hooks/useCampaigns";
import { useInboxes } from "@/hooks/useInboxes";
import { useSettings } from "@/hooks/useSettings";
import { useDomains } from "@/hooks/useDomains";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";
import { HelpLinks } from "@/components/HelpLinks";
import { Listen } from "@/components/Listen";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import {
  getNextTemplateName,
  getNextSequenceNumber,
  getSequenceNumberForStep,
  getTemplateIdsInSequenceOrder,
  parseOutreachName,
  buildEmailSequenceByStep,
  buildExistingSequencesSummary,
  DEFAULT_OUTREACH_BASE,
} from "@/lib/outreachNaming";
import { runComplianceCheck, getSpamWordsList, removeSpamWordsFromText } from "@/lib/compliance";
import { plainTextToHtml, looksLikeHtml, replacePlaceholdersWithSample, replacePlaceholdersWithValues } from "@/lib/templateBody";
import { IsolatedPreview } from "@/components/IsolatedPreview";
import { OutreachChatMessage, type OutreachMessage } from "@/components/ai-campaign-studio/OutreachChatMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Send,
  Loader2,
  Sparkles,
  Users,
  FileText,
  Megaphone,
  Trash2,
  Pencil,
  ExternalLink,
  Mail,
  Eye,
  MessageCircle,
  CircleDot,
  Clock,
  StickyNote,
  UserPlus,
  Route,
  Zap,
  X,
  Check,
  CheckCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Contact, ContactList, EmailTemplate, Inbox } from "@/types/api";
import type { Campaign } from "@/types/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

const FULL_TEMPLATE_PROMPT_PREFIX = `You are an expert email template generator. Generate a COMPLETE email template based on this request:

CRITICAL INSTRUCTIONS:
1. You MUST return a valid JSON object with exactly 3 fields: "name", "subject", and "body"
2. Do NOT return markdown code blocks, do NOT add any text before or after the JSON
3. The JSON must be valid and parseable
4. Use only the merge variables provided below (from the user's selected contact list); do not invent variables.
5. Use spintax for variation where it helps: {option1|option2|option3} picks one option at random per email. Example: {Hi|Hello|Hey} {{first_name}}, {hope you're well|just reaching out}.

PERSONALIZATION: Merge variables (e.g. {{first_name}}, {{company}}) are determined by the selected contact list. Use only the variables listed in the "ONLY use these merge variables" section below; they come from that list's contacts and custom fields.

BODY FORMAT: Use plain text with line breaks, or HTML for richer emails. When using HTML, use custom CSS via inline styles (e.g. style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.5") for compatibility across email clients. Avoid external stylesheets; prefer inline style attributes on elements like <p>, <div>, <a>, <strong>.

Required JSON format:
{
  "name": "A descriptive template name (e.g., 'Cold Outreach - Initial Contact')",
  "subject": "A single compelling email subject line (just one subject, not a list). Use allowed merge variables and spintax {Option A|Option B} for variation if relevant.",
  "body": "Complete email body (plain text with line breaks, or HTML with inline CSS styles). Use only the allowed merge variables from the contact list (see below). Use spintax {Hi|Hello|Hey} etc. for random variation per send. Only include an unsubscribe line if the COMPLIANCE section below requires it."
}

Return ONLY valid JSON (no markdown, no extra text) for this request: `;

import { getRandomFramework } from "@/lib/emailFrameworks";

const CONTACT_SAMPLE_SIZE = 50;

/** Build a flat map of placeholder key → string value from a contact (for preview). */
function contactToPreviewValues(contact: Contact): Record<string, string> {
  const cf = contact.custom_fields && typeof contact.custom_fields === "object" && !Array.isArray(contact.custom_fields)
    ? contact.custom_fields
    : {};
  const base: Record<string, string> = {
    first_name: contact.first_name ?? "",
    last_name: contact.last_name ?? "",
    email: contact.email ?? "",
    company: contact.company ?? "",
    industry: contact.industry ?? "",
    title: String((cf as Record<string, unknown>)?.title ?? ""),
  };
  const out = { ...base };
  for (const [k, v] of Object.entries(cf)) {
    if (v !== undefined && v !== null && k) out[k] = String(v);
  }
  return out;
}
const STANDARD_FIELDS = ["first_name", "last_name", "email", "company", "industry"] as const;

function hasNonEmpty(contact: Contact, key: string): boolean {
  if (STANDARD_FIELDS.includes(key as (typeof STANDARD_FIELDS)[number])) {
    const v = contact[key as keyof Contact];
    return v !== undefined && v !== null && String(v).trim() !== "";
  }
  const cf = contact.custom_fields;
  if (cf && typeof cf === "object" && !Array.isArray(cf) && key in cf) {
    const v = cf[key];
    return v !== undefined && v !== null && String(v).trim() !== "";
  }
  return false;
}

/** Collect merge variable names only when ALL contacts have non-empty content for that variable. */
function getCommonVariableNames(contacts: Contact[]): string[] {
  if (contacts.length === 0) return [];
  const candidateKeys = new Set<string>(STANDARD_FIELDS);
  for (const c of contacts) {
    const cf = c.custom_fields;
    if (cf && typeof cf === "object" && !Array.isArray(cf)) {
      for (const k of Object.keys(cf)) {
        candidateKeys.add(k);
      }
    }
  }
  const common: string[] = [];
  for (const key of candidateKeys) {
    if (contacts.every((c) => hasNonEmpty(c, key))) {
      common.push(key);
    }
  }
  return common.sort();
}

function buildVariableRestrictionPrompt(variableNames: string[]): string {
  if (variableNames.length === 0) return "";
  const placeholders = variableNames.map((v) => `{{${v}}}`).join(", ");
  return `\n\nCRITICAL - Variables from the selected contact list. ONLY use these merge variables in the template (no other {{variable}} placeholders): ${placeholders}.`;
}

type ComplianceForPrompt = {
  require_unsubscribe_link?: boolean;
  max_links_per_email?: number;
  max_images_per_email?: number;
  spam_words?: string;
} | undefined;

/** Build prompt instructions so the AI avoids spam words and respects link/image/unsubscribe limits. */
function buildCompliancePrompt(compliance: ComplianceForPrompt): string {
  if (!compliance) return "";
  const parts: string[] = [];
  const spamList = getSpamWordsList(compliance.spam_words);
  if (spamList.length > 0) {
    parts.push(`Do NOT use these words anywhere in the subject or body (they trigger spam filters): ${spamList.join(", ")}. Use synonyms or rephrase instead.`);
  }
  const maxLinks = compliance.max_links_per_email ?? 3;
  parts.push(`Use at most ${maxLinks} link(s) (URLs) in the entire email.`);
  const maxImages = compliance.max_images_per_email ?? 2;
  parts.push(`Use at most ${maxImages} image(s) in the entire email.`);
  if (compliance.require_unsubscribe_link !== false) {
    parts.push(
      "You MUST include an unsubscribe line in the body using the merge variable {{unsubscribe_url}} (replaced with the real link at send time), e.g. 'Unsubscribe: {{unsubscribe_url}}' or 'To stop receiving these emails, unsubscribe here: {{unsubscribe_url}}'. For HTML, use e.g. <a href=\"{{unsubscribe_url}}\">unsubscribe</a>."
    );
  }
  if (parts.length === 0) return "";
  return `\n\nCOMPLIANCE (you MUST follow these - the template will be rejected otherwise): ${parts.join(" ")}`;
}

function buildUpdateTemplatePrompt(subject: string, body: string, instruction: string, compliancePrompt?: string): string {
  const base = `You are an expert email template editor. The user wants to update an existing email template.

Your task: Read the FULL template below carefully (subject and body). Apply ONLY the changes the user asked for; preserve everything else—tone, structure, merge variables (e.g. {{first_name}}, {{company}}), formatting (HTML or plain), and any unsubscribe/compliance text. Do not rewrite or summarize unless the user explicitly asked for that.

Current template:
- Subject: ${subject}
- Body (HTML or plain): ${body}

User instruction: ${instruction}

Return ONLY a valid JSON object with exactly two keys: "subject" and "body". No markdown, no code block, no extra text. Update only what the instruction asks; leave the rest of the template intact. Keep the same style (HTML vs plain) unless the user asks to change it. Preserve all placeholders like {{first_name}}, {{company}}, and {{unsubscribe_url}}.

JSON format: {"subject": "...", "body": "..."}`;
  return compliancePrompt ? base + compliancePrompt : base;
}

/** Build full campaign context string from intent params (prompt + links + details) to feed to the template generator. */
function buildCampaignContext(params: Record<string, unknown>): string {
  const prompt = (params?.prompt as string)?.trim() || "";
  const links = (params?.links as string)?.trim();
  const details = (params?.details as string)?.trim();
  let out = prompt;
  if (links) out += "\n\nLinks to include where relevant: " + links;
  if (details) out += "\n\nAdditional details to weave in: " + details;
  return out || "cold outreach sequence";
}

/** Try to parse AI template JSON with multiple fallbacks (markdown strip, extract object, fix trailing commas). */
function parseTemplateJson(raw: string): { name?: string; subject?: string; body?: string } | null {
  let text = (raw ?? "").trim();
  if (!text) return null;
  if (text.includes("```json")) {
    const m = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (m) text = m[1].trim();
  } else if (text.includes("```")) {
    const m = text.match(/```\s*([\s\S]*?)\s*```/);
    if (m) text = m[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  try {
    const parsed = JSON.parse(text) as { name?: string; subject?: string; body?: string };
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    const fixed = text.replace(/,\s*([}\]])/g, "$1");
    try {
      const parsed = JSON.parse(fixed) as { name?: string; subject?: string; body?: string };
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

const DEFAULT_UNSUBSCRIBE =
  "\n\nIf you no longer wish to receive these emails, you can unsubscribe here: {{unsubscribe_url}}";

/** Returns a user-facing message if the template fails compliance; null if allOk. */
function getComplianceErrorMessage(
  check: ReturnType<typeof runComplianceCheck>
): string | null {
  if (check.allOk) return null;
  const parts: string[] = [];
  if (!check.linkOk) parts.push(`too many links (${check.linkCount}/${check.linkMax})`);
  if (!check.imageOk) parts.push(`too many images (${check.imageCount}/${check.imageMax})`);
  if (!check.spamOk) parts.push(`spam words: ${check.spamWordsFound.join(", ")}`);
  if (!check.unsubscribeOk) parts.push("missing unsubscribe link");
  return "This email doesn't pass your safety rules (Settings → Compliance): " + parts.join("; ") + ". Edit the email or change your rules and try again.";
}

/** Chat-safe compliance summary (no raw spam words). */
function getComplianceSummaryForChat(check: ReturnType<typeof runComplianceCheck>): string {
  if (check.allOk) return "";
  const parts: string[] = [];
  if (!check.linkOk) parts.push(`too many links (${check.linkCount}/${check.linkMax})`);
  if (!check.imageOk) parts.push(`too many images (${check.imageCount}/${check.imageMax})`);
  if (!check.spamOk) parts.push("contains words that trigger spam filters");
  if (!check.unsubscribeOk) parts.push("missing unsubscribe link");
  return parts.join("; ");
}

/** Short message when we can't fix compliance via LLM (don't expose raw spam words to user). */
function getComplianceFixFailedMessage(check?: ReturnType<typeof runComplianceCheck>): string {
  const base = "I couldn't fix this email automatically to match your safety rules.";
  if (check && !check.allOk) {
    const summary = getComplianceSummaryForChat(check);
    if (summary) return `${base} Issues: ${summary}. Edit it in Templates or adjust Settings → Compliance.`;
  }
  return `${base} You can edit it in the Templates section.`;
}

/** Build prompt for LLM to rewrite subject/body to fix compliance issues. */
function buildComplianceFixPrompt(
  subject: string,
  body: string,
  check: ReturnType<typeof runComplianceCheck>
): string {
  const rules: string[] = [];
  if (!check.spamOk) rules.push(`Remove or replace these words everywhere (they trigger spam filters): ${check.spamWordsFound.join(", ")}. If unsure, remove the word entirely. Do not leave any of these words in the output.`);
  if (!check.linkOk) rules.push(`Use at most ${check.linkMax} link(s) in the entire email (currently ${check.linkCount}). Remove or merge links to stay under the limit.`);
  if (!check.imageOk) rules.push(`Use at most ${check.imageMax} image(s) (currently ${check.imageCount}). Remove excess images.`);
  if (!check.unsubscribeOk) {
    rules.push(
      "Add an unsubscribe line using {{unsubscribe_url}} (e.g. plain text ending with {{unsubscribe_url}}, or HTML: <a href=\"{{unsubscribe_url}}\">unsubscribe</a>)."
    );
  }
  return `You are an email template editor. Fix the template so it meets compliance. Apply every rule below strictly.

Rules (apply all that apply): ${rules.join(" ")}

Current subject: ${subject}
Current body: ${body}

Return ONLY a valid JSON object with exactly two keys: "subject" and "body". No markdown, no code block, no other text. Preserve placeholders like {{first_name}}, {{unsubscribe_url}}.`;
}

/** Programmatic fallback: remove spam words and add unsubscribe. Does not fix link/image limits. */
function programmaticComplianceFix(
  subject: string,
  body: string,
  compliance: Parameters<typeof runComplianceCheck>[1]
): { subject: string; body: string } {
  const spamList = getSpamWordsList(compliance?.spam_words);
  const newSubject = removeSpamWordsFromText(subject, spamList) || subject;
  const newBody = removeSpamWordsFromText(body, spamList) || body;
  const requireUnsub = compliance?.require_unsubscribe_link !== false;
  const hasUnsub = runComplianceCheck(newSubject + "\n" + newBody, compliance).hasUnsubscribe;
  const finalBody = requireUnsub && !hasUnsub ? newBody.trimEnd() + DEFAULT_UNSUBSCRIBE : newBody;
  return { subject: newSubject, body: finalBody };
}

/** Ask LLM to fix template content for compliance; if that fails, try programmatic fix (remove spam words, add unsubscribe). Returns fixed { subject, body } or null. */
async function tryFixTemplateCompliance(
  subject: string,
  body: string,
  compliance: Parameters<typeof runComplianceCheck>[1],
  generateTemplate: { mutateAsync: (opts: { userId: string; provider: string; prompt: string }) => Promise<{ content?: string }> },
  userId: string,
  aiProvider: string
): Promise<{ subject: string; body: string } | null> {
  const check = runComplianceCheck(subject + "\n" + body, compliance);
  if (check.allOk) return { subject, body };

  const tryReturn = (s: string, b: string): { subject: string; body: string } | null => {
    const c = runComplianceCheck(s + "\n" + b, compliance);
    return c.allOk ? { subject: s, body: b } : null;
  };

  const prompt = buildComplianceFixPrompt(subject, body, check);
  try {
    const result = await generateTemplate.mutateAsync({ userId, provider: aiProvider, prompt });
    const content = (result?.content ?? "").trim();
    const parsed = parseTemplateJson(content);
    if (parsed && (parsed.subject || parsed.body)) {
      const newSubject = String(parsed.subject ?? subject).trim() || subject;
      const newBodyRaw = String(parsed.body ?? body).trim() || body;
      const newBody = looksLikeHtml(newBodyRaw) ? newBodyRaw : plainTextToHtml(newBodyRaw);
      const addUnsub = compliance?.require_unsubscribe_link !== false && !runComplianceCheck(newSubject + "\n" + newBody, compliance).hasUnsubscribe;
      const finalBody = addUnsub ? newBody.trimEnd() + DEFAULT_UNSUBSCRIBE : newBody;
      const llmFixed = tryReturn(newSubject, finalBody);
      if (llmFixed) return llmFixed;
    }
  } catch {
    // fall through to programmatic fix
  }

  const prog = programmaticComplianceFix(subject, body, compliance);
  return tryReturn(prog.subject, prog.body);
}

const DEFAULT_FOLLOW_UP_DELAY_DAYS = 2;
const DEFAULT_CAMPAIGN_DAILY_LIMIT = 500;

const BROWSER_TZ_TO_IANA: Record<string, string> = {
  "America/New_York": "America/New_York",
  "America/Chicago": "America/Chicago",
  "America/Denver": "America/Denver",
  "America/Los_Angeles": "America/Los_Angeles",
  "America/Phoenix": "America/Phoenix",
  "America/Detroit": "America/New_York",
  "America/Indiana/Indianapolis": "America/New_York",
  "America/Toronto": "America/Toronto",
  "America/Vancouver": "America/Vancouver",
  "America/Mexico_City": "America/Mexico_City",
  "America/Sao_Paulo": "America/Sao_Paulo",
  "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver",
  "US/Pacific": "America/Los_Angeles",
  "Europe/London": "Europe/London",
  "Europe/Paris": "Europe/Paris",
  "Europe/Berlin": "Europe/Berlin",
  "Europe/Amsterdam": "Europe/Amsterdam",
  "Europe/Madrid": "Europe/Madrid",
  "Europe/Rome": "Europe/Rome",
  "Europe/Moscow": "Europe/Moscow",
  "Asia/Kolkata": "Asia/Kolkata",
  "Asia/Tokyo": "Asia/Tokyo",
  "Asia/Shanghai": "Asia/Shanghai",
  "Asia/Hong_Kong": "Asia/Hong_Kong",
  "Asia/Singapore": "Asia/Singapore",
  "Asia/Dubai": "Asia/Dubai",
  "Australia/Sydney": "Australia/Sydney",
  "Australia/Melbourne": "Australia/Melbourne",
  "Pacific/Auckland": "Pacific/Auckland",
};

function getDefaultCampaignTimezone(): string {
  if (typeof Intl === "undefined" || !Intl.DateTimeFormat) return "America/New_York";
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return BROWSER_TZ_TO_IANA[browserTz] ?? browserTz ?? "America/New_York";
}

/** Start now: start time = current time in tz, end time = +12h. Same as campaign new "Start now". */
function getStartNowScheduleInTimezone(tz: string): { startTime: string; endTime: string } {
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

const DEFAULT_GREETING =
  "Welcome to AI Campaign Studio. First, pick which contact list you want to use for this campaign. After that I'll ask for campaign details, how many emails you want in the sequence, how many variations to test, then I'll generate the templates, let you update them, help you pick inboxes, and finally create the campaign.";
const GET_STARTED_USER_MESSAGE = "I'd like to create an email campaign";

interface TabState {
  id: string;
  title: string;
  messages: OutreachMessage[];
  selectedListId: string | null;
  selectedInboxIds: string[];
  createdTemplateIds: string[];
  baseName: string;
  startedCampaignIds: string[];
  /** Template ID the user tagged for update (e.g. "update this one" in next message). */
  taggedForUpdateTemplateId: string | null;
  /** Campaign created for this sequence (one per chat); do not create duplicate. */
  createdCampaignId?: string;
  /** Last executed action (for intent context: preview/inbox suggestions). */
  lastAction?: string;
  /** After list selected: topic → steps → variants → name_confirm → format → create */
  pendingSequenceAsk?: "steps" | "variants" | "topic" | "name_confirm" | "format";
  pendingSequenceConfig?: {
    steps: number;
    variants: number;
    /** When true, only the first/initial email gets A/B variants; follow-ups get one version each. */
    variantsFirstStepOnly?: boolean;
    topic?: string;
    suggestedName?: string;
    /** Email body format selected by the user. */
    bodyType?: "html" | "plain" | "rich";
  };
  /** Stored params from create_sequence to resume after format selection. */
  pendingSequenceParams?: Record<string, unknown>;
}

const INITIAL_TAB: TabState = {
  id: "",
  title: "Outreach 1",
  messages: [],
  selectedListId: null,
  selectedInboxIds: [],
  createdTemplateIds: [],
  baseName: DEFAULT_OUTREACH_BASE,
  startedCampaignIds: [],
  taggedForUpdateTemplateId: null,
};

/** Parse "3", "3 2", "3 steps 2 variants" etc. into { steps, variants }. Default variants 1. */
function parseStepsAndVariants(text: string): { steps: number; variants: number } | null {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  const numbers = normalized.match(/\d+/g);
  if (!numbers || numbers.length === 0) return null;
  const steps = Math.min(10, Math.max(1, parseInt(numbers[0], 10)));
  const variants =
    numbers.length >= 2 ? Math.min(5, Math.max(1, parseInt(numbers[1], 10))) : 1;
  return { steps, variants };
}

/** Suggest a sequence name from topic (e.g. "cold outreach for my SaaS" → "Cold outreach for my SaaS") or return default. */
function suggestSequenceName(topic: string, fallback: string): string {
  const t = topic.trim();
  if (!t) return fallback;
  const maxLen = 40;
  const trimmed = t.length > maxLen ? t.slice(0, maxLen).trim() : t;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Parse LLM JSON response for name-confirm interpretation: { confirmed: boolean, sequence_name: string }. */
function parseNameConfirmResponse(content: string, suggestedName: string): { confirmed: boolean; sequence_name: string } {
  const raw = (content ?? "").trim();
  let text = raw;
  if (text.includes("```json")) {
    const m = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (m) text = m[1].trim();
  } else if (text.includes("```")) {
    const m = text.match(/```\s*([\s\S]*?)\s*```/);
    if (m) text = m[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(text) as { confirmed?: boolean; sequence_name?: string };
    const confirmed = parsed?.confirmed === true;
    const name = typeof parsed?.sequence_name === "string" ? parsed.sequence_name.trim() : "";
    return {
      confirmed,
      sequence_name: name || (confirmed ? suggestedName : ""),
    };
  } catch {
    return { confirmed: false, sequence_name: "" };
  }
}

/** Parse AI response for sequence name: first line, strip URLs, trim to 40 chars. */
function parseSuggestedNameFromAI(content: string, fallback: string): string {
  const raw = (content ?? "").trim();
  if (!raw) return fallback;
  const firstLine = raw.split(/\r?\n/)[0].trim();
  const withoutUrls = firstLine.replace(/https?:\/\/[^\s]+/gi, "").trim();
  const cleaned = (withoutUrls || firstLine).replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  const maxLen = 40;
  const name = cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() : cleaned;
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : fallback;
}

/** Map API message to UI OutreachMessage (payload holds template_card, list_card, etc.). */
function messageFromApi(m: { id: string; role: string; content: string; payload?: Record<string, unknown> | null }): OutreachMessage {
  const payload = m.payload ?? {};
  return {
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content ?? "",
    templateCard: payload.templateCard as EmailTemplate | undefined,
    templateCards: payload.templateCards as EmailTemplate[] | undefined,
    listCard: payload.listCard as { lists: ContactList[] } | undefined,
    inboxCard: payload.inboxCard as { inboxes: Inbox[] } | undefined,
    campaignCreated: payload.campaignCreated as { campaignId: string; campaignName: string; started?: boolean } | undefined,
    previewOrInboxChoice: payload.previewOrInboxChoice as boolean | undefined,
    previewCampaignId: payload.previewCampaignId as string | undefined,
    showCreateCampaignButton: payload.showCreateCampaignButton as boolean | undefined,
    formatCard: payload.formatCard as boolean | undefined,
    generationJobId: payload.generationJobId as string | undefined,
  };
}

/** Build payload object for API from OutreachMessage. */
function payloadFromMessage(msg: Omit<OutreachMessage, "id">): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};
  if (msg.templateCard) payload.templateCard = msg.templateCard;
  if (msg.templateCards) payload.templateCards = msg.templateCards;
  if (msg.listCard) payload.listCard = msg.listCard;
  if (msg.inboxCard) payload.inboxCard = msg.inboxCard;
  if (msg.campaignCreated) payload.campaignCreated = msg.campaignCreated;
  if (msg.previewOrInboxChoice) payload.previewOrInboxChoice = true;
  if (msg.previewCampaignId) payload.previewCampaignId = msg.previewCampaignId;
  if (msg.showCreateCampaignButton) payload.showCreateCampaignButton = true;
  if (msg.formatCard) payload.formatCard = true;
  if (msg.generationJobId) payload.generationJobId = msg.generationJobId;
  return Object.keys(payload).length ? payload : undefined;
}

export default function OutreachPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generationEventSourceRef = useRef<EventSource | null>(null);
  const activeGenerationJobIdRef = useRef<string | null>(null);
  const [chatList, setChatList] = useState<Array<{ id: string; title: string }>>([]);
  const [activeChatId, setActiveChatId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabState | null>(null);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [chatsLoadError, setChatsLoadError] = useState(false);
  const [activeChatLoading, setActiveChatLoading] = useState(false);
  const [activeChatLoadError, setActiveChatLoadError] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [aiProvider, setAiProvider] = useState("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [renameError, setRenameError] = useState("");

  const queryClient = useQueryClient();
  const hasSelectedList = !!activeTab?.selectedListId;
  const { data: templates = [] } = useTemplates(userId);
  const { data: contactLists = [] } = useContactLists(userId);
  const { data: llmConfigs = [] } = useLLMConfigs(userId);
  const { data: inboxes = [] } = useInboxes(userId, hasSelectedList);
  const { data: domains = [] } = useDomains(hasSelectedList);
  const { data: settings } = useSettings();
  const generateTemplate = useGenerateTemplate();
  const createTemplate = useCreateTemplate();
  const updateTemplateMutation = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const deleteTemplates = useDeleteTemplates();
  const createCampaign = useCreateCampaign();
  const startCampaign = useStartCampaign();
  const campaignGate = usePlanGate("campaigns");
  const [isIntentLoading, setIsIntentLoading] = useState(false);
  const [startAfterCreate, setStartAfterCreate] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTabTitle, setRenameTabTitle] = useState("");
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);
  const [quickEditTemplate, setQuickEditTemplate] = useState<EmailTemplate | null>(null);
  const [quickEditSubject, setQuickEditSubject] = useState("");
  const [quickEditBody, setQuickEditBody] = useState("");
  const [isSavingQuickEdit, setIsSavingQuickEdit] = useState(false);
  const [previewContact, setPreviewContact] = useState<Contact | null>(null);
  const [deleteChatLoading, setDeleteChatLoading] = useState(false);
  const confirmDialog = useConfirmDialog();
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("ai-campaign-studio-onboarding-dismissed") === "1";
  });
  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true);
    if (typeof window !== "undefined") localStorage.setItem("ai-campaign-studio-onboarding-dismissed", "1");
  }, []);

  const openQuickEdit = useCallback((template: EmailTemplate) => {
    setQuickEditTemplate(template);
    setQuickEditSubject(template.subject ?? "");
    setQuickEditBody(template.body ?? "");
  }, []);

  const closeQuickEdit = useCallback(() => {
    setQuickEditTemplate(null);
    setQuickEditSubject("");
    setQuickEditBody("");
    setIsSavingQuickEdit(false);
  }, []);

  const handleSaveQuickEdit = useCallback(async () => {
    if (!quickEditTemplate) return;
    const subject = quickEditSubject.trim();
    const bodyRaw = quickEditBody.trim();
    if (!subject) {
      toast.error("Subject is required.");
      return;
    }
    if (!bodyRaw) {
      toast.error("Body is required.");
      return;
    }

    const nextBody = quickEditTemplate.body_type === "plain" ? bodyRaw : (looksLikeHtml(bodyRaw) ? bodyRaw : plainTextToHtml(bodyRaw));
    const updatedAt = new Date().toISOString();
    setIsSavingQuickEdit(true);
    try {
      await updateTemplateMutation.mutateAsync({
        templateId: quickEditTemplate.id,
        data: { ...quickEditTemplate, subject, body: nextBody, updated_at: updatedAt },
      });
      toast.success("Template updated.");
      setPreviewTemplate((prev) => (prev?.id === quickEditTemplate.id ? { ...prev, subject, body: nextBody, updated_at: updatedAt } : prev));
      closeQuickEdit();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update template.");
    } finally {
      setIsSavingQuickEdit(false);
    }
  }, [
    quickEditTemplate,
    quickEditSubject,
    quickEditBody,
    updateTemplateMutation,
    closeQuickEdit,
  ]);

  /** Draft body normalized the same way as save, for live preview in quick-edit modal */
  const quickEditDraftBodyForPreview = useMemo(() => {
    if (!quickEditTemplate) return "";
    if (quickEditTemplate.body_type === "plain") return quickEditBody;
    return looksLikeHtml(quickEditBody) ? quickEditBody : plainTextToHtml(quickEditBody);
  }, [quickEditTemplate, quickEditBody]);

  const compliance = settings?.compliance as
    | { require_unsubscribe_link?: boolean; max_links_per_email?: number; max_images_per_email?: number; spam_words?: string }
    | undefined;

  useEffect(() => {
    if (llmConfigs.length === 0) return;
    if (!aiProvider) {
      setAiProvider(llmConfigs[0].provider);
    } else if (!llmConfigs.some((c) => c.provider === aiProvider)) {
      setAiProvider(llmConfigs[0].provider);
    }
  }, [llmConfigs, aiProvider]);

  // Load a random contact in the background when this tab has a selected list (used when preview opens)
  useEffect(() => {
    const listId = activeTab?.selectedListId;
    if (!listId) {
      setPreviewContact(null);
      return;
    }
    let cancelled = false;
    api.contactLists
      .getContacts(listId, 0, 200)
      .then(({ contacts }) => {
        if (cancelled || !contacts.length) {
          if (!cancelled) setPreviewContact(null);
          return;
        }
        const random = contacts[Math.floor(Math.random() * contacts.length)];
        if (!cancelled) setPreviewContact(random);
      })
      .catch(() => {
        if (!cancelled) setPreviewContact(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab?.selectedListId]);

  // Load chat list on mount (when user is available)
  const loadChatList = useCallback(() => {
    if (!userId) return;
    setChatsLoadError(false);
    setChatsLoading(true);
    api.outreach
      .listChats()
      .then((list) => {
        setChatList(list.map((c) => ({ id: c.id, title: c.title })));
        if (list.length > 0) setActiveChatId((prev) => prev || list[0].id);
        else if (list.length === 0) {
          return api.outreach.createChat("Outreach 1").then((chat) => {
            setChatList([{ id: chat.id, title: chat.title }]);
            setActiveChatId(chat.id);
          });
        }
      })
      .catch(() => {
        setChatList([]);
        setActiveChatId("");
        setChatsLoadError(true);
        toast.error("Couldn't load conversations. Click \"New conversation\" to start fresh.");
      })
      .finally(() => setChatsLoading(false));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadChatList();
  }, [userId, loadChatList]);

  // Load active chat when activeChatId changes
  const loadActiveChat = useCallback((chatId: string) => {
    if (!chatId || !userId) {
      setActiveTab(null);
      setActiveChatLoadError(false);
      return;
    }
    setActiveChatLoadError(false);
    setActiveChatLoading(true);
    api.outreach
      .getChat(chatId)
      .then((chat) => {
        const meta = (chat.meta ?? {}) as Record<string, unknown>;
        const tab: TabState = {
          id: chat.id,
          title: chat.title,
          messages: (chat.messages ?? []).map(messageFromApi),
          selectedListId: (meta.selected_list_id as string) ?? null,
          selectedInboxIds: (meta.selected_inbox_ids as string[]) ?? [],
          createdTemplateIds: (meta.created_template_ids as string[]) ?? [],
          baseName: (meta.base_name as string) ?? DEFAULT_OUTREACH_BASE,
          startedCampaignIds: (meta.started_campaign_ids as string[]) ?? [],
          taggedForUpdateTemplateId: (meta.tagged_for_update_template_id as string) ?? null,
          createdCampaignId: (meta.created_campaign_id as string) ?? undefined,
        };
        setActiveTab(tab);
      })
      .catch(() => {
        setActiveTab(null);
        setActiveChatLoadError(true);
        toast.error("Couldn't load this conversation. Try again or switch to another tab.");
      })
      .finally(() => setActiveChatLoading(false));
  }, [userId]);

  useEffect(() => {
    if (!activeChatId || !userId) {
      setActiveTab(null);
      setActiveChatLoadError(false);
      return;
    }
    loadActiveChat(activeChatId);
  }, [activeChatId, userId, loadActiveChat]);

  const setActiveTabState = useCallback(
    (updater: (prev: TabState) => TabState) => {
      setActiveTab((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        if (activeChatId && next !== prev) {
          const meta = {
            selected_list_id: next.selectedListId ?? null,
            selected_inbox_ids: next.selectedInboxIds ?? [],
            created_template_ids: next.createdTemplateIds ?? [],
            base_name: next.baseName ?? DEFAULT_OUTREACH_BASE,
            started_campaign_ids: next.startedCampaignIds ?? [],
            tagged_for_update_template_id: next.taggedForUpdateTemplateId ?? null,
            created_campaign_id: next.createdCampaignId ?? null,
          };
          api.outreach.updateChat(activeChatId, { meta }).catch(() => {
            toast.error("Couldn't save your selections. Try again or refresh.");
          });
        }
        return next;
      });
    },
    [activeChatId]
  );

  const addMessage = useCallback(
    (msg: Omit<OutreachMessage, "id">) => {
      const tempId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setActiveTab((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: [...prev.messages, { ...msg, id: tempId }],
        };
      });
      if (activeChatId) {
        api.outreach
          .addMessage(activeChatId, {
            role: msg.role,
            content: msg.content,
            payload: payloadFromMessage(msg),
          })
          .then((saved) => {
            setActiveTab((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                messages: prev.messages.map((m) => (m.id === tempId ? messageFromApi({ ...saved, payload: saved.payload ?? undefined }) : m)),
              };
            });
          })
          .catch(() => {
            toast.error("Message couldn't be saved. It may disappear after refresh.");
          });
      }
    },
    [activeChatId]
  );

  const startGenerationStream = useCallback(
    (jobId: string) => {
      if (!jobId) return;
      if (activeGenerationJobIdRef.current === jobId && generationEventSourceRef.current) return;

      if (generationEventSourceRef.current) {
        generationEventSourceRef.current.close();
        generationEventSourceRef.current = null;
      }

      const es = new EventSource(
        `${API_BASE_URL}/outreach/generation/${encodeURIComponent(jobId)}/stream`,
        { withCredentials: true }
      );
      generationEventSourceRef.current = es;
      activeGenerationJobIdRef.current = jobId;

      es.addEventListener("step_completed", (evt) => {
        try {
          const data = JSON.parse((evt as MessageEvent<string>).data) as {
            step?: number;
            created_count?: number;
            total_templates?: number;
            templates?: EmailTemplate[];
          };
          const cards = Array.isArray(data.templates) ? data.templates : [];
          addMessage({
            role: "assistant",
            content: `Generated step ${data.step ?? "?"} (${data.created_count ?? 0}/${data.total_templates ?? 0}).`,
            ...(cards.length > 0 ? { templateCards: cards } : {}),
          });
        } catch {
          // ignore malformed event
        }
      });

      es.addEventListener("template_updated", (evt) => {
        try {
          const data = JSON.parse((evt as MessageEvent<string>).data) as {
            updated_count?: number;
            total_templates?: number;
            template?: EmailTemplate;
          };
          const card = data.template;
          addMessage({
            role: "assistant",
            content: `Updated ${data.updated_count ?? 0}/${data.total_templates ?? 0} template(s).`,
            ...(card ? { templateCards: [card] } : {}),
          });
        } catch {
          // ignore malformed event
        }
      });

      es.addEventListener("done", (evt) => {
        try {
          const data = JSON.parse((evt as MessageEvent<string>).data) as {
            mode?: "create" | "update";
            created_template_ids?: string[];
            templates_created?: EmailTemplate[];
            updated_template_ids?: string[];
            templates_updated?: EmailTemplate[];
          };
          if (data.mode === "update") {
            const updatedTemplates = Array.isArray(data.templates_updated) ? data.templates_updated : [];
            void queryClient.invalidateQueries({ queryKey: ["templates", userId] });
            addMessage({
              role: "assistant",
              content:
                updatedTemplates.length > 0
                  ? `Done. Updated **${updatedTemplates.length}** template(s). Do you have any other edits, or proceed to inbox?`
                  : "Done. Template updates finished.",
              ...(updatedTemplates.length > 0
                ? { templateCards: updatedTemplates.slice(0, 12), previewOrInboxChoice: true }
                : {}),
            });
          } else {
            const createdIds = Array.isArray(data.created_template_ids) ? data.created_template_ids : [];
            const allTemplates = Array.isArray(data.templates_created) ? data.templates_created : [];
            if (createdIds.length > 0) {
              setActiveTabState((tab) =>
                tab
                  ? {
                      ...tab,
                      createdTemplateIds: [...tab.createdTemplateIds, ...createdIds.filter((id) => !tab.createdTemplateIds.includes(id))],
                    }
                  : tab
              );
            }
            void queryClient.invalidateQueries({ queryKey: ["templates", userId] });
            addMessage({
              role: "assistant",
              content:
                allTemplates.length > 0
                  ? `Done. Created **${allTemplates.length}** template(s). Would you like to preview them or proceed to inbox selection?`
                  : "Done. Template generation finished.",
              ...(allTemplates.length > 0
                ? { templateCards: allTemplates.slice(0, 12), previewOrInboxChoice: true }
                : {}),
            });
          }
        } finally {
          es.close();
          generationEventSourceRef.current = null;
          activeGenerationJobIdRef.current = null;
        }
      });

      es.addEventListener("failed", (evt) => {
        try {
          const data = JSON.parse((evt as MessageEvent<string>).data) as { message?: string; step?: number; mode?: "create" | "update" };
          const noun = data?.mode === "update" ? "update" : "generation";
          addMessage({
            role: "assistant",
            content: data?.message
              ? `Template ${noun} stopped at step ${data.step ?? "?"}: ${data.message}`
              : `Template ${noun} stopped due to an error.`,
          });
        } catch {
          addMessage({
            role: "assistant",
            content: "Template processing stopped due to a stream error.",
          });
        } finally {
          es.close();
          generationEventSourceRef.current = null;
          activeGenerationJobIdRef.current = null;
        }
      });

      es.onerror = () => {
        // Keep handler minimal; explicit error events above carry details.
      };
    },
    [addMessage, queryClient, setActiveTabState, userId]
  );

  useEffect(() => {
    return () => {
      if (generationEventSourceRef.current) {
        generationEventSourceRef.current.close();
      }
      generationEventSourceRef.current = null;
      activeGenerationJobIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (generationEventSourceRef.current) {
      generationEventSourceRef.current.close();
      generationEventSourceRef.current = null;
      activeGenerationJobIdRef.current = null;
    }
  }, [activeChatId]);

  /** Append messages from act response to local state only (they are already persisted by backend).
   * We intentionally drop user-role messages here, because the frontend shows the user's
   * message optimistically as soon as they hit Send. The backend still stores it for history.
   */
  const appendMessagesFromAct = useCallback(
    (messages: Array<{ id?: string; role: string; content: string; payload?: Record<string, unknown> | null }>) => {
      if (!messages.length) return;
      const generationJobId =
        messages
          .map((m) => (m.payload as Record<string, unknown> | undefined)?.generationJobId)
          .find((x) => typeof x === "string" && x.length > 0) ?? null;
      setActiveTab((prev) => {
        if (!prev) return prev;
        const assistantOrOther = messages.filter((m) => m.role !== "user");
        if (!assistantOrOther.length) return prev;
        const newOnes = assistantOrOther.map((m) =>
          messageFromApi({
            ...m,
            id: m.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          })
        );
        return { ...prev, messages: [...prev.messages, ...newOnes] };
      });
      if (typeof generationJobId === "string" && generationJobId) {
        startGenerationStream(generationJobId);
      }
    },
    [startGenerationStream]
  );

  const handleSelectList = useCallback(
    async (listId: string) => {
      const list = contactLists.find((l) => l.id === listId);
      setActiveTabState((tab) => ({ ...tab, selectedListId: listId }));
      if (!activeChatId || !aiProvider || !userId) {
        addMessage({ role: "user", content: `I selected the list: ${list?.name ?? listId}` });
        addMessage({
          role: "assistant",
          content: list ? `Using list: **${list.name}**. Pick an AI provider to continue creating emails.` : "List selected.",
        });
        // toast.success("List selected");
        return;
      }
      setIsIntentLoading(true);
      try {
        const res = await api.outreach.act(activeChatId, {
          message: "I selected the list",
          role: "user",
          ai_provider: aiProvider,
          ui_hints: { list_id: listId },
        });
        if (res?.messages?.length) {
          appendMessagesFromAct(res.messages);
        }
        if (res?.state?.selected_list_id) {
          setActiveTabState((tab) => (tab ? { ...tab, selectedListId: res.state.selected_list_id as string } : tab));
        }
      } catch (e) {
        addMessage({
          role: "assistant",
          content: list ? `Using list: **${list.name}**. Something went wrong—try again.` : "List selected.",
        });
        toast.error(e instanceof Error ? e.message : "Failed");
      } finally {
        setIsIntentLoading(false);
      }
      // toast.success("List selected");
    },
    [contactLists, setActiveTabState, addMessage, appendMessagesFromAct, activeChatId, aiProvider, userId]
  );

  const handleSelectInbox = useCallback(
    (inboxIds: string[]) => {
      setActiveTabState((tab) => ({ ...tab, selectedInboxIds: inboxIds }));
    },
    [setActiveTabState]
  );

  const handleConfirmInboxSelection = useCallback(
    async (inboxIds: string[]) => {
      setActiveTabState((tab) => ({ ...tab, selectedInboxIds: inboxIds }));
      if (activeChatId && aiProvider && inboxIds.length > 0) {
        try {
          const res = await api.outreach.act(activeChatId, {
            message: "I selected the inbox",
            role: "user",
            ai_provider: aiProvider,
            ui_hints: { inbox_ids: inboxIds },
          });
          if (res?.messages?.length) {
            appendMessagesFromAct(res.messages);
          }
          if (res?.state?.selected_inbox_ids) {
            setActiveTabState((tab) =>
              tab ? { ...tab, selectedInboxIds: res.state.selected_inbox_ids as string[] } : tab
            );
          }
          const hasSelectedInboxes = Array.isArray(res?.state?.selected_inbox_ids) && res.state!.selected_inbox_ids.length > 0;
          const hasCreatedCampaign = Boolean(res?.state && (res.state as any).created_campaign_id);
          if (hasSelectedInboxes && !hasCreatedCampaign) {
            addMessage({
              role: "assistant",
              content: "Inboxes selected. Confirm to **create this campaign** now, or continue editing your emails.",
              showCreateCampaignButton: true,
            });
          }
        } catch {
          addMessage({
            role: "assistant",
            content: "Inboxes selected. Confirm to **create this campaign** now, or continue editing your emails.",
            showCreateCampaignButton: true,
          });
        }
      } else {
        addMessage({
          role: "assistant",
          content: "Inboxes selected. Confirm to **create this campaign** now, or continue editing your emails.",
          showCreateCampaignButton: true,
        });
      }
      toast.success("Inbox(es) selected");
    },
    [setActiveTabState, addMessage, appendMessagesFromAct, activeChatId, aiProvider]
  );

  const createTemplateFromPrompt = useCallback(
    async (prompt: string, action: "new_sequence" | "new_version", forSequence?: number, listId?: string) => {
      if (!aiProvider || !userId) {
        toast.error("Select an AI provider and ensure you're logged in.");
        return;
      }
      let variableRestriction = "";
      if (listId) {
        try {
          const { contacts } = await api.contactLists.getContacts(listId, 0, CONTACT_SAMPLE_SIZE);
          variableRestriction = buildVariableRestrictionPrompt(getCommonVariableNames(contacts));
        } catch {
          toast.warning("Contact list couldn't be loaded; emails may use placeholders not in your list.");
        }
      }
      const fullPrompt =
        FULL_TEMPLATE_PROMPT_PREFIX + getRandomFramework() + variableRestriction + buildCompliancePrompt(compliance) + (prompt || "cold outreach initial email");
      let result: { content: string };
      try {
        result = await generateTemplate.mutateAsync({
          userId,
          provider: aiProvider,
          prompt: fullPrompt,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to create email");
        return;
      }
      const content = (result?.content ?? "").trim();
      const parsed = parseTemplateJson(content);
      if (!parsed) {
        toast.error("AI response was not valid JSON. Try again or add more detail about what the email should say.");
        return;
      }
      const subject = String(parsed.subject ?? "").trim() || "No subject";
      const bodyRaw = String(parsed.body ?? "").trim();
      let body = looksLikeHtml(bodyRaw) ? bodyRaw : plainTextToHtml(bodyRaw);
      const check = runComplianceCheck(subject + "\n" + body, compliance);
      if (!check.unsubscribeOk && compliance?.require_unsubscribe_link !== false) {
        body = body.trimEnd() + DEFAULT_UNSUBSCRIBE;
      }
      let finalSubject = subject;
      let finalBody = body;
      let finalCheck = runComplianceCheck(subject + "\n" + body, compliance);
      if (!finalCheck.allOk) {
        const fixed = await tryFixTemplateCompliance(subject, body, compliance, generateTemplate, userId, aiProvider);
        if (fixed) {
          finalSubject = fixed.subject;
          finalBody = fixed.body;
          finalCheck = runComplianceCheck(finalSubject + "\n" + finalBody, compliance);
        }
        if (!finalCheck.allOk) {
          toast.error("Email doesn't meet compliance rules");
          addMessage({ role: "assistant", content: getComplianceFixFailedMessage(finalCheck) });
          return;
        }
      }
      const baseName = activeTab?.baseName ?? DEFAULT_OUTREACH_BASE;
      const nextName = getNextTemplateName(templates, {
        base: baseName,
        action,
        forSequence,
      });
      let sequenceNumber: number;
      if (action === "new_version" && forSequence != null) {
        const existing = getSequenceNumberForStep(templates, baseName, forSequence);
        sequenceNumber = existing ?? getNextSequenceNumber(templates);
      } else {
        sequenceNumber = getNextSequenceNumber(templates);
      }
      const id = crypto.randomUUID();
      const templateData: EmailTemplate = {
        id,
        user_id: userId,
        name: nextName,
        subject: finalSubject,
        body: finalBody,
        body_type: "rich",
        sequence_number: sequenceNumber,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      try {
        await createTemplate.mutateAsync(templateData);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to create email");
        return;
      }
      setActiveTabState((tab) => ({
        ...tab,
        createdTemplateIds: [...tab.createdTemplateIds, id],
      }));
      let replyText = `Created email **${nextName}**. Would you like to **preview** or **proceed to select sending inbox**?`;
      try {
        const replyRes = await api.outreach.generatePostTemplateReply({
          user_id: userId,
          provider: aiProvider,
          created_names: [nextName],
          count: 1,
        });
        if (replyRes?.reply?.trim()) replyText = replyRes.reply.trim();
      } catch {
        // use fallback above
      }
      addMessage({
        role: "assistant",
        content: replyText,
        templateCard: { ...templateData, id },
        previewOrInboxChoice: true,
      });
    },
    [
      aiProvider,
      userId,
      generateTemplate,
      activeTab?.baseName,
      templates,
      compliance,
      createTemplate,
      setActiveTabState,
      addMessage,
    ]
  );

  const runOneStep = useCallback(
    async (tool: string, args: Record<string, unknown>, replyText?: string) => {
      const params = args ?? {};
      const reply = (params?.reply as string) ?? replyText ?? (params?._reply as string);

      // Once a campaign is created for this chat, restrict further actions to template updates only.
      if (activeTab?.createdCampaignId) {
        const allowedToolsAfterCampaign = new Set([
          "show_preview",
          "update_template",
          "show_existing_campaign",
        ]);

        if (!allowedToolsAfterCampaign.has(tool)) {
          const content =
            reply ??
            "This chat already has a campaign created. Here you can only update the existing email templates (subjects and bodies). Ask me to tweak the copy of these emails, or edit them directly from the Templates panel on the right.";
          addMessage({ role: "assistant", content });
          return;
        }
      }

      if (tool === "reply_only") {
        // This tool is deprecated; ignore it to avoid redundant generic replies.
        return;
      }
      if (tool === "ask_topic") {
        const content =
          reply ??
          "What should these emails be about? For example: cold outreach for my product, product launch, or re-engaging old leads. Describe your campaign in a few words and I'll write the emails.";
        addMessage({ role: "assistant", content });
        setActiveTabState((tab) =>
          tab
            ? {
                ...tab,
                pendingSequenceAsk: "topic",
                pendingSequenceConfig: tab.pendingSequenceConfig ?? {
                  steps: 1,
                  variants: 1,
                },
              }
            : tab
        );
        return;
      }
      if (tool === "ask_steps") {
        const content =
          reply ??
          "**How many emails in the sequence?** (e.g. 1 = one email only, 2 = one first email + one follow-up, 3 = one + two follow-ups, and so on). Reply with a number: 1, 2, 3, 4, 5, etc.";
        addMessage({ role: "assistant", content });
        setActiveTabState((tab) =>
          tab
            ? {
                ...tab,
                pendingSequenceAsk: "steps",
                pendingSequenceConfig: tab.pendingSequenceConfig ?? {
                  steps: 1,
                  variants: 1,
                },
              }
            : tab
        );
        return;
      }
      if (tool === "ask_variants") {
        const content =
          reply ??
          "**How many A/B test variations per email?** (1 = one version per email, 2 = A/B test two versions, etc.). You can say **2 for starting only** to A/B test just the first email. Reply with a number: 1, 2, 3, etc.";
        addMessage({ role: "assistant", content });
        setActiveTabState((tab) =>
          tab
            ? {
                ...tab,
                pendingSequenceAsk: "variants",
                pendingSequenceConfig: tab.pendingSequenceConfig ?? {
                  steps: 1,
                  variants: 1,
                },
              }
            : tab
        );
        return;
      }
      if (tool === "ask_name_confirm") {
        const topicFromArgs = (args?.topic as string) ?? "";
        const stepsCount = Math.min(10, Math.max(1, Number(args?.steps) || 1));
        const variantsPerStep = Math.min(5, Math.max(1, Number(args?.variants) ?? 1));
        const variantsFirstStepOnly = args?.variants_first_step_only === true;

        // Start from any suggested name we already have, otherwise from base name.
        let suggestedName =
          (args?.suggested_name as string | undefined)?.trim() ||
          activeTab?.pendingSequenceConfig?.suggestedName ||
          activeTab?.baseName ||
          DEFAULT_OUTREACH_BASE;

        // If we have a topic and AI provider, let the LLM propose a short sequence name.
        if (!args?.suggested_name && topicFromArgs && aiProvider && userId) {
          try {
            const namePrompt = `You are a naming assistant. Suggest a short sequence name (2-5 words) for an email campaign. Do not include URLs. Do not use quotes. Reply with ONLY the sequence name, nothing else.

Campaign topic: ${topicFromArgs}`;
            const result = await generateTemplate.mutateAsync({
              userId,
              provider: aiProvider,
              prompt: namePrompt,
            });
            const content = (result?.content ?? "").trim();
            suggestedName = parseSuggestedNameFromAI(content, suggestedName);
          } catch {
            // fall back to existing suggestedName
          }
        }

        const topic = topicFromArgs || activeTab?.pendingSequenceConfig?.topic || "";

        setActiveTabState((tab) => ({
          ...tab,
          pendingSequenceAsk: "name_confirm",
          pendingSequenceConfig: {
            steps: stepsCount,
            variants: variantsPerStep,
            variantsFirstStepOnly,
            topic,
            suggestedName,
          },
        }));

        if (reply) {
          addMessage({ role: "assistant", content: reply });
        } else {
          addMessage({
            role: "assistant",
            content: `I'll call this sequence **${suggestedName}**. Reply "yes" to keep it, or type a different name.`,
          });
        }
        return;
      }
      if (tool === "show_list_picker") {
        addMessage({
          role: "assistant",
          content: reply || "Pick which contact list to use for this campaign:",
          listCard: { lists: contactLists },
        });
        return;
      }
      if (tool === "select_list") {
        const listId = params?.list_id as string | undefined;
        if (listId) {
          const list = contactLists.find((l) => l.id === listId);
          setActiveTabState((tab) => ({ ...tab, selectedListId: listId }));
          addMessage({
            role: "assistant",
            content: list ? `Using list: **${list.name}**` : "List selected.",
          });
        } else {
          addMessage({ role: "assistant", content: reply || "Pick a list from the options above." });
        }
        return;
      }
      if (tool === "ask_preview_or_inbox") {
        const templatesInTab = (activeTab?.createdTemplateIds ?? [])
          .map((id) => templates.find((t) => t.id === id))
          .filter((t): t is EmailTemplate => t != null);
        addMessage({
          role: "assistant",
          content:
            reply ||
            "Would you like to **preview** your email(s)**, ask for any edits or changes**, or **proceed to select sending inbox**?",
          templateCards: templatesInTab.slice(-10),
          previewOrInboxChoice: true,
        });
        return;
      }
      if (tool === "show_inbox_picker") {
        addMessage({
          role: "assistant",
          content: reply || "Which email account(s) should we send from? Pick one or more:",
          inboxCard: { inboxes },
        });
        return;
      }
      if (tool === "show_preview") {
        const templateId = params?.template_id as string | undefined;
        const t = templateId
          ? templates.find((x) => x.id === templateId)
          : (activeTab?.createdTemplateIds ?? []).map((id) => templates.find((x) => x.id === id)).find((x): x is EmailTemplate => x != null);
        if (t) setPreviewTemplate(t);
        if (reply) addMessage({ role: "assistant", content: reply });
        return;
      }
      if (tool === "show_existing_campaign") {
        const campaignId = (params?.campaign_id as string) || activeTab?.createdCampaignId;
        if (campaignId) {
          api.campaigns
            .get(campaignId)
            .then((campaign) => {
              addMessage({
                role: "assistant",
                content: reply || "You already have a campaign for this sequence. I can **update** it, **start** it, or you can open it to edit.",
                campaignCreated: { campaignId, campaignName: campaign.name, started: campaign.status === "active" },
              });
            })
            .catch(() => {
              addMessage({
                role: "assistant",
                content: reply || "You already have a campaign for this sequence. I can update it, start it, or you can open it to edit.",
                campaignCreated: { campaignId, campaignName: "Your campaign" },
              });
            });
        } else {
          addMessage({ role: "assistant", content: reply || "You already have a campaign for this sequence." });
        }
        return;
      }
      if (tool === "update_campaign") {
        const campaignId = (params?.campaign_id as string) || activeTab?.createdCampaignId;
        if (!campaignId) {
          addMessage({ role: "assistant", content: "No campaign to update. Create one first." });
          return;
        }
        const instruction = params?.instruction as string | undefined;
        const explicitName = params?.name as string | undefined;
        const explicitDailyLimit = params?.daily_limit as number | undefined;
        const explicitFollowUpDelay = params?.follow_up_delay_days as number | undefined;
        const explicitTimezone = params?.timezone as string | undefined;
        const explicitTemplateIds = params?.template_ids as string[] | undefined;
        try {
          const existing = await api.campaigns.get(campaignId);
          let merged: Campaign = { ...existing };
          if (instruction && aiProvider && userId) {
            const prompt = `You are an assistant. Given this campaign and the user's instruction, return a JSON object with ONLY the fields to change (e.g. name, daily_limit, follow_up_delay_days, timezone). Do not include contact_list_ids or contact_ids. Current campaign: name="${existing.name}", daily_limit=${existing.daily_limit}, follow_up_delay_days=${existing.follow_up_delay_days ?? 0}, timezone="${existing.timezone ?? ""}". User instruction: ${instruction}. Reply with ONLY valid JSON, no markdown.`;
            const result = await generateTemplate.mutateAsync({ userId, provider: aiProvider, prompt });
            const raw = (result?.content ?? "").trim();
            let text = raw;
            if (text.includes("```json")) {
              const m = text.match(/```json\s*([\s\S]*?)\s*```/i);
              if (m) text = m[1].trim();
            } else if (text.includes("```")) {
              const m = text.match(/```\s*([\s\S]*?)\s*```/);
              if (m) text = m[1].trim();
            }
            const firstBrace = text.indexOf("{");
            const lastBrace = text.lastIndexOf("}");
            if (firstBrace !== -1 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);
            try {
              const partial = JSON.parse(text) as Record<string, unknown>;
              if (typeof partial.name === "string") merged.name = partial.name;
              if (typeof partial.daily_limit === "number") merged.daily_limit = partial.daily_limit;
              if (typeof partial.follow_up_delay_days === "number") merged.follow_up_delay_days = partial.follow_up_delay_days;
              if (typeof partial.timezone === "string") merged.timezone = partial.timezone;
              if (Array.isArray(partial.template_ids)) merged.template_ids = partial.template_ids as string[];
            } catch {
              // ignore parse error
            }
          }
          if (explicitName !== undefined) merged.name = explicitName;
          if (explicitDailyLimit !== undefined) merged.daily_limit = explicitDailyLimit;
          if (explicitFollowUpDelay !== undefined) merged.follow_up_delay_days = explicitFollowUpDelay;
          if (explicitTimezone !== undefined) merged.timezone = explicitTimezone;
          if (explicitTemplateIds !== undefined) merged.template_ids = explicitTemplateIds;
          if (merged.template_ids && merged.template_ids.length > 0) {
            merged.email_sequence = buildEmailSequenceByStep(
              merged.template_ids,
              templates,
              merged.follow_up_delay_days ?? DEFAULT_FOLLOW_UP_DELAY_DAYS
            );
          }
          await api.campaigns.update(campaignId, merged);
          addMessage({ role: "assistant", content: reply || "Updated the campaign." });
          toast.success("Campaign updated");
        } catch (e) {
          addMessage({ role: "assistant", content: e instanceof Error ? e.message : "Failed to update campaign." });
          toast.error(e instanceof Error ? e.message : "Failed to update campaign");
        }
        return;
      }
      if (tool === "create_campaign") {
        if (activeTab?.createdCampaignId) {
          addMessage({
            role: "assistant",
            content: "You already have a campaign for this sequence. I can **update** it (e.g. change name or daily limit), **start** it, or you can open it to edit.",
            campaignCreated: { campaignId: activeTab.createdCampaignId, campaignName: activeTab.title || "Your campaign" },
          });
          return;
        }
        const listId = activeTab?.selectedListId;
        const selectedInboxIds = activeTab?.selectedInboxIds ?? [];
        let templateIds: string[] =
          activeTab?.createdTemplateIds?.length
            ? activeTab.createdTemplateIds.filter((id) => templates.some((t) => t.id === id))
            : [];
        if (!templateIds.length) {
          const bySequence = getTemplateIdsInSequenceOrder(templates, activeTab?.baseName ?? DEFAULT_OUTREACH_BASE);
          templateIds = bySequence.length > 0 ? bySequence : templates.slice(0, 3).map((t) => t.id);
        }
        if (!listId || templateIds.length === 0) {
          toast.error("Pick a contact list and create at least one email first (or use emails you already have).");
          addMessage({ role: "assistant", content: "Pick a contact list and add at least one email first, then try again." });
          return;
        }
        if (selectedInboxIds.length === 0) {
          addMessage({
            role: "assistant",
            content: "Which email account(s) should we send from? Pick one or more (e.g. your Gmail or connected inbox):",
            inboxCard: { inboxes },
          });
          return;
        }
        if (campaignGate.atLimit) {
          toast.error(campaignGate.reason || campaignGate.upgradeLine || "Campaign limit reached. Upgrade to create more.");
          setUpgradeOpen(true);
          return;
        }
        const senderIds = selectedInboxIds;
        const firstInbox = inboxes.find((i) => i.id === senderIds[0]);
        const senderType = firstInbox?.sender_type === "gmail" ? "gmail" : "smtp";
        const followUpDelay = Math.min(30, Math.max(0, Number(params?.follow_up_delay_days) ?? DEFAULT_FOLLOW_UP_DELAY_DAYS));
        const email_sequence = buildEmailSequenceByStep(templateIds, templates, followUpDelay);
        const campaignName = (params?.name as string) || activeTab?.title || activeTab?.baseName || "Outreach Campaign";
        const tz = (params?.timezone as string)?.trim() || getDefaultCampaignTimezone();
        // Default campaign daily limit = inbox_count × 50 when user didn't specify one.
        const inferredDefaultDailyLimit =
          senderIds.length > 0 ? senderIds.length * 50 : DEFAULT_CAMPAIGN_DAILY_LIMIT;
        const dailyLimit = Math.max(
          1,
          Number(params?.daily_limit) ?? inferredDefaultDailyLimit
        );
        const payload: Campaign = {
          id: crypto.randomUUID(),
          user_id: userId,
          name: campaignName,
          daily_limit: dailyLimit,
          template_ids: templateIds,
          contact_list_ids: [listId],
          contact_ids: [],
          status: "draft",
          field_mapping: {},
          email_sequence,
          start_time: "10:00",
          end_time: "16:00",
          timezone: tz,
          sender_type: senderType,
          sender_ids: senderIds,
          sender_rotation: "random",
          rotation_enabled: senderIds.length > 1,
          reply_to_type: "none",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const startImmediately = params?.start_immediately === true;
        const scheduledAt = (params?.scheduled_at as string)?.trim() || undefined;
        createCampaign.mutate(payload, {
          onSuccess: (campaign) => {
            const willStart = startImmediately || !!scheduledAt;
            if (willStart) {
              const variables = scheduledAt
                ? { campaignId: campaign.id, scheduled_at: scheduledAt }
                : campaign.id;
              startCampaign.mutate(variables, {
                onSuccess: () => {
                  setActiveTabState((tab) => ({
                    ...tab,
                    startedCampaignIds: [...(tab.startedCampaignIds ?? []), campaign.id],
                    createdCampaignId: campaign.id,
                  }));
                  addMessage({
                    role: "assistant",
                    content: reply || (scheduledAt ? "Campaign created and set to start at the scheduled time." : "Campaign is created and sending has started."),
                    campaignCreated: { campaignId: campaign.id, campaignName: campaign.name, started: true },
                  });
                  toast.success(scheduledAt ? "Campaign created and scheduled" : "Campaign created and started");
                },
                onError: (err) => {
                  setActiveTabState((tab) => ({ ...tab, createdCampaignId: campaign.id }));
                  addMessage({
                    role: "assistant",
                    content: reply || "Campaign created but failed to start (e.g. inbox not ready or sending limit). You can start it from the Campaigns page.",
                    campaignCreated: { campaignId: campaign.id, campaignName: campaign.name },
                  });
                  toast.error(
                    err instanceof Error ? err.message : "Campaign created but couldn't start sending"
                  );
                },
              });
            } else {
              setActiveTabState((tab) => ({ ...tab, createdCampaignId: campaign.id }));
              addMessage({
                role: "assistant",
                content:
                  reply ||
                  "Campaign created successfully. You can start sending when you're ready. To adjust schedule, daily limits, or other settings, click **Edit** on this campaign.",
                campaignCreated: { campaignId: campaign.id, campaignName: campaign.name },
              });
              toast.success("Campaign created");
            }
          },
          onError: (err) => {
            addMessage({ role: "assistant", content: "Campaign creation failed. Check your list, templates, and inboxes and try again." });
            toast.error(err instanceof Error ? err.message : "Failed to create campaign");
          },
        });
        return;
      }
      if (tool === "create_sequence") {
        if (!activeTab?.selectedListId) {
          addMessage({
            role: "assistant",
            content: "Pick a contact list first. I'll write the emails using only the info we have for that list (like first name, company, etc.).",
            listCard: { lists: contactLists },
          });
          return;
        }
        let nameConfirmed = params?.name_confirmed === true;
        const baseNameFromContext = (params?.base_name as string)?.trim() || activeTab?.baseName;
        const promptFromContext = (params?.prompt as string)?.trim() || activeTab?.pendingSequenceConfig?.topic;
        const hasTemplatesInSession = (activeTab?.createdTemplateIds?.length ?? 0) > 0;
        const isRetry = hasTemplatesInSession && baseNameFromContext && promptFromContext;
        if (!nameConfirmed && isRetry) {
          nameConfirmed = true;
          const cfg = activeTab?.pendingSequenceConfig;
          Object.assign(params, {
            base_name: baseNameFromContext,
            prompt: promptFromContext,
            name_confirmed: true,
            count: params?.count ?? cfg?.steps ?? 1,
            variants_per_step: params?.variants_per_step ?? cfg?.variants ?? 1,
            variants_first_step_only:
              params?.variants_first_step_only === true || cfg?.variantsFirstStepOnly === true,
          });
        }
        const variantsFirstStepOnlyParam = params?.variants_first_step_only === true;
        if (!nameConfirmed) {
          const promptTopic = (params?.prompt as string)?.trim() || "";
          const stepsCount = Math.min(10, Math.max(1, Number(params?.count) || 1));
          const variantsPerStep = Math.min(5, Math.max(1, Number(params?.variants_per_step) ?? 1));
          const baseNameParam = (params?.base_name as string)?.trim();
          const fallbackName = baseNameParam || activeTab?.baseName || DEFAULT_OUTREACH_BASE;
          let suggestedName = suggestSequenceName(promptTopic, fallbackName);
          if (promptTopic && aiProvider && userId) {
            try {
              const namePrompt = `You are a naming assistant. Suggest a short sequence name (2-5 words) for an email campaign. Do not include URLs. Do not use quotes. Reply with ONLY the sequence name, nothing else.

Campaign topic: ${promptTopic}`;
              const result = await generateTemplate.mutateAsync({
                userId,
                provider: aiProvider,
                prompt: namePrompt,
              });
              const content = (result?.content ?? "").trim();
              suggestedName = parseSuggestedNameFromAI(content, fallbackName);
            } catch {
              suggestedName = fallbackName;
            }
          }
          setActiveTabState((tab) => ({
            ...tab,
            pendingSequenceAsk: "name_confirm",
            pendingSequenceConfig: {
              steps: stepsCount,
              variants: variantsPerStep,
              variantsFirstStepOnly: variantsFirstStepOnlyParam,
              topic: promptTopic,
              suggestedName,
            },
          }));
          addMessage({
            role: "assistant",
            content: `I'll call this sequence **${suggestedName}**. Reply "yes" to keep it, or type a different name.`,
          });
          return;
        }
        const baseNameParam = (params?.base_name as string)?.trim();
        const baseName = baseNameParam || activeTab?.baseName || DEFAULT_OUTREACH_BASE;
        if (baseNameParam) {
          setActiveTabState((tab) => ({ ...tab, baseName: baseNameParam, title: baseNameParam }));
        }
        const campaignContext = buildCampaignContext(params ?? {});
        const stepsCount = Math.min(10, Math.max(1, Number(params?.count) || 1));
        const variantsPerStep = Math.min(5, Math.max(1, Number(params?.variants_per_step) ?? 1));
        const variantsFirstStepOnly =
          params?.variants_first_step_only === true ||
          activeTab?.pendingSequenceConfig?.variantsFirstStepOnly === true;
        // Check if email format has been selected; if not, ask the user before generating.
        const selectedBodyType =
          (params?._body_type as "html" | "plain" | "rich" | undefined) ||
          activeTab?.pendingSequenceConfig?.bodyType;
        if (!selectedBodyType) {
          setActiveTabState((tab) => ({
            ...tab,
            pendingSequenceAsk: "format",
            pendingSequenceConfig: {
              ...tab?.pendingSequenceConfig,
              steps: stepsCount,
              variants: variantsPerStep,
              variantsFirstStepOnly,
            },
            pendingSequenceParams: {
              ...(params as Record<string, unknown>),
              base_name: baseName,
              name_confirmed: true,
              count: stepsCount,
              variants_per_step: variantsPerStep,
              variants_first_step_only: variantsFirstStepOnly,
            },
          }));
          addMessage({
            role: "assistant",
            content: "**What format should the emails be in?**",
            formatCard: true,
          });
          return;
        }
        if (!aiProvider || !userId) {
          toast.error("Select an AI provider and ensure you're logged in.");
          return;
        }
        let variableRestriction = "";
        try {
          const { contacts } = await api.contactLists.getContacts(activeTab.selectedListId, 0, CONTACT_SAMPLE_SIZE);
          const vars = getCommonVariableNames(contacts);
          variableRestriction = buildVariableRestrictionPrompt(vars);
        } catch {
          toast.warning("Contact list couldn't be loaded; emails may use placeholders not in your list.");
        }
        const createdInRun: EmailTemplate[] = [];
        const createdIds: string[] = [];
        // Create in order: S1-V1, S1-V2, ..., S2-V1, S2-V2, ... (all variants for step 1, then step 2, etc.)
        // When variantsFirstStepOnly is true, only step 1 gets A/B variants; follow-ups get one version each.
        for (let S = 1; S <= stepsCount; S++) {
          const vCount = variantsFirstStepOnly && S > 1 ? 1 : variantsPerStep;
          for (let V = 1; V <= vCount; V++) {
            const effectiveTemplates = [...templates, ...createdInRun];
            const isFirstVariantOfStep = V === 1;
            const nextName = getNextTemplateName(effectiveTemplates, {
              base: baseName,
              action: isFirstVariantOfStep ? "new_sequence" : "new_version",
              forSequence: isFirstVariantOfStep ? undefined : S,
            });
            const sequenceNumber = isFirstVariantOfStep
              ? getNextSequenceNumber(effectiveTemplates)
              : (getSequenceNumberForStep(effectiveTemplates, baseName, S) ?? getNextSequenceNumber(effectiveTemplates));
            const stepPrompt =
              S === 1 && V === 1
                ? campaignContext
                : S === 1 && V > 1
                  ? `Variant ${V} for the initial email. Context: ${campaignContext}. Keep it distinct from other variants (different subject or opening, same goal) for A/B testing.`
                  : V === 1
                    ? `Follow-up email, step ${S} of ${stepsCount}. Context: ${campaignContext}. Keep it concise and natural.`
                    : `Variant ${V} for step ${S} of the sequence. Context: ${campaignContext}. Keep it distinct from other variants (different angle or tone, same goal) for A/B testing.`;
            const formatHint =
              selectedBodyType === "plain"
                ? "\n\nFORMAT: Write the email body as plain text with line breaks only. Do NOT use any HTML tags."
                : selectedBodyType === "html"
                  ? "\n\nFORMAT: Write the email body as HTML with inline CSS styles on elements."
                  : "";
            const fullPrompt = FULL_TEMPLATE_PROMPT_PREFIX + getRandomFramework() + variableRestriction + buildCompliancePrompt(compliance) + stepPrompt + formatHint;
            let result: { content: string };
            try {
              result = await generateTemplate.mutateAsync({
                userId,
                provider: aiProvider,
                prompt: fullPrompt,
              });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to create email");
              addMessage({
                role: "assistant",
                content: `Created ${createdInRun.length} email(s). Something went wrong at email ${S}, version ${V}.`,
                templateCards: createdInRun,
              });
              return;
            }
            let content = (result?.content ?? "").trim();
            let parsed = parseTemplateJson(content);
            if (!parsed && S === 1 && V === 1) {
              const retryPrompt = FULL_TEMPLATE_PROMPT_PREFIX + getRandomFramework() + variableRestriction + buildCompliancePrompt(compliance) + stepPrompt + "\n\nReturn ONLY a valid JSON object with keys: name, subject, body. No markdown, no code block, no extra text.";
              try {
                const retryResult = await generateTemplate.mutateAsync({
                  userId,
                  provider: aiProvider,
                  prompt: retryPrompt,
                });
                content = (retryResult?.content ?? "").trim();
                parsed = parseTemplateJson(content);
              } catch {
                // use parsed as-is (still null)
              }
            }
            if (!parsed) {
              toast.error(`Could not parse the email at S${S}-V${V}. Try again or add more detail about what the emails should say.`);
              if (createdInRun.length > 0) {
                setActiveTabState((tab) => ({
                  ...tab,
                  createdTemplateIds: [...tab.createdTemplateIds, ...createdIds],
                }));
                addMessage({
                  role: "assistant",
                  content: `Created **${createdInRun.map((t) => t.name).join("**, **")}**. Something went wrong at email ${S}, version ${V}. Try again or tell me more about what you want the emails to say.`,
                  templateCards: createdInRun,
                });
              }
              return;
            }
            const subject = String(parsed.subject ?? "").trim() || "No subject";
            const bodyRaw = String(parsed.body ?? "").trim();
            let body = selectedBodyType === "plain" ? bodyRaw : (looksLikeHtml(bodyRaw) ? bodyRaw : plainTextToHtml(bodyRaw));
            const check = runComplianceCheck(subject + "\n" + body, compliance);
            if (!check.unsubscribeOk && compliance?.require_unsubscribe_link !== false) {
              body = body.trimEnd() + DEFAULT_UNSUBSCRIBE;
            }
            let finalSubject = subject;
            let finalBody = body;
            let finalCheck = runComplianceCheck(subject + "\n" + body, compliance);
            if (!finalCheck.allOk) {
              const fixed = await tryFixTemplateCompliance(subject, body, compliance, generateTemplate, userId, aiProvider);
              if (fixed) {
                finalSubject = fixed.subject;
                finalBody = fixed.body;
                finalCheck = runComplianceCheck(finalSubject + "\n" + finalBody, compliance);
              }
              if (!finalCheck.allOk) {
                toast.error("Email doesn't meet compliance rules");
                addMessage({
                  role: "assistant",
                  content: getComplianceFixFailedMessage(finalCheck) + ` Stopped at email ${S}, version ${V}.`,
                });
                if (createdInRun.length > 0) {
                  setActiveTabState((tab) => ({
                    ...tab,
                    createdTemplateIds: [...tab.createdTemplateIds, ...createdIds],
                  }));
                  addMessage({
                    role: "assistant",
                    content: `Created **${createdInRun.map((t) => t.name).join("**, **")}** before I had to stop.`,
                    templateCards: createdInRun,
                  });
                }
                return;
              }
            }
            const id = crypto.randomUUID();
            const templateData: EmailTemplate = {
              id,
              user_id: userId,
              name: nextName,
              subject: finalSubject,
              body: finalBody,
              body_type: selectedBodyType,
              sequence_number: sequenceNumber,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            try {
              await createTemplate.mutateAsync(templateData);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to create email");
              if (createdIds.length > 0) {
                setActiveTabState((tab) => ({
                  ...tab,
                  createdTemplateIds: [...tab.createdTemplateIds, ...createdIds],
                }));
                addMessage({
                  role: "assistant",
                  content: `Created **${createdInRun.map((t) => t.name).join("**, **")}**.`,
                  templateCards: createdInRun,
                });
              }
              return;
            }
            createdInRun.push(templateData);
            createdIds.push(id);
            setActiveTabState((tab) => ({
              ...tab,
              createdTemplateIds: [...tab.createdTemplateIds, id],
            }));
          }
        }
        const totalCreated = createdInRun.length;
        const namesList = createdInRun.map((t) => t.name).join("**, **");
        let postReply = reply || `Created **${totalCreated}** email(s): **${namesList}**. Would you like to **preview** or **proceed to select sending inbox**?`;
        if (aiProvider && userId) {
          try {
            const replyRes = await api.outreach.generatePostTemplateReply({
              user_id: userId,
              provider: aiProvider,
              created_names: createdInRun.map((t) => t.name),
              count: totalCreated,
            });
            if (replyRes?.reply?.trim()) postReply = replyRes.reply.trim();
          } catch {
            // use fallback
          }
        }
        addMessage({
          role: "assistant",
          content: postReply,
          templateCards: createdInRun,
          previewOrInboxChoice: true,
        });
        toast.success(`Created ${totalCreated} email(s)`);
        return;
      }
      if (tool === "create_template") {
        if (!activeTab?.selectedListId) {
          addMessage({
            role: "assistant",
            content: "Pick a contact list first. Emails will use only the info we have for that list (e.g. first name, company).",
            listCard: { lists: contactLists },
          });
          return;
        }
        const campaignContext = buildCampaignContext(params ?? {});
        await createTemplateFromPrompt(campaignContext, "new_sequence", undefined, activeTab.selectedListId);
        return;
      }
      if (tool === "add_follow_up") {
        if (!activeTab?.selectedListId) {
          addMessage({
            role: "assistant",
            content: "Pick a contact list first. Emails will use only the info we have for that list (e.g. first name, company).",
            listCard: { lists: contactLists },
          });
          return;
        }
        const campaignContext = buildCampaignContext(params ?? {}) || "follow-up email for the same sequence, polite and short";
        await createTemplateFromPrompt(campaignContext, "new_sequence", undefined, activeTab.selectedListId);
        return;
      }
      if (tool === "add_variants") {
        if (!activeTab?.selectedListId) {
          addMessage({
            role: "assistant",
            content: "Pick a contact list first. Different versions will use only the info we have for that list.",
            listCard: { lists: contactLists },
          });
          return;
        }
        const baseNameParam = (params?.base_name as string)?.trim();
        const baseName = baseNameParam || (activeTab?.baseName ?? DEFAULT_OUTREACH_BASE);
        const parsed = templates
          .map((t) => parseOutreachName(t.name, baseName))
          .filter((p): p is NonNullable<ReturnType<typeof parseOutreachName>> => p !== null);
        const sequenceSteps = [...new Set(parsed.map((p) => p.S))].sort((a, b) => a - b);
        if (sequenceSteps.length === 0) {
          addMessage({
            role: "assistant",
            content: reply || "You don't have any emails in this sequence yet. Create your first email or add more, then ask for extra versions to test.",
          });
          return;
        }
        const variantContext = buildCampaignContext(params ?? {}) || "Alternative variant for this step—same goal but different angle or tone for A/B testing.";
        if (!aiProvider || !userId) {
          toast.error("Select an AI provider and ensure you're logged in.");
          return;
        }
        let variableRestriction = "";
        try {
          const { contacts } = await api.contactLists.getContacts(activeTab.selectedListId, 0, CONTACT_SAMPLE_SIZE);
          variableRestriction = buildVariableRestrictionPrompt(getCommonVariableNames(contacts));
        } catch {
          toast.warning("Contact list couldn't be loaded; variants may use placeholders not in your list.");
        }
        const createdInRun: EmailTemplate[] = [];
        const createdIds: string[] = [];
        for (const S of sequenceSteps) {
          const effectiveTemplates = [...templates, ...createdInRun];
          const nextName = getNextTemplateName(effectiveTemplates, {
            base: baseName,
            action: "new_version",
            forSequence: S,
          });
          const sequenceNumber = getSequenceNumberForStep(effectiveTemplates, baseName, S) ?? getNextSequenceNumber(effectiveTemplates);
          const stepPrompt = `Variant for step ${S} of the sequence. ${variantContext}. Keep it distinct from existing variants (different subject or opening, same goal).`;
          const fullPrompt = FULL_TEMPLATE_PROMPT_PREFIX + getRandomFramework() + variableRestriction + buildCompliancePrompt(compliance) + stepPrompt;
          let result: { content: string };
          try {
            result = await generateTemplate.mutateAsync({
              userId,
              provider: aiProvider,
              prompt: fullPrompt,
            });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to create that version");
            if (createdInRun.length > 0) {
              setActiveTabState((tab) => ({
                ...tab,
                createdTemplateIds: [...tab.createdTemplateIds, ...createdIds],
              }));
              addMessage({
                role: "assistant",
                content: `Created **${createdInRun.map((t) => t.name).join("**, **")}**. Something went wrong on email ${S}.`,
                templateCards: createdInRun,
              });
            }
            return;
          }
          let content = (result?.content ?? "").trim();
          let parsedJson = parseTemplateJson(content);
          if (!parsedJson) {
            toast.error("Couldn't create that version for email " + S + ". Try again.");
            if (createdInRun.length > 0) {
              setActiveTabState((tab) => ({
                ...tab,
                createdTemplateIds: [...tab.createdTemplateIds, ...createdIds],
              }));
              addMessage({
                role: "assistant",
                content: `Created **${createdInRun.map((t) => t.name).join("**, **")}**.`,
                templateCards: createdInRun,
              });
            }
            return;
          }
          const subject = String(parsedJson.subject ?? "").trim() || "No subject";
          const bodyRaw = String(parsedJson.body ?? "").trim();
          let body = looksLikeHtml(bodyRaw) ? bodyRaw : plainTextToHtml(bodyRaw);
          const check = runComplianceCheck(subject + "\n" + body, compliance);
          if (!check.unsubscribeOk && compliance?.require_unsubscribe_link !== false) {
            body = body.trimEnd() + DEFAULT_UNSUBSCRIBE;
          }
          let finalSubject = subject;
          let finalBody = body;
          let finalCheck = runComplianceCheck(subject + "\n" + body, compliance);
          if (!finalCheck.allOk) {
            const fixed = await tryFixTemplateCompliance(subject, body, compliance, generateTemplate, userId, aiProvider);
            if (fixed) {
              finalSubject = fixed.subject;
              finalBody = fixed.body;
              finalCheck = runComplianceCheck(finalSubject + "\n" + finalBody, compliance);
            }
            if (!finalCheck.allOk) {
              toast.error("Email doesn't meet compliance rules");
              addMessage({
                role: "assistant",
                content: getComplianceFixFailedMessage(finalCheck) + ` Failed on email ${S}.`,
              });
              if (createdInRun.length > 0) {
                setActiveTabState((tab) => ({
                  ...tab,
                  createdTemplateIds: [...tab.createdTemplateIds, ...createdIds],
                }));
                addMessage({
                  role: "assistant",
                  content: `Created **${createdInRun.map((t) => t.name).join("**, **")}**.`,
                  templateCards: createdInRun,
                });
              }
              return;
            }
          }
          const id = crypto.randomUUID();
          const templateData: EmailTemplate = {
            id,
            user_id: userId,
            name: nextName,
            subject: finalSubject,
            body: finalBody,
            body_type: "rich",
            sequence_number: sequenceNumber,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          try {
            await createTemplate.mutateAsync(templateData);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to create that version");
            if (createdIds.length > 0) {
              setActiveTabState((tab) => ({
                ...tab,
                createdTemplateIds: [...tab.createdTemplateIds, ...createdIds],
              }));
              addMessage({
                role: "assistant",
                content: `Created **${createdInRun.map((t) => t.name).join("**, **")}**.`,
                templateCards: createdInRun,
              });
            }
            return;
          }
          createdInRun.push(templateData);
          createdIds.push(id);
          setActiveTabState((tab) => ({
            ...tab,
            createdTemplateIds: [...tab.createdTemplateIds, id],
          }));
        }
        const namesList = createdInRun.map((t) => t.name).join("**, **");
        let postReply = reply || `Created **${createdInRun.length}** extra version(s) for your emails: **${namesList}**. Would you like to **preview** or **proceed to select sending inbox**?`;
        if (aiProvider && userId) {
          try {
            const replyRes = await api.outreach.generatePostTemplateReply({
              user_id: userId,
              provider: aiProvider,
              created_names: createdInRun.map((t) => t.name),
              count: createdInRun.length,
            });
            if (replyRes?.reply?.trim()) postReply = replyRes.reply.trim();
          } catch {
            // use fallback
          }
        }
        addMessage({
          role: "assistant",
          content: postReply,
          templateCards: createdInRun,
          previewOrInboxChoice: true,
        });
        toast.success(`Created ${createdInRun.length} extra version(s)`);
        return;
      }
      if (tool === "update_template") {
        const instruction = params?.instruction as string | undefined;
        const singleId =
          (params?.template_id as string | undefined)?.trim() ||
          activeTab?.taggedForUpdateTemplateId ||
          undefined;
        const templateIdsToUpdate: string[] = singleId
          ? [singleId]
          : (activeTab?.createdTemplateIds ?? []).filter((id) => templates.some((t) => t.id === id));
        if (!instruction) {
          addMessage({
            role: "assistant",
            content: activeTab?.taggedForUpdateTemplateId
              ? "What would you like to change? (e.g. 'Make the subject shorter' or 'Add a call to action'.)"
              : "Tag an email above as **Selected for update**, or tell me which email to change and what to change (e.g. 'Make the first email shorter' or 'Update Cold Outreach - make it friendlier').",
          });
          return;
        }
        if (templateIdsToUpdate.length === 0) {
          addMessage({
            role: "assistant",
            content: "There are no emails in this chat to update. Create some first, or tag one above as **Selected for update**.",
          });
          return;
        }
        if (!aiProvider || !userId) {
          toast.error("Select an AI provider and ensure you're logged in.");
          return;
        }
        const compliancePrompt = buildCompliancePrompt(compliance);
        const updatedCards: EmailTemplate[] = [];
        let lastError: string | null = null;
        for (const templateId of templateIdsToUpdate) {
          const template = templates.find((t) => t.id === templateId);
          if (!template) continue;
          const updatePrompt = buildUpdateTemplatePrompt(template.subject, template.body || "", instruction, compliancePrompt);
          let result: { content: string };
          try {
            result = await generateTemplate.mutateAsync({
              userId,
              provider: aiProvider,
              prompt: updatePrompt,
            });
          } catch (e) {
            lastError = e instanceof Error ? e.message : "Failed to generate update";
            toast.error(lastError);
            continue;
          }
          const content = (result?.content ?? "").trim();
          const parsed = parseTemplateJson(content);
          if (!parsed) {
            lastError = "AI response was not valid JSON.";
            continue;
          }
          const subject = String(parsed.subject ?? template.subject).trim() || template.subject;
          const bodyRaw = String(parsed.body ?? template.body ?? "").trim();
          const body = looksLikeHtml(bodyRaw) ? bodyRaw : plainTextToHtml(bodyRaw);
          const check = runComplianceCheck(subject + "\n" + body, compliance);
          let finalBody =
            !check.unsubscribeOk && compliance?.require_unsubscribe_link !== false
              ? body.trimEnd() + DEFAULT_UNSUBSCRIBE
              : body;
          let finalSubject = subject;
          let finalCheck = runComplianceCheck(subject + "\n" + finalBody, compliance);
          if (!finalCheck.allOk) {
            const fixed = await tryFixTemplateCompliance(subject, finalBody, compliance, generateTemplate, userId, aiProvider);
            if (fixed) {
              finalSubject = fixed.subject;
              finalBody = fixed.body;
              finalCheck = runComplianceCheck(finalSubject + "\n" + finalBody, compliance);
            }
            if (!finalCheck.allOk) {
              lastError = "Email doesn't meet compliance rules";
              toast.error(lastError);
              continue;
            }
          }
          const updatedAt = new Date().toISOString();
          try {
            await updateTemplateMutation.mutateAsync({
              templateId,
              data: { ...template, subject: finalSubject, body: finalBody, updated_at: updatedAt },
            });
            updatedCards.push({ ...template, subject: finalSubject, body: finalBody, updated_at: updatedAt });
          } catch (e) {
            lastError = e instanceof Error ? e.message : "Failed to update email";
            toast.error(lastError);
          }
        }
        if (updatedCards.length === 0) {
          addMessage({
            role: "assistant",
            content: lastError || "I couldn't update the email(s). Please try again.",
          });
          return;
        }
        const count = updatedCards.length;
        const summary =
          count === 1
            ? `Updated email **${updatedCards[0].name}**.`
            : `Updated **${count}** emails: ${updatedCards.map((t) => t.name).join(", ")}.`;
        addMessage({
          role: "assistant",
          content: reply || summary,
          templateCard: count === 1 ? updatedCards[0] : undefined,
          templateCards: count > 1 ? updatedCards : undefined,
        });
        if (count > 1) toast.success(`Updated ${count} emails`);
        return;
      }
      if (tool === "delete_template") {
        const templateId = params?.template_id as string | undefined;
        const templateIdsParam = params?.template_ids as string[] | undefined;
        const idsToDelete: string[] = templateIdsParam?.length
          ? templateIdsParam
          : templateId
            ? [templateId]
            : [];
        const validIds = idsToDelete.filter((id) => activeTab?.createdTemplateIds?.includes(id) || templates.some((t) => t.id === id));
        if (validIds.length === 0) {
          addMessage({
            role: "assistant",
            content: reply || "There are no emails to delete in this chat yet. Create some first, or remove them from the Templates section.",
          });
          return;
        }
        try {
          if (validIds.length === 1) {
            await deleteTemplate.mutateAsync(validIds[0]);
          } else {
            await deleteTemplates.mutateAsync(validIds);
          }
        } catch (e) {
          addMessage({
            role: "assistant",
            content: "Couldn't delete one or more emails. They might be used in a campaign that's running. Try removing them from the Templates section instead.",
          });
          toast.error(e instanceof Error ? e.message : "Failed to delete");
          return;
        }
        setActiveTabState((tab) => ({
          ...tab,
          createdTemplateIds: (tab.createdTemplateIds ?? []).filter((id) => !validIds.includes(id)),
        }));
        const names = validIds.map((id) => templates.find((t) => t.id === id)?.name ?? id).join(", ");
        addMessage({
          role: "assistant",
          content: reply || `Deleted email(s): **${names}**.`,
        });
        return;
      }
      addMessage({
        role: "assistant",
        content: reply || "I didn't quite get that. You can: create your first email, add a follow-up email, add extra versions to test, pick a list, pick an inbox, or create a campaign. Or use the buttons below.",
      });
    },
    [
      addMessage,
      setActiveTabState,
      contactLists,
      activeTab,
      templates,
      inboxes,
      campaignGate.atLimit,
      createCampaign,
      startCampaign,
      createTemplateFromPrompt,
      updateTemplateMutation,
      deleteTemplate,
      deleteTemplates,
      generateTemplate,
      compliance,
      userId,
      aiProvider,
      setUpgradeOpen,
    ]
  );

  const executeIntent = useCallback(
    async (action: string, params: Record<string, unknown>, replyText?: string) => {
      await runOneStep(action, { ...params, _reply: replyText }, replyText);
    },
    [runOneStep]
  );

  const executeSteps = useCallback(
    async (steps: Array<{ tool: string; args: Record<string, unknown> }>) => {
      for (const s of steps) {
        await runOneStep(s.tool, s.args ?? {}, (s.args?._reply as string) ?? undefined);
      }
    },
    [runOneStep]
  );

  const handleSelectFormat = useCallback(
    async (format: "html" | "plain" | "rich") => {
      if (!activeChatId || !aiProvider) {
        toast.error("Select an AI provider and ensure you're in a chat.");
        return;
      }
      setActiveTabState((tab) =>
        tab
          ? {
              ...tab,
              pendingSequenceAsk: undefined,
              pendingSequenceConfig: tab.pendingSequenceConfig
                ? { ...tab.pendingSequenceConfig, bodyType: format }
                : { steps: 1, variants: 1, bodyType: format },
              pendingSequenceParams: undefined,
            }
          : tab
      );
      const formatLabel = format === "plain" ? "Plain Text" : format === "html" ? "HTML" : "Rich Text";
      addMessage({ role: "user", content: formatLabel });
      setIsIntentLoading(true);
      try {
        const res = await api.outreach.act(activeChatId, {
          message: `I selected ${formatLabel} format`,
          role: "user",
          ai_provider: aiProvider,
          ui_hints: { body_type: format },
        });
        if (res?.messages?.length) {
          appendMessagesFromAct(res.messages);
        }
        if (res?.state) {
          setActiveTabState((tab) =>
            tab
              ? {
                  ...tab,
                  createdTemplateIds:
                    (res.state.created_template_ids as string[] | undefined) ?? tab.createdTemplateIds,
                }
              : tab
          );
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to set format");
      } finally {
        setIsIntentLoading(false);
      }
    },
    [activeChatId, aiProvider, setActiveTabState, appendMessagesFromAct, addMessage]
  );

  const handleQuickAction = useCallback(
    async (action: "first_template" | "follow_up" | "select_list" | "create_campaign") => {
      if (action === "select_list") {
        addMessage({
          role: "assistant",
          content: "Pick a contact list first. Then I can create emails using the info we have for that list (like names, company).",
          listCard: { lists: contactLists },
        });
        return;
      }
      if (action === "first_template" || action === "follow_up") {
        if (!activeTab?.selectedListId) {
          addMessage({
            role: "assistant",
            content: "Pick a contact list first. Emails will use only the info we have for that list (e.g. first name, company).",
            listCard: { lists: contactLists },
          });
          return;
        }
      }
      if (action === "create_campaign") {
        if (activeTab?.createdCampaignId) {
          addMessage({
            role: "assistant",
            content: "You already have a campaign for this sequence. I can **update** it, **start** it, or you can open it to edit.",
            campaignCreated: { campaignId: activeTab.createdCampaignId, campaignName: activeTab.title || "Your campaign" },
          });
          return;
        }
        const listId = activeTab?.selectedListId;
        const selectedInboxIds = activeTab?.selectedInboxIds ?? [];
        let templateIds: string[];
        if (activeTab?.createdTemplateIds?.length) {
          templateIds = activeTab.createdTemplateIds.filter((id) => templates.some((t) => t.id === id));
        } else {
          templateIds = [];
        }
        if (!templateIds.length) {
          const bySequence = getTemplateIdsInSequenceOrder(templates, activeTab?.baseName ?? DEFAULT_OUTREACH_BASE);
          templateIds = bySequence.length > 0 ? bySequence : templates.slice(0, 3).map((t) => t.id);
        }
        if (!listId || templateIds.length === 0) {
          toast.error("Pick a contact list and create at least one email first (or use emails you already have).");
          return;
        }
        if (selectedInboxIds.length === 0) {
          addMessage({
            role: "assistant",
            content: "Which email account(s) should we send from? Pick one or more (e.g. your Gmail or connected inbox):",
            inboxCard: { inboxes },
          });
          return;
        }
        if (campaignGate.atLimit) {
          toast.error(campaignGate.reason || campaignGate.upgradeLine || "Campaign limit reached.");
          setUpgradeOpen(true);
          return;
        }
        const senderIds = selectedInboxIds;
        const firstInbox = inboxes.find((i) => i.id === senderIds[0]);
        const senderType = firstInbox?.sender_type === "gmail" ? "gmail" : "smtp";
        const email_sequence = buildEmailSequenceByStep(templateIds, templates, DEFAULT_FOLLOW_UP_DELAY_DAYS);
        const tz = getDefaultCampaignTimezone();
        // When we don't have explicit params, infer campaign daily limit from selected inboxes.
        const inferredDefaultDailyLimit =
          selectedInboxIds.length > 0
            ? selectedInboxIds.length * 50
            : DEFAULT_CAMPAIGN_DAILY_LIMIT;
        const payload: Campaign = {
          id: crypto.randomUUID(),
          user_id: userId,
          name: activeTab?.title ?? activeTab?.baseName ?? "Outreach Campaign",
          daily_limit: inferredDefaultDailyLimit,
          template_ids: templateIds,
          contact_list_ids: [listId],
          contact_ids: [],
          status: "draft",
          field_mapping: {},
          email_sequence,
          start_time: "10:00",
          end_time: "16:00",
          timezone: tz,
          sender_type: senderType,
          sender_ids: senderIds,
          sender_rotation: "random",
          rotation_enabled: senderIds.length > 1,
          reply_to_type: "none",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const shouldStartAfterCreate = startAfterCreate;
        createCampaign.mutate(payload, {
          onSuccess: (campaign) => {
            setActiveTabState((tab) => ({ ...tab, createdCampaignId: campaign.id }));
            if (shouldStartAfterCreate) {
              startCampaign.mutate(campaign.id, {
                onSuccess: () => {
                  setActiveTabState((tab) => ({
                    ...tab,
                    startedCampaignIds: [...(tab.startedCampaignIds ?? []), campaign.id],
                  }));
                  addMessage({
                    role: "assistant",
                    content: "Campaign is created and sending has started.",
                    campaignCreated: { campaignId: campaign.id, campaignName: campaign.name, started: true },
                  });
                  toast.success("Campaign created and started");
                },
                onError: (err) => {
                  addMessage({
                    role: "assistant",
                    content: "Campaign was created but didn't start sending (e.g. inbox not ready). Start it from the Campaigns page.",
                    campaignCreated: { campaignId: campaign.id, campaignName: campaign.name },
                  });
                  toast.error(
                    err instanceof Error ? err.message : "Campaign created but couldn't start"
                  );
                },
              });
            } else {
              addMessage({
                role: "assistant",
                content:
                  "Campaign created successfully. You can start sending when you're ready. To adjust schedule, daily limits, or other settings, click **Edit** on this campaign.",
                campaignCreated: { campaignId: campaign.id, campaignName: campaign.name },
              });
              toast.success("Campaign created");
            }
          },
          onError: (err) => {
            addMessage({ role: "assistant", content: "Campaign creation failed. Check your list, templates, and inboxes and try again." });
            toast.error(err instanceof Error ? err.message : "Failed to create campaign");
          },
        });
        return;
      }
      if (action === "follow_up") {
        createTemplateFromPrompt("follow-up email for the same sequence, polite and short", "new_sequence");
        return;
      }
      if (action === "first_template") {
        if (!activeTab?.selectedListId) {
          addMessage({
            role: "assistant",
            content: "Pick a contact list first. Then I'll create emails using only the info we have for that list.",
            listCard: { lists: contactLists },
          });
          return;
        }
        addMessage({ role: "user", content: "I want to create a new email sequence." });
        if (!aiProvider || !userId) {
          addMessage({
            role: "assistant",
            content: "Pick an AI provider from the dropdown above (or [set it up in Settings](/settings?tab=integrations#aiprovider)). Then tell me: what to call this sequence, what it's about, and how many emails you want (e.g. 3).",
          });
          return;
        }
        if (!activeChatId) {
          toast.error("No active chat. Create a new chat and try again.");
          return;
        }
        setIsIntentLoading(true);
        try {
          const res = await api.outreach.act(activeChatId, {
            message: "I want to create a new email sequence.",
            role: "user",
            ai_provider: aiProvider,
          });
          if (res?.messages?.length) {
            appendMessagesFromAct(res.messages);
          }
          if (res?.state) {
            const newTemplateIds = res.state.created_template_ids as string[] | undefined;
            const hadNewTemplates =
              userId &&
              newTemplateIds &&
              newTemplateIds.length > (activeTab?.createdTemplateIds?.length ?? 0);
            if (hadNewTemplates) {
              void queryClient.invalidateQueries({ queryKey: ["templates", userId] });
            }
            setActiveTabState((tab) =>
              tab
                ? {
                    ...tab,
                    selectedListId:
                      (res.state.selected_list_id as string | undefined) ?? tab.selectedListId,
                    baseName: (res.state.base_name as string | undefined) ?? tab.baseName,
                    createdCampaignId:
                      (res.state.created_campaign_id as string | undefined) ??
                      tab.createdCampaignId,
                    createdTemplateIds:
                      newTemplateIds ?? tab.createdTemplateIds,
                    selectedInboxIds:
                      (res.state.selected_inbox_ids as string[] | undefined) ?? tab.selectedInboxIds,
                    pendingSequenceAsk:
                      (res.state.pending_sequence_ask as "steps" | "variants" | "topic" | "name_confirm" | "format" | undefined) ??
                      (res.state.pending_name_confirm != null ? "name_confirm" : tab.pendingSequenceAsk),
                    pendingSequenceConfig:
                      tab.pendingSequenceConfig &&
                      (res.state.sequence_steps != null || res.state.sequence_variants != null)
                        ? {
                            ...tab.pendingSequenceConfig,
                            ...(res.state.sequence_steps != null && { steps: res.state.sequence_steps as number }),
                            ...(res.state.sequence_variants != null && { variants: res.state.sequence_variants as number }),
                          }
                        : tab.pendingSequenceConfig,
                  }
                : tab,
            );
          }
        } catch (e) {
          addMessage({
            role: "assistant",
            content: "What do you want to call this sequence? What's it about? How many emails (e.g. 3 = one first email + two follow-ups) and do you want to test different versions? (1 = no, 2 = yes, test two versions.)",
          });
          toast.error(e instanceof Error ? e.message : "Failed to start sequence");
        } finally {
          setIsIntentLoading(false);
        }
      }
    },
    [
      activeTab,
      contactLists,
      templates,
      inboxes,
      campaignGate.atLimit,
      createCampaign,
      addMessage,
      setActiveTabState,
      createTemplateFromPrompt,
      userId,
      aiProvider,
      startAfterCreate,
      startCampaign,
      activeChatId,
      appendMessagesFromAct,
      queryClient,
    ]
  );

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text) return;
    setInputValue("");
    if (!aiProvider || !userId) {
      addMessage({ role: "user", content: text });
      addMessage({
        role: "assistant",
        content:
          "Pick an AI provider from the dropdown above (or [set it up in Settings](/settings?tab=integrations#aiprovider)) so I can help you create and edit emails.",
      });
      toast.error("Select an AI provider first");
      return;
    }

    if (!activeChatId) {
      toast.error("No active chat. Create a new chat and try again.");
      return;
    }

    // Show the user's message immediately in the UI so the conversation feels responsive,
    // and so the "AI replying…" indicator can appear while we wait for the backend.
    addMessage({ role: "user", content: text });

    setIsIntentLoading(true);
    try {
      const res = await api.outreach.act(activeChatId, {
        message: text,
        role: "user",
        ai_provider: aiProvider,
      });

      if (res?.messages?.length) {
        appendMessagesFromAct(res.messages);
      }

      // Merge backend chat state into the current tab meta where relevant.
      if (res?.state) {
        const newTemplateIds = res.state.created_template_ids as string[] | undefined;
        const hadNewTemplates =
          userId &&
          newTemplateIds &&
          newTemplateIds.length > (activeTab?.createdTemplateIds?.length ?? 0);
        if (hadNewTemplates) {
          // Refetch templates so "Emails in this chat" shows newly created templates without refresh
          void queryClient.invalidateQueries({ queryKey: ["templates", userId] });
        }
        setActiveTabState((tab) =>
          tab
            ? {
                ...tab,
                selectedListId:
                  (res.state.selected_list_id as string | undefined) ?? tab.selectedListId,
                baseName: (res.state.base_name as string | undefined) ?? tab.baseName,
                createdCampaignId:
                  (res.state.created_campaign_id as string | undefined) ??
                  tab.createdCampaignId,
                createdTemplateIds:
                  newTemplateIds ?? tab.createdTemplateIds,
                selectedInboxIds:
                  (res.state.selected_inbox_ids as string[] | undefined) ?? tab.selectedInboxIds,
                pendingSequenceAsk:
                  (res.state.pending_sequence_ask as "steps" | "variants" | "topic" | "name_confirm" | "format" | undefined) ??
                  (res.state.pending_name_confirm != null ? "name_confirm" : tab.pendingSequenceAsk),
                pendingSequenceConfig:
                  tab.pendingSequenceConfig &&
                  (res.state.sequence_steps != null || res.state.sequence_variants != null)
                    ? {
                        ...tab.pendingSequenceConfig,
                        ...(res.state.sequence_steps != null && { steps: res.state.sequence_steps as number }),
                        ...(res.state.sequence_variants != null && { variants: res.state.sequence_variants as number }),
                      }
                    : tab.pendingSequenceConfig,
              }
            : tab,
        );
      }
      // After template updates, show follow-up: Edit Campaign if one exists, else Proceed to Inbox
      if (res?.state?.last_action === "update_template") {
        const templateIds = (res.state.created_template_ids as string[] | undefined) ?? activeTab?.createdTemplateIds ?? [];
        const templatesForFollowUp = templateIds
          .map((id) => templates.find((t) => t.id === id))
          .filter((t): t is EmailTemplate => t != null);
        if (templatesForFollowUp.length > 0) {
          const campaignId =
            (res.state.created_campaign_id as string | undefined) ?? activeTab?.createdCampaignId;
          addMessage({
            role: "assistant",
            content: campaignId
              ? "Do you have any other templates to edit, or open your campaign to adjust schedule, inboxes, and sending."
              : "Do you have any other templates to edit, or would you like to proceed with the inbox?",
            templateCards: templatesForFollowUp.slice(-10),
            previewOrInboxChoice: true,
            ...(campaignId ? { previewCampaignId: campaignId } : {}),
          });
        }
      }
      // ui_actions are intentionally left for future richer handling; current UI
      // already renders from assistant message payloads.
    } catch (e) {
      addMessage({
        role: "assistant",
        content: "Something went wrong. Try again or use the buttons below.",
      });
      toast.error(e instanceof Error ? e.message : "Failed to get intent");
    } finally {
      setIsIntentLoading(false);
    }
  }, [
    inputValue,
    addMessage,
    appendMessagesFromAct,
    aiProvider,
    userId,
    activeChatId,
    setActiveTabState,
    queryClient,
    activeTab?.createdTemplateIds?.length,
    activeTab?.createdTemplateIds,
    activeTab?.createdCampaignId,
    templates,
  ]);

  const handleGetStarted = useCallback(() => {
    // Start by asking the user to pick a contact list, then the existing flow
    // (topic → steps → variants → templates → inbox → campaign) will take over.
    addMessage({
      role: "assistant",
      content:
        "Let’s start by choosing who this campaign will target. Pick a contact list below, then I’ll ask for campaign details, number of sequence steps, and variations before generating your templates.",
      listCard: { lists: contactLists },
    });
  }, [addMessage, contactLists]);

  const addNewTab = useCallback(() => {
    api.outreach
      .createChat(`Outreach ${chatList.length + 1}`)
      .then((chat) => {
        setChatList((prev) => [...prev, { id: chat.id, title: chat.title }]);
        setActiveChatId(chat.id);
      })
      .catch(() => toast.error("Failed to create new chat"));
  }, [chatList.length]);

  const openRenameDialog = useCallback(() => {
    setRenameTabTitle(activeTab?.title ?? "");
    setRenameError("");
    setRenameDialogOpen(true);
  }, [activeTab?.title]);

  const handleRenameTab = useCallback(() => {
    const trimmed = renameTabTitle.trim();
    if (!activeChatId) return;
    if (!trimmed) {
      setRenameError("Please enter a name for the tab.");
      toast.error("Please enter a name for the tab.");
      return;
    }
    setRenameError("");
    api.outreach
      .updateChat(activeChatId, { title: trimmed })
      .then(() => {
        setChatList((prev) => prev.map((c) => (c.id === activeChatId ? { ...c, title: trimmed } : c)));
        setActiveTab((prev) => (prev && prev.id === activeChatId ? { ...prev, title: trimmed } : prev));
        setRenameDialogOpen(false);
        toast.success("Tab renamed");
      })
      .catch(() => {
        toast.error("Failed to rename");
      });
  }, [activeChatId, renameTabTitle]);

  const deleteTab = useCallback(
    async (tabId: string) => {
      const confirmed = await confirmDialog({
        title: "Delete chat",
        description:
          "This will delete this conversation from the server. Messages and selections cannot be recovered.",
      });
      if (!confirmed) return;
      setDeleteChatLoading(true);
      api.outreach
        .deleteChat(tabId)
        .then(() => {
          const remaining = chatList.filter((c) => c.id !== tabId);
          setChatList(remaining);
          if (activeChatId === tabId) {
            if (remaining.length > 0) {
              setActiveChatId(remaining[0].id);
              toast.success("Chat deleted");
            } else {
              api.outreach
                .createChat("Outreach 1")
                .then((chat) => {
                  setChatList([{ id: chat.id, title: chat.title }]);
                  setActiveChatId(chat.id);
                  toast.success("Chat deleted");
                })
                .catch(() => {
                  setChatList([]);
                  setActiveChatId("");
                  toast.error("Chat deleted but couldn't create a new one. Click + to start a conversation.");
                })
                .finally(() => setDeleteChatLoading(false));
              return;
            }
          } else {
            toast.success("Chat deleted");
          }
        })
        .catch(() => toast.error("Failed to delete chat"))
        .finally(() => setDeleteChatLoading(false));
    },
    [confirmDialog, activeChatId, chatList]
  );

  const handleDeleteTemplateFromChat = useCallback(
    async (templateId: string) => {
      try {
        await deleteTemplate.mutateAsync(templateId);
        setActiveTabState((tab) => ({
          ...tab,
          createdTemplateIds: (tab.createdTemplateIds ?? []).filter((id) => id !== templateId),
        }));
      } catch {
        // toast already from hook
      }
    },
    [deleteTemplate, setActiveTabState]
  );

  const handleTagForUpdate = useCallback(
    (templateId: string) => {
      setActiveTabState((tab) => (tab ? { ...tab, taggedForUpdateTemplateId: templateId } : tab));
    },
    [setActiveTabState]
  );

  const handleClearTag = useCallback(() => {
    setActiveTabState((tab) => (tab ? { ...tab, taggedForUpdateTemplateId: null } : tab));
  }, [setActiveTabState]);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTab?.messages?.length]);

  // Auto-resize textarea: 1 line min, 4 lines max (grows with text / Shift+Enter)
  const TEXTAREA_LINE_HEIGHT_PX = 24;
  const TEXTAREA_MAX_LINES = 4;
  const textareaMinHeightPx = 40;
  const textareaMaxHeightPx = TEXTAREA_LINE_HEIGHT_PX * TEXTAREA_MAX_LINES;
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.max(textareaMinHeightPx, Math.min(el.scrollHeight, textareaMaxHeightPx));
    el.style.height = `${h}px`;
  }, [inputValue]);

  const isBusy =
    isIntentLoading ||
    generateTemplate.isPending ||
    createTemplate.isPending ||
    updateTemplateMutation.isPending;

  const deletingTemplateId =
    deleteTemplate.isPending && deleteTemplate.variables != null
      ? (deleteTemplate.variables as string)
      : undefined;

  const templatesInTab = [...new Set(activeTab?.createdTemplateIds ?? [])]
    .map((id) => templates.find((t) => t.id === id))
    .filter((t): t is EmailTemplate => t != null);

  const hasTemplatesInChat = templatesInTab.length > 0;
  const hasSelectedInbox = (activeTab?.selectedInboxIds?.length ?? 0) > 0;
  const hasCreatedCampaign = !!activeTab?.createdCampaignId;

  const campaignChecklist = [
    {
      id: 1,
      label: "Select a contact list",
      done: hasSelectedList,
      requiredBefore: "Creating any emails or campaigns",
    },
    {
      id: 2,
      label: "Generate and review your sequence emails",
      done: hasTemplatesInChat,
      requiredBefore: "Selecting inboxes or creating a campaign",
    },
    {
      id: 3,
      label: "Select sending inbox account(s)",
      done: hasSelectedInbox,
      requiredBefore: "Creating a campaign",
    },
    {
      id: 4,
      label: "Create the campaign",
      done: hasCreatedCampaign,
      requiredBefore: "Starting or scheduling sending",
    },
  ];

  const aiSuggestions = [
    "Create a 3-step cold outreach sequence",
    "Add a follow-up email for non-responders",
    "Generate a welcome email template",
  ];

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-gradient-to-b from-muted/20 via-background to-background overflow-hidden">
      {/* Top header: product name, tagline, Live Chat status */}
      <header className="flex-shrink-0 border-b border-border/60 bg-background/95 backdrop-blur-md shadow-sm">
        <div className="flex items-center justify-between gap-4 px-4 lg:px-6 py-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h1 className="text-lg font-semibold text-foreground tracking-tight truncate">
                    AI Campaign Studio
                  </h1>
                  <Listen componentId="AICampaignStudio" />
                </div>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Automate long manual template creation — templates, lists & inboxes in one place
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {llmConfigs.length > 0 && (
              <Select value={aiProvider} onValueChange={setAiProvider}>
                <SelectTrigger className="w-[140px] h-9 text-xs rounded-xl border-border/60 bg-card/80 shadow-sm">
                  <Sparkles className="h-3.5 w-3 mr-1.5 text-primary" />
                  <SelectValue placeholder="AI provider" />
                </SelectTrigger>
                <SelectContent>
                  {llmConfigs.map((c) => (
                    <SelectItem key={c.provider} value={c.provider}>
                      {c.provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="hidden lg:inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80 px-2.5 py-1 rounded-lg bg-muted/50 border border-border/40">
              <Zap className="h-3 w-3 text-primary/80" />
              Powered by AI
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left sidebar: conversation list */}
        <aside className="hidden lg:flex flex-col w-64 xl:w-72 flex-shrink-0 border-r border-border/60 bg-card/30 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-3 border-b border-border/50">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversations</span>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={addNewTab} title="New conversation">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {chatsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : chatsLoadError ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 text-center">
                <p className="text-xs text-muted-foreground">Couldn&apos;t load. Click + to start.</p>
              </div>
            ) : chatList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 text-center">
                <MessageCircle className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No conversations yet</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {chatList.map((tab) => (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => setActiveChatId(tab.id)}
                      className={cn(
                        "w-full text-left rounded-xl px-3 py-2.5 transition-all duration-200 flex items-center gap-3",
                        activeChatId === tab.id
                          ? "bg-primary/10 text-primary border border-primary/20 shadow-sm"
                          : "text-foreground/90 hover:bg-muted/60 border border-transparent"
                      )}
                    >
                      <MessageCircle className={cn("h-4 w-4 shrink-0", activeChatId === tab.id ? "text-primary" : "text-muted-foreground")} />
                      <span className="text-sm font-medium truncate flex-1 min-w-0">{tab.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="p-2 border-t border-border/50 flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs rounded-lg"
              onClick={openRenameDialog}
              title="Rename"
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Rename
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs rounded-lg text-muted-foreground hover:!bg-destructive/10 hover:!text-destructive [&_svg]:hover:!text-destructive"
                    onClick={() => void deleteTab(activeChatId)}
                    disabled={!activeChatId || chatList.length === 0 || deleteChatLoading}
                  >
                    {deleteChatLoading ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    {deleteChatLoading ? "Deleting…" : "Delete"}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Delete this conversation</TooltipContent>
            </Tooltip>
          </div>
        </aside>

        {/* Center: active chat */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Mobile: tabs when sidebar hidden */}
          <div className="lg:hidden flex-shrink-0 border-b border-border/60 bg-background/80 px-3 py-2">
            <Tabs value={activeChatId} onValueChange={setActiveChatId}>
              <TabsList className="h-9 rounded-lg bg-muted/60 p-0.5 border border-border/50 w-full justify-start overflow-x-auto">
                {chatList.length === 0 ? (
                  <span className="text-xs text-muted-foreground px-3 py-1.5">No chats</span>
                ) : (
                  chatList.map((tab) => (
                    <TabsTrigger key={tab.id} value={tab.id} className="text-xs rounded-md px-3 shrink-0">
                      {tab.title}
                    </TabsTrigger>
                  ))
                )}
              </TabsList>
            </Tabs>
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-4 py-6 space-y-5">
            {/* Campaign checklist - mirrors backend flow (list → emails → inbox → campaign) */}
            <div className="rounded-2xl border border-border/60 bg-card/80 shadow-sm p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Campaign checklist
                </p>
                <span className="text-[10px] text-muted-foreground">
                  Must be done in order
                </span>
              </div>
              <ol className="space-y-2">
                {campaignChecklist.map((step) => {
                  const isBlockedByPrevious =
                    step.id > 1 && !campaignChecklist[step.id - 2].done;
                  return (
                    <li key={step.id} className="flex items-start gap-3 text-xs">
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                          step.done
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : isBlockedByPrevious
                              ? "border-border/70 bg-muted/60 text-muted-foreground"
                              : "border-primary/60 bg-primary/5 text-primary"
                        )}
                      >
                        {step.done ? "✓" : step.id}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "font-medium",
                            step.done
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-foreground"
                          )}
                        >
                          {step.label}
                        </p>
                        {!step.done && (
                          <p className="text-[11px] text-muted-foreground">
                            {step.requiredBefore}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            {activeChatLoading && !activeTab && !activeChatLoadError ? (
              <div className="rounded-2xl border border-border/60 bg-card/50 shadow-sm p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Loading conversation…</p>
              </div>
            ) : activeChatLoadError && activeChatId ? (
              <div className="rounded-2xl border border-border/60 bg-card/50 shadow-sm p-8 text-center">
                <p className="text-sm text-muted-foreground mb-4">Couldn&apos;t load this conversation.</p>
                <Button size="sm" variant="secondary" onClick={() => loadActiveChat(activeChatId)}>
                  Try again
                </Button>
              </div>
            ) : !activeTab?.messages?.length ? (
              <div className="space-y-5">
                {/* Default first message */}
                <div className="flex justify-start animate-in fade-in slide-in-from-left-2 duration-300">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 text-sm bg-card text-foreground border border-border/60 shadow-sm prose prose-sm max-w-none whitespace-pre-wrap">
                    {DEFAULT_GREETING}
                  </div>
                </div>
                {/* Empty state: friendly illustration + CTA */}
                <div className="rounded-2xl border border-border/60 bg-card/80 shadow-lg shadow-black/5 p-8 text-center animate-in fade-in duration-300">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary mb-5 shadow-inner">
                    <Megaphone className="h-8 w-8" />
                  </div>
                  <p className="font-semibold text-foreground text-lg mb-1">AI Campaign Studio</p>
                  <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto leading-relaxed">
                    Design high-converting, multi-step email journeys powered by AI. Map out your audience, craft tailored messages for every stage of the funnel, and let the studio optimize subject lines, timing, and variations to turn cold leads into loyal customers—on autopilot.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="rounded-full h-9 px-5 shadow-sm transition-all hover:shadow-md"
                      onClick={() => void handleGetStarted()}
                      disabled={isBusy}
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          Starting…
                        </>
                      ) : (
                        "Get started"
                      )}
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-block">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="rounded-full h-9 px-5 border-border/60"
                            onClick={() => void handleQuickAction("create_campaign")}
                            disabled={
                              !activeTab?.selectedListId ||
                              templatesInTab.length === 0 ||
                              (activeTab?.selectedInboxIds?.length ?? 0) === 0
                            }
                          >
                            <Megaphone className="h-3.5 w-3 mr-1.5" />
                            Create campaign
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {!activeTab?.selectedListId
                          ? "Select a contact list first"
                          : templatesInTab.length === 0
                            ? "Create at least one email in this chat first"
                            : (activeTab?.selectedInboxIds?.length ?? 0) === 0
                              ? "Select at least one sending inbox"
                              : "Create campaign"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
            ) : (
              <>
              {activeTab?.messages?.map((msg, idx) => {
                const isLastUserMessage = msg.role === "user" && idx === activeTab.messages.length - 1;
                const showStatus = isLastUserMessage && !isBusy;
                return (
                  <div key={msg.id} className="animate-in fade-in duration-200">
                    <OutreachChatMessage
                      message={msg}
                      selectedListId={activeTab?.selectedListId}
                      selectedInboxIds={activeTab?.selectedInboxIds ?? []}
                      onSelectList={msg.listCard ? handleSelectList : undefined}
                      onSelectInbox={msg.inboxCard ? handleSelectInbox : undefined}
                      onConfirmInboxSelection={msg.inboxCard ? handleConfirmInboxSelection : undefined}
                      startedCampaignIds={activeTab?.startedCampaignIds ?? []}
                      onDeleteTemplate={handleDeleteTemplateFromChat}
                      deletingTemplateId={deletingTemplateId}
                      domains={domains}
                      createdCampaignId={activeTab?.createdCampaignId ?? null}
                      onEditTemplate={(msg.templateCard || (msg.templateCards?.length ?? 0) > 0) ? openQuickEdit : undefined}
                      onPreviewTemplate={(msg.templateCard || (msg.templateCards?.length ?? 0) > 0) ? setPreviewTemplate : undefined}
                      onProceedToInbox={
                        msg.previewOrInboxChoice
                          ? () =>
                              addMessage({
                                role: "assistant",
                                content: "Which email account(s) should we send from? Pick one or more:",
                                inboxCard: { inboxes },
                              })
                          : undefined
                      }
                      onCreateCampaign={msg.showCreateCampaignButton ? () => void handleQuickAction("create_campaign") : undefined}
                      onSelectFormat={msg.formatCard ? (fmt) => void handleSelectFormat(fmt) : undefined}
                      taggedForUpdateTemplateId={activeTab?.taggedForUpdateTemplateId ?? null}
                      onTagForUpdate={handleTagForUpdate}
                    />
                    {showStatus && (
                      <div className="flex justify-end mt-0.5 mr-1">
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <CheckCheck className="h-3 w-3" />
                          Sent
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
              {isBusy && activeTab?.messages?.length && activeTab.messages[activeTab.messages.length - 1]?.role === "user" && (
                <div className="flex justify-start animate-in fade-in slide-in-from-left-2 duration-200">
                  <div className="rounded-2xl px-4 py-3 text-sm bg-card border border-border/60 rounded-bl-md text-muted-foreground flex items-center gap-2 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
                    <span className="font-medium">AI replying…</span>
                  </div>
                </div>
              )}
            </>
            )}
            <div ref={scrollBottomRef} />
          </div>
        </div>
        </div>

        {/* Right Sidebar: context + emails */}
        <aside className="hidden xl:flex w-[360px] xl:w-[380px] flex-shrink-0 border-l border-border/60 bg-card/30 flex-col overflow-hidden">
          <div className="flex flex-col h-full min-h-0 w-full">
            <div className="px-4 py-3 border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Emails in this chat
            </div>

            {/* This part scrolls independently */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {templatesInTab.length === 0 ? (
                <div className="p-4 text-center">
                  <div className="rounded-xl bg-muted/40 border border-dashed border-border/60 p-6 shadow-inner">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted/80 mb-3">
                      <FileText className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">Emails you create in this chat will show up here.</p>
                  </div>
                </div>
              ) : (
                <ul className="p-3 space-y-2 w-full">
              {templatesInTab.map((template) => (
                <li
                  key={template.id}
                  className="rounded-xl border border-border/60 bg-card shadow-sm p-3"
                >
                  <div
                    className="font-medium text-foreground text-sm sm:text-base break-words min-w-0"
                    title={template.name}
                  >
                    {template.name}
                  </div>
            
                  <p
                    className="text-xs sm:text-sm text-muted-foreground break-words mt-0.5 min-w-0"
                    title={template.subject}
                  >
                    {template.subject}
                  </p>
            
                  <div className="flex flex-col sm:flex-row gap-2 mt-3 min-w-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 sm:h-7 text-xs sm:text-sm rounded-lg flex-1 min-w-0 border-border/60"
                          onClick={() => setPreviewTemplate(template)}
                        >
                          <Eye className="h-3 w-3 shrink-0" />
                          <span className="truncate">Preview</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={6}>
                        Preview this email
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 sm:h-7 text-xs sm:text-sm rounded-lg flex-1 min-w-0 border-border/60"
                      onClick={() => openQuickEdit(template)}
                    >
                      <span className="gap-1 truncate justify-center flex items-center">
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">Edit</span>
                      </span>
                    </Button>
            
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-full sm:w-8 shrink-0 rounded-lg p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/5 flex items-center justify-center"
                          onClick={() => void handleDeleteTemplateFromChat(template.id)}
                          disabled={deletingTemplateId === template.id}
                        >
                          {deletingTemplateId === template.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      </TooltipTrigger>
            
                      <TooltipContent side="bottom" sideOffset={6}>
                        {deletingTemplateId === template.id ? "Deleting…" : "Delete this email"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </li>
              ))}
            </ul>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Onboarding hint for first-time users */}
      {!onboardingDismissed && (
        <div className="flex-shrink-0 border-b border-border/50 bg-primary/5 px-4 py-2.5 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <p className="text-xs text-foreground/90 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <span>Tip: Say &quot;Create a 3-step cold outreach&quot; or &quot;I need a welcome email&quot; to get started quickly.</span>
          </p>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-lg shrink-0" onClick={dismissOnboarding} aria-label="Dismiss">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Input area - modern chat bar with AI suggestions */}
      <div className="flex-shrink-0 border-t border-border/60 bg-background/95 backdrop-blur-md px-4 py-4 shadow-[0_-4px_24px_-4px_rgba(0,0,0,0.06)]">
        <div className="mx-auto max-w-2xl">
          {/* AI suggestion chips */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {aiSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setInputValue(suggestion)}
                className="text-xs px-3 py-1.5 rounded-lg bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50 transition-colors truncate max-w-[200px]"
              >
                {suggestion}
              </button>
            ))}
          </div>
          {activeTab?.taggedForUpdateTemplateId && (
            <div className="mb-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-foreground">
                  <span className="font-medium text-primary">Editing:</span>{" "}
                  <span className="text-muted-foreground">
                    {templates.find((t) => t.id === activeTab.taggedForUpdateTemplateId)?.name ?? "Template"}
                  </span>
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground shrink-0"
                  onClick={handleClearTag}
                >
                  Deselect
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Describe your changes in the message below (e.g. shorten the subject, add a call to action).
              </p>
            </div>
          )}
          <div className="flex gap-2 rounded-2xl border border-border/60 bg-card shadow-sm p-1.5 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 transition-all duration-200">
            <textarea
              ref={textareaRef}
              placeholder="Type your message... (Shift+Enter for new line)"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              disabled={isBusy}
              rows={1}
              className="flex-1 border-0 bg-transparent focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded-xl min-h-10 py-2.5 px-4 resize-none text-base md:text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 overflow-y-auto"
              style={{ maxHeight: textareaMaxHeightPx }}
            />
            <Button
              size="icon"
              className="h-10 w-10 rounded-xl shrink-0 self-end transition-transform hover:scale-105 active:scale-95"
              onClick={() => void handleSend()}
              disabled={!inputValue.trim() || isBusy || !activeChatId}
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="flex items-center justify-center gap-1.5 mt-2 text-[10px] text-muted-foreground/80">
            <Zap className="h-3 w-3 text-primary/70" />
            Powered by AI
          </p>
        </div>
      </div>

      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />

      <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewTemplate?.name}</DialogTitle>
            <DialogDescription>Email preview</DialogDescription>
          </DialogHeader>
          {previewTemplate && (
            <div className="space-y-4">
              {previewContact ? (
                <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 border border-border/50">
                  <strong>Preview with a random contact from your list:</strong>{" "}
                  {[previewContact.first_name, previewContact.last_name].filter(Boolean).join(" ") || previewContact.email}
                  {" — "}
                  {[previewContact.company, previewContact.industry].filter(Boolean).join(", ") || "Other placeholders from this contact."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 border border-border/50">
                  Select a contact list to preview with a real contact from that list.
                </p>
              )}
              <div className="p-4 rounded-lg bg-secondary">
                <p className="text-sm text-muted-foreground mb-1">Subject</p>
                <p className="font-medium">
                  {previewContact
                    ? replacePlaceholdersWithValues(previewTemplate.subject ?? "", contactToPreviewValues(previewContact))
                    : (previewTemplate.subject ?? "")}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Body</p>
                <IsolatedPreview
                  mode={previewTemplate.body_type === "plain" ? "plain" : "html"}
                  html={
                    previewContact
                      ? replacePlaceholdersWithValues(previewTemplate.body ?? "", contactToPreviewValues(previewContact))
                      : (previewTemplate.body ?? "")
                  }
                  plainText={
                    previewContact
                      ? replacePlaceholdersWithValues(previewTemplate.body ?? "", contactToPreviewValues(previewContact))
                      : (previewTemplate.body ?? "")
                  }
                  title="Template body preview"
                  className="min-h-[200px] max-h-[50vh] w-full rounded-lg border bg-white overflow-hidden"
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreviewTemplate(null)}>
              Close
            </Button>
            {previewTemplate && (
              <Button
                className="gradient-primary"
                onClick={() => {
                  openQuickEdit(previewTemplate);
                  setPreviewTemplate(null);
                }}
              >
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit Template
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!quickEditTemplate} onOpenChange={(open) => !open && closeQuickEdit()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{quickEditTemplate?.name ?? "Quick Edit Template"}</DialogTitle>
            <DialogDescription>Edit subject and body, or switch to Preview to see how it renders.</DialogDescription>
          </DialogHeader>
          {quickEditTemplate && (
            <Tabs defaultValue="edit" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="edit" className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="space-y-3 mt-4">
                <div className="space-y-1.5">
                  <Label htmlFor="quick-edit-subject">Subject</Label>
                  <Input
                    id="quick-edit-subject"
                    value={quickEditSubject}
                    onChange={(e) => setQuickEditSubject(e.target.value)}
                    placeholder="Email subject"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quick-edit-body">Body</Label>
                  <textarea
                    id="quick-edit-body"
                    value={quickEditBody}
                    onChange={(e) => setQuickEditBody(e.target.value)}
                    placeholder="Email body"
                    rows={14}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </TabsContent>
              <TabsContent value="preview" className="mt-4 space-y-4">
                {previewContact ? (
                  <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 border border-border/50">
                    <strong>Preview with a random contact from your list:</strong>{" "}
                    {[previewContact.first_name, previewContact.last_name].filter(Boolean).join(" ") || previewContact.email}
                    {" — "}
                    {[previewContact.company, previewContact.industry].filter(Boolean).join(", ") || "Other placeholders from this contact."}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 border border-border/50">
                    Select a contact list in this chat to preview merge fields (e.g. {"{{first_name}}"}) with a real contact.
                  </p>
                )}
                <div className="p-4 rounded-lg bg-secondary">
                  <p className="text-sm text-muted-foreground mb-1">Subject</p>
                  <p className="font-medium">
                    {previewContact
                      ? replacePlaceholdersWithValues(quickEditSubject, contactToPreviewValues(previewContact))
                      : quickEditSubject}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Body</p>
                  <IsolatedPreview
                    mode={quickEditTemplate.body_type === "plain" ? "plain" : "html"}
                    html={
                      previewContact
                        ? replacePlaceholdersWithValues(quickEditDraftBodyForPreview, contactToPreviewValues(previewContact))
                        : quickEditDraftBodyForPreview
                    }
                    plainText={
                      previewContact
                        ? replacePlaceholdersWithValues(quickEditDraftBodyForPreview, contactToPreviewValues(previewContact))
                        : quickEditDraftBodyForPreview
                    }
                    title="Quick edit preview"
                    className="min-h-[200px] max-h-[45vh] w-full rounded-lg border bg-white overflow-hidden"
                  />
                </div>
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeQuickEdit} disabled={isSavingQuickEdit}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSaveQuickEdit()} disabled={isSavingQuickEdit}>
              {isSavingQuickEdit ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename tab</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-tab-input">Tab name</Label>
            <Input
              id="rename-tab-input"
              value={renameTabTitle}
              onChange={(e) => { setRenameTabTitle(e.target.value); setRenameError(""); }}
              placeholder="e.g. Acme Outreach"
              onKeyDown={(e) => e.key === "Enter" && handleRenameTab()}
              className={renameError ? "border-destructive" : ""}
            />
            {renameError && <p className="text-xs text-destructive">{renameError}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleRenameTab} disabled={!renameTabTitle.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

