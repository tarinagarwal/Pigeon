"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Check,
  FileText,
  Sparkles,
  Loader2,
  Layers,
  ClipboardList,
  ListChecks,
  Search,
  ChevronDown,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import prompts from "./prompts.json";
import { useAuth } from "@/contexts/AuthContext";
import { useContactLists } from "@/hooks/useContacts";
import { api } from "@/lib/api";
import type { Contact, EmailTemplate } from "@/types/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PromptConfig = {
  id: string;
  name: string;
  description?: string;
  markdown: string;
};

export type AutomaticPromptMode = "json-import" | "classic";

type TemplateBodyFormatChoice = "plain" | "html" | "rich";

type ParsedVariation = { subject: string; body: string; body_type?: TemplateBodyFormatChoice };
type ParsedStep = { step_number: number; variations: ParsedVariation[] };
type FlatTemplateRow = {
  stepNum: number;
  varNum: number;
  subject: string;
  body: string;
  body_type: TemplateBodyFormatChoice;
};

function normalizeBodyType(raw: unknown): TemplateBodyFormatChoice | undefined {
  if (raw === "plain" || raw === "html" || raw === "rich") return raw;
  return undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_PROMPTS: PromptConfig[] = prompts as PromptConfig[];
const CONTACT_SAMPLE_SIZE = 50;
const STANDARD_FIELDS = ["first_name", "last_name", "email", "company", "industry"] as const;

const TONE_OPTIONS = [
  { value: "friendly", label: "Friendly & conversational" },
  { value: "professional", label: "Professional & formal" },
  { value: "direct", label: "Direct & concise" },
  { value: "witty", label: "Witty & light-hearted" },
  { value: "empathetic", label: "Empathetic & warm" },
] as const;

const CTA_OPTIONS = [
  { value: "soft", label: "Soft (open to a quick chat?)" },
  { value: "medium", label: "Medium (book a 15-min call)" },
  { value: "strong", label: "Strong (reply yes to get started)" },
] as const;

const EMAIL_LENGTH_OPTIONS = [
  {
    value: "short",
    label: "Short",
    desc: "3–5 lines. One punchy hook, one CTA. No fluff.",
  },
  {
    value: "medium",
    label: "Medium",
    desc: "6–10 lines. Hook, 1–2 value lines, soft CTA.",
  },
  {
    value: "long",
    label: "Long",
    desc: "11–18 lines. Hook, context, proof point, CTA.",
  },
  {
    value: "descriptive",
    label: "Descriptive",
    desc: "19+ lines. Full story, objection handling, strong CTA.",
  },
] as const;

const EMAIL_ANGLE_OPTIONS = [
  { value: "pain", label: "Pain-point / problem awareness" },
  { value: "benefit", label: "Key benefit / outcome" },
  { value: "social-proof", label: "Social proof / case study" },
  { value: "curiosity", label: "Curiosity / open loop" },
  { value: "pas", label: "PAS — Problem → Agitate → Solution" },
  { value: "fomo", label: "FOMO / urgency" },
  { value: "question", label: "Provocative question" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasNonEmpty(contact: Contact, key: string): boolean {
  if (STANDARD_FIELDS.includes(key as (typeof STANDARD_FIELDS)[number])) {
    const value = contact[key as keyof Contact];
    return value !== undefined && value !== null && String(value).trim() !== "";
  }
  const customFields = contact.custom_fields;
  if (
    customFields &&
    typeof customFields === "object" &&
    !Array.isArray(customFields) &&
    key in customFields
  ) {
    const value = customFields[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  }
  return false;
}

function getCommonVariableNames(contacts: Contact[]): string[] {
  if (contacts.length === 0) return [];
  const candidateKeys = new Set<string>(STANDARD_FIELDS);
  for (const contact of contacts) {
    const customFields = contact.custom_fields;
    if (
      customFields &&
      typeof customFields === "object" &&
      !Array.isArray(customFields)
    ) {
      for (const key of Object.keys(customFields)) {
        candidateKeys.add(key);
      }
    }
  }
  const common: string[] = [];
  for (const key of candidateKeys) {
    if (contacts.every((contact) => hasNonEmpty(contact, key))) {
      common.push(key);
    }
  }
  return common.sort();
}

function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s)>,]+/i);
  return m?.[0] ?? null;
}

function normalizePromptMarkdown(markdown: string): string {
  if (!markdown) return "";
  let cleaned = markdown;
  cleaned = cleaned.replace(/^\s*#{1,6}\s+.+$/gm, "").trim();
  cleaned = cleaned
    .replace(/^\s*[\*\u2022\u2013-]\s+/gm, "- ")
    .replace(/^\s*\d+\.\s+/gm, "- ");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildAutomaticPrompt(args: {
  emailDetails: string;
  productDetails: string;
  productUrl: string;
  sequenceCount: number;
  variationCount: number;
  selectedListName: string;
  commonVariables: string[];
  mode: AutomaticPromptMode;
  tone: string;
  icpDescription: string;
  ctaStyle: string;
  emailAngles: string[];
  senderName: string;
  senderTitle: string;
  brandName: string;
  emailLength: string;
  bodyFormat: TemplateBodyFormatChoice;
}): string {
  const {
    emailDetails,
    productDetails,
    productUrl,
    sequenceCount,
    variationCount,
    selectedListName,
    commonVariables,
    mode,
    tone,
    icpDescription,
    ctaStyle,
    emailAngles,
    senderName,
    senderTitle,
    brandName,
    emailLength,
    bodyFormat,
  } = args;

  const finalProductUrl = productUrl?.trim() || extractFirstUrl(productDetails) || "https://yourwebsite.com";
  const commonVariablePlaceholders =
    commonVariables.length > 0
      ? commonVariables.map((key) => `{{${key}}}`).join(", ")
      : "(No common variables found from sampled contacts. Use only known-safe defaults like {{company}} when available.)";

  const toneLabel = TONE_OPTIONS.find((o) => o.value === tone)?.label || tone || "Friendly & conversational";
  const ctaLabel = CTA_OPTIONS.find((o) => o.value === ctaStyle)?.label || ctaStyle || "Soft";
  const lengthOpt = EMAIL_LENGTH_OPTIONS.find((o) => o.value === emailLength);
  const lengthInstruction = lengthOpt
    ? `${lengthOpt.label} — ${lengthOpt.desc}`
    : "Medium — 6–10 lines.";

  const angleLines =
    emailAngles.length > 0
      ? emailAngles
          .map((a) => {
            const opt = EMAIL_ANGLE_OPTIONS.find((o) => o.value === a);
            if (a === "pas") {
              return "- **PAS** — Problem → Agitate → Solution: Identify the prospect's problem, amplify the pain, then present your solution as the clear answer.";
            }
            return `- ${opt?.label ?? a}`;
          })
          .join("\n")
      : "- Pain-point / problem awareness\n- Key benefit / outcome";

  const perBlockIntro =
    mode === "json-import"
      ? "Per-template content requirements (each object in variations):"
      : "Per-email content requirements (each variation):";

  const bodyFormatLabel =
    bodyFormat === "plain" ? "PLAIN TEXT" : bodyFormat === "html" ? "HTML" : "RICH TEXT (semantic HTML for the rich-text editor)";
  const bodyFormatBullets =
    bodyFormat === "plain"
      ? `- **Body format: PLAIN TEXT** — Each body must be plain text only: real line breaks, no HTML tags, no markdown. For JSON output, use \\n for newlines inside strings.`
      : bodyFormat === "html"
        ? `- **Body format: HTML** — Each body must be HTML for email: inline CSS on block elements (e.g. <p>, <div>), use <p>, <br>, <strong>, <a>. No external stylesheets, scripts, tracking pixels, or images.`
        : `- **Body format: RICH TEXT** — Each body must be semantic HTML suitable for a rich-text email editor: <p>, lists, <strong>, <a> with inline styles. Same deliverability rules as HTML — no external CSS, scripts, or images.`;

  const sharedBody = `Act as a senior B2B cold email copywriter and deliverability expert.

## Body format (required): ${bodyFormatLabel}
${bodyFormatBullets}

## Product / Service
${productDetails?.trim() ? productDetails.trim() : "My product or service (fill in details here)."}
Website / link: ${finalProductUrl}

## Brand / Sender Details
${brandName ? `- Brand name: ${brandName}` : ""}
${senderName ? `- Default sender name: ${senderName}` : "- Sender name variable: {{inbox_name}}"}
${senderTitle ? `- Sender title / role: ${senderTitle}` : ""}

## Campaign Context
${emailDetails?.trim() ? emailDetails.trim() : "No extra campaign context provided."}
- Target contact list: ${selectedListName || "Not specified"}
- Ideal Customer Profile (ICP): ${icpDescription?.trim() || "Not specified — infer from product context."}

## Sequence Structure
- Sequence steps requested: ${sequenceCount}
- Variations per step: ${variationCount}
- Step 1 = initial cold outreach; steps 2+ = follow-ups with continuity.
- For each step, produce exactly **${variationCount}** variations.

## Merge Variables
Common merge variables found from sampling ${CONTACT_SAMPLE_SIZE} contacts: ${commonVariablePlaceholders}

Available variables (use double curly braces exactly):
- {{first_name}} — Prospect first name
- {{last_name}} — Prospect last name (may be empty)
- {{email}} — Prospect email address
- {{company}} — Prospect company name
- {{industry}} — Prospect industry or niche
- {{inbox_name}} — Sender first name (from sending inbox). Use ONLY in signature.
- {{inbox_email}} — Sender email address. Use ONLY in signature if needed.

**CRITICAL:** Only use merge variables listed above that are available in the sampled list. Do NOT invent any other {{variable}} placeholders.

## Writing Style & Tone
- Tone: ${toneLabel}
- Email length: **${lengthInstruction}**
- Do NOT use the prospect's first name to open emails (use company personalization instead).
- Start with a spin-text greeting, e.g.: {Hi {{company}} | Hello {{company}} | Just a quick note for {{company}} | Hope things are going well at {{company}}}
${bodyFormat === "plain" ? "- No HTML in bodies — plain text only." : "- No images, no buttons as image-only CTAs; keep markup simple and inbox-safe."}
- No emojis, no attachments, no heavy CSS, no tracking pixels.
- Avoid spam-trigger words: free, guarantee, offer, buy now, discount, limited time, $$$, etc.
- No "Re:" in subject lines.

## Call-to-Action Style
${ctaLabel} — examples for soft: "open to a quick look?", "happy to share more", "worth a 10-minute chat?". Adjust according to chosen CTA style.
Max 1 link per email, pointing to: ${finalProductUrl}

## Email Angles (rotate across variations)
${angleLines}

${perBlockIntro}
- A **spun subject line** using \`{ option 1 | option 2 | option 3 }\` spintax format.
- Full **body** in the format above (${bodyFormat === "plain" ? "plain text" : "HTML"}). Use spin text in multiple lines of the body.
- Short human signature using {{inbox_name}}${senderTitle ? ` and title "${senderTitle}"` : ""}${senderName ? ` (default: "${senderName}")` : ""}.

`;

  const defaultBodyTypeJson = bodyFormat;
  const jsonOutputSection = `## REQUIRED OUTPUT — JSON INSIDE A MARKDOWN CODE BLOCK

Your **entire** reply must be **one** Markdown fenced code block:

1. First line: \`\`\`json
2. Body: the **raw JSON object only** (no markdown inside the fence).
3. Last line: \`\`\`

Do **not** put any text, headings, or prose before or after that single code block.

The JSON must match this shape (default template body type for Pigeon is **"${defaultBodyTypeJson}"**):

{
  "body_type": "${defaultBodyTypeJson}",
  "steps": [
    {
      "step_number": 1,
      "variations": [
        { "subject": "string with spintax", "body": "string (${bodyFormat === "plain" ? "plain text" : "HTML"})" },
        { "subject": "…", "body": "…", "body_type": "plain" }
      ]
    }
  ]
}

Rules:
- Root object must have a \`steps\` array.
- Optional root \`body_type\`: \`"plain"\`, \`"html"\`, or \`"rich"\`. Sets the default for every variation when imported into Pigeon. If omitted, importers use **"${defaultBodyTypeJson}"** from this prompt.
- Optional per-variation \`body_type\` overrides the root default for that template only.
- \`steps.length\` must equal **${sequenceCount}** exactly.
- Each step must have \`step_number\` from 1 to ${sequenceCount} in order.
- Each step's \`variations\` array must have length **${variationCount}** exactly.
- Each variation must have non-empty string \`subject\` and \`body\`.
- Escape any double quotes inside JSON strings; use \\n for newlines in body if needed.`;

  const classicBodyLabel =
    bodyFormat === "plain" ? "**Plain body:**" : bodyFormat === "html" ? "**HTML body:**" : "**HTML body (rich text):**";
  const classicFence = bodyFormat === "plain" ? "text" : "html";

  const classicOutputSection = `## REQUIRED OUTPUT — READABLE TEXT (NOT JSON)

Do **not** output JSON. Use **clear sections** so each subject and body can be copied manually.

For **each** sequence step (1 through ${sequenceCount}) and **each** variation (1 through ${variationCount}), output:

1. Heading: **Step S — Variation V** (e.g. **Step 1 — Variation 1**).
2. Line: **Subject (spin):** followed by the spintax subject.
3. Line: ${classicBodyLabel} followed by the full ${bodyFormat === "plain" ? "plain text" : "HTML"} in a \`\`\`${classicFence} ... \`\`\` code block.

**Order:** complete Step 1 (all ${variationCount} variations), then Step 2, and so on.
**Total:** ${sequenceCount} × ${variationCount} = **${sequenceCount * variationCount}** emails.`;

  return sharedBody + (mode === "json-import" ? jsonOutputSection : classicOutputSection);
}

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

function extractJsonBlock(raw: string): string {
  const t = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(t);
  if (fence) return fence[1].trim();
  const loose = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (loose) return loose[1].trim();
  return t;
}

function parseTemplatesJson(raw: string): { steps: ParsedStep[]; globalBodyType?: TemplateBodyFormatChoice } {
  const text = extractJsonBlock(raw);
  const data = JSON.parse(text) as unknown;

  if (Array.isArray(data)) {
    const rows = data as Record<string, unknown>[];
    const hasStepHint = rows.some(
      (row) => row.sequence_step != null || row.step_number != null || row.step != null
    );
    if (!hasStepHint) {
      const variations: ParsedVariation[] = [];
      for (const row of rows) {
        const subject = String(row.subject ?? "").trim();
        const body = String(row.body ?? "").trim();
        const bt = normalizeBodyType(row.body_type);
        if (subject && body) {
          variations.push(bt ? { subject, body, body_type: bt } : { subject, body });
        }
      }
      if (variations.length === 0) {
        throw new Error("Array JSON must include subject and body on each row.");
      }
      return { steps: [{ step_number: 1, variations }] };
    }
    const steps: ParsedStep[] = [];
    for (const row of rows) {
      const subject = String(row.subject ?? "").trim();
      const body = String(row.body ?? "").trim();
      const stepNum = Number(row.sequence_step ?? row.step_number ?? row.step);
      if (!Number.isFinite(stepNum) || stepNum < 1) continue;
      if (!subject || !body) continue;
      const bt = normalizeBodyType(row.body_type);
      let step = steps.find((s) => s.step_number === stepNum);
      if (!step) {
        step = { step_number: stepNum, variations: [] };
        steps.push(step);
      }
      step.variations.push(bt ? { subject, body, body_type: bt } : { subject, body });
    }
    steps.sort((a, b) => a.step_number - b.step_number);
    if (steps.length === 0) {
      throw new Error("No valid rows with sequence_step / step_number and subject/body.");
    }
    return { steps };
  }

  if (
    data &&
    typeof data === "object" &&
    "steps" in data &&
    Array.isArray((data as { steps: unknown }).steps)
  ) {
    const root = data as { steps: ParsedStep[]; body_type?: unknown };
    const globalBodyType = normalizeBodyType(root.body_type);
    const mapped = root.steps.map((s, idx) => ({
      step_number: Number(s.step_number ?? idx + 1),
      variations: (s.variations ?? []).map((v) => {
        const subject = String(v.subject ?? "").trim();
        const body = String(v.body ?? "").trim();
        const bt = normalizeBodyType(v.body_type);
        const base: ParsedVariation = { subject, body };
        if (bt) base.body_type = bt;
        return base;
      }),
    }));
    return { steps: mapped, ...(globalBodyType ? { globalBodyType } : {}) };
  }

  throw new Error(
    'JSON must be an object with a "steps" array, or a flat array of { subject, body, sequence_step }.'
  );
}

function flattenParsedSteps(
  steps: ParsedStep[],
  globalBodyType: TemplateBodyFormatChoice | undefined,
  fallback: TemplateBodyFormatChoice
): FlatTemplateRow[] {
  const flat: FlatTemplateRow[] = [];
  for (const step of steps) {
    const stepNum = step.step_number;
    let v = 0;
    for (const vrow of step.variations) {
      if (!vrow.subject.trim() || !vrow.body.trim()) continue;
      v += 1;
      const body_type = vrow.body_type ?? globalBodyType ?? fallback;
      flat.push({ stepNum, varNum: v, subject: vrow.subject, body: vrow.body, body_type });
    }
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TemplatePromptsPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const queryClient = useQueryClient();
  const { data: contactLists = [], isLoading: listsLoading } = useContactLists(userId);

  // UI state
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activePromptId, setActivePromptId] = useState<string>(ALL_PROMPTS[0]?.id ?? "");
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({});
  const [promptSearch, setPromptSearch] = useState("");
  const [expandedPromptIds, setExpandedPromptIds] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Prompt builder fields
  const [productDetails, setProductDetails] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [brandName, setBrandName] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderTitle, setSenderTitle] = useState("");
  const [emailDetails, setEmailDetails] = useState("");
  const [icpDescription, setIcpDescription] = useState("");
  const [tone, setTone] = useState<string>("friendly");
  const [ctaStyle, setCtaStyle] = useState<string>("soft");
  const [emailLength, setEmailLength] = useState<string>("medium");
  const [emailAngles, setEmailAngles] = useState<string[]>(["pain", "benefit"]);
  const [selectedListId, setSelectedListId] = useState("");
  const [isAnalyzingList, setIsAnalyzingList] = useState(false);
  const [commonVariables, setCommonVariables] = useState<string[]>([]);
  const [analyzedContactsCount, setAnalyzedContactsCount] = useState(0);
  const [sequenceCount, setSequenceCount] = useState("3");
  const [variationCount, setVariationCount] = useState("3");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [promptMode, setPromptMode] = useState<AutomaticPromptMode>("json-import");
  const [templateBodyFormat, setTemplateBodyFormat] = useState<TemplateBodyFormatChoice>("rich");

  // Import state
  const [templateBaseName, setTemplateBaseName] = useState("");
  const [pastedJson, setPastedJson] = useState("");
  const [isCreatingTemplates, setIsCreatingTemplates] = useState(false);
  const [createProgress, setCreateProgress] = useState<{ current: number; total: number } | null>(null);
  const [lastImportCount, setLastImportCount] = useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const selectedList = useMemo(
    () => contactLists.find((list) => list.id === selectedListId),
    [contactLists, selectedListId]
  );

  const expectedTemplateTotal = useMemo(() => {
    const s = Number.parseInt(sequenceCount, 10);
    const v = Number.parseInt(variationCount, 10);
    if (Number.isNaN(s) || Number.isNaN(v) || s < 1 || v < 1) return null;
    return s * v;
  }, [sequenceCount, variationCount]);

  const filteredPrompts = useMemo(
    () =>
      promptSearch.trim() === ""
        ? ALL_PROMPTS
        : ALL_PROMPTS.filter(
            (p) =>
              p.name.toLowerCase().includes(promptSearch.toLowerCase()) ||
              (p.description?.toLowerCase().includes(promptSearch.toLowerCase()) ?? false)
          ),
    [promptSearch]
  );

  const jsonImportPreview = useMemo(() => {
    if (!pastedJson.trim()) return { status: "empty" as const };
    try {
      const { steps, globalBodyType } = parseTemplatesJson(pastedJson);
      const flat = flattenParsedSteps(steps, globalBodyType, templateBodyFormat);
      if (flat.length === 0) {
        return { status: "no-rows" as const, message: "JSON parsed but no subject/body pairs were found." };
      }
      const base = templateBaseName.trim() || "Template";
      const sampleNames = flat.slice(0, 6).map((r) => `${base} - S${r.stepNum} - V${r.varNum}`);
      return {
        status: "ok" as const,
        count: flat.length,
        sampleNames,
        more: Math.max(0, flat.length - sampleNames.length),
      };
    } catch (e) {
      return { status: "error" as const, message: e instanceof Error ? e.message : "Could not parse JSON." };
    }
  }, [pastedJson, templateBaseName, templateBodyFormat]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const togglePromptExpand = (id: string) => {
    setExpandedPromptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = (promptId: string, text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(promptId);
        toast.success("Prompt copied");
        setTimeout(() => setCopiedId(null), 1800);
      })
      .catch(() => toast.error("Failed to copy prompt"));
  };

  const toggleEmailAngle = (value: string) => {
    setEmailAngles((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]
    );
  };

  const analyzeSelectedListContacts = async (showToast = true) => {
    if (!selectedListId) {
      toast.error("Select a contact list first");
      return null;
    }
    try {
      setIsAnalyzingList(true);
      const { contacts } = await api.contactLists.getContacts(selectedListId, 0, CONTACT_SAMPLE_SIZE);
      const nextCommonVariables = getCommonVariableNames(contacts);
      setCommonVariables(nextCommonVariables);
      setAnalyzedContactsCount(contacts.length);
      if (showToast) {
        const summary =
          nextCommonVariables.length > 0
            ? nextCommonVariables.map((k) => `{{${k}}}`).join(", ")
            : "none found";
        toast.success(`Sampled ${contacts.length} contacts. Common variables: ${summary}`);
      }
      return { contactsCount: contacts.length, variableNames: nextCommonVariables };
    } catch (error) {
      console.error("Failed to analyze selected list", error);
      toast.error("Failed to analyze the selected list");
      return null;
    } finally {
      setIsAnalyzingList(false);
    }
  };

  const handleGenerateAutomaticPrompt = async () => {
    const parsedSequence = Number.parseInt(sequenceCount, 10);
    const parsedVariations = Number.parseInt(variationCount, 10);
    if (!selectedListId) { toast.error("Please select a contact list"); return; }
    if (Number.isNaN(parsedSequence) || parsedSequence < 1) { toast.error("Sequence count must be at least 1"); return; }
    if (Number.isNaN(parsedVariations) || parsedVariations < 1) { toast.error("Variation count must be at least 1"); return; }

    const analysis = await analyzeSelectedListContacts(true);
    if (!analysis) return;

    const promptText = buildAutomaticPrompt({
      emailDetails: emailDetails.trim(),
      productDetails: productDetails.trim(),
      productUrl: productUrl.trim(),
      sequenceCount: parsedSequence,
      variationCount: parsedVariations,
      selectedListName: selectedList?.name ?? selectedListId,
      commonVariables: analysis.variableNames,
      mode: promptMode,
      tone,
      icpDescription: icpDescription.trim(),
      ctaStyle,
      emailAngles,
      senderName: senderName.trim(),
      senderTitle: senderTitle.trim(),
      brandName: brandName.trim(),
      emailLength,
      bodyFormat: templateBodyFormat,
    });
    setGeneratedPrompt(promptText);
    toast.success("Prompt generated");
  };

  const handleCreateTemplatesFromJson = async () => {
    if (!userId) { toast.error("Sign in to create templates"); return; }
    const base = templateBaseName.trim() || "Template";
    let parsed: { steps: ParsedStep[]; globalBodyType?: TemplateBodyFormatChoice };
    try {
      parsed = parseTemplatesJson(pastedJson);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Invalid JSON");
      return;
    }
    const flat = flattenParsedSteps(parsed.steps, parsed.globalBodyType, templateBodyFormat);
    if (flat.length === 0) { toast.error("No valid subject/body pairs found in JSON"); return; }

    setIsCreatingTemplates(true);
    setCreateProgress({ current: 0, total: flat.length });
    setLastImportCount(null);
    try {
      const now = new Date().toISOString();
      let i = 0;
      for (const row of flat) {
        i += 1;
        setCreateProgress({ current: i, total: flat.length });
        const name = `${base} - S${row.stepNum} - V${row.varNum}`;
        const tpl: EmailTemplate = {
          id: crypto.randomUUID(),
          user_id: userId,
          name,
          subject: row.subject,
          body: row.body,
          body_type: row.body_type,
          sequence_number: row.stepNum,
          created_at: now,
          updated_at: now,
        };
        await api.templates.create(tpl);
      }
      queryClient.invalidateQueries({ queryKey: ["templates", userId] });
      setLastImportCount(flat.length);
      toast.success(`Created ${flat.length} template${flat.length === 1 ? "" : "s"}`);
    } catch (error) {
      console.error("Bulk template create failed", error);
      toast.error(error instanceof Error ? error.message : "Failed to create templates");
    } finally {
      setIsCreatingTemplates(false);
      setCreateProgress(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen space-y-6 pb-12">
      {/* Page header */}
      <section className="flex flex-col gap-4">
        <Link href="/templates">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground hover:text-foreground hover:bg-muted/60">
            <ArrowLeft className="w-4 h-4" />
            Back to Templates
          </Button>
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Prompt Library</h1>
          <p className="text-muted-foreground text-sm max-w-xl">
            Save and reuse high-quality prompts for generating cold email templates. Copy a prompt,
            paste it into your AI tool of choice, and customise as needed.
          </p>
        </div>
      </section>

      <Tabs defaultValue="automatic" className="w-full">
        <TabsList className="h-10">
          <TabsTrigger value="automatic" className="gap-2">
            <Sparkles className="w-4 h-4" />
            Prompt Generator
          </TabsTrigger>
          <TabsTrigger value="prompt" className="gap-2">
            <FileText className="w-4 h-4" />
            Prompt Library
          </TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------------ */}
        {/* Tab: Static prompts                                                  */}
        {/* ------------------------------------------------------------------ */}
        <TabsContent value="prompt" className="mt-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search prompts…"
              value={promptSearch}
              onChange={(e) => setPromptSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* TOC */}
          <div className="rounded-lg border border-border bg-muted/40">
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Table of contents
              </p>
              <p className="text-xs text-muted-foreground">
                {filteredPrompts.length}{filteredPrompts.length !== ALL_PROMPTS.length ? ` of ${ALL_PROMPTS.length}` : ""} prompt{ALL_PROMPTS.length !== 1 ? "s" : ""}
              </p>
            </div>
            {filteredPrompts.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">No prompts match your search.</p>
            ) : (
              <div className="divide-y divide-border/60 text-xs sm:text-sm">
                {filteredPrompts.map((prompt, index) => (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={() => {
                      setActivePromptId(prompt.id);
                      if (!expandedPromptIds.has(prompt.id)) togglePromptExpand(prompt.id);
                      setTimeout(() => {
                        document.getElementById(prompt.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 60);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      activePromptId === prompt.id
                        ? "bg-background text-primary"
                        : "hover:bg-muted/80 text-foreground"
                    }`}
                  >
                    <span className="w-5 text-[0.7rem] font-mono text-muted-foreground shrink-0">{index + 1}.</span>
                    <span className="flex-1 truncate">{prompt.name}</span>
                    {expandedPromptIds.has(prompt.id) && (
                      <span className="text-[0.65rem] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5 shrink-0">Open</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Prompt cards — collapsible */}
          <div className="space-y-2">
            {filteredPrompts.map((prompt) => {
              const isExpanded = expandedPromptIds.has(prompt.id);
              const promptText = editedPrompts[prompt.id] ?? normalizePromptMarkdown(prompt.markdown);
              return (
                <Collapsible
                  key={prompt.id}
                  open={isExpanded}
                  onOpenChange={() => {
                    setActivePromptId(prompt.id);
                    togglePromptExpand(prompt.id);
                  }}
                >
                  <div id={prompt.id} className="rounded-xl border bg-card scroll-mt-24 overflow-hidden">
                    {/* Card header — always visible */}
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground leading-snug">{prompt.name}</p>
                          {prompt.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                              {prompt.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 mt-0.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="gap-1.5 h-7 text-xs px-2.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(prompt.id, promptText);
                            }}
                          >
                            {copiedId === prompt.id ? (
                              <><Check className="w-3 h-3" />Copied</>
                            ) : (
                              <><Copy className="w-3 h-3" />Copy</>
                            )}
                          </Button>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform duration-200",
                              isExpanded && "rotate-180"
                            )}
                          />
                        </div>
                      </button>
                    </CollapsibleTrigger>

                    {/* Expandable prompt body */}
                    <CollapsibleContent>
                      <div className="border-t border-border/60 px-4 pb-4 pt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                            Prompt text — editable
                          </p>
                          <p className="text-[0.7rem] text-muted-foreground">
                            {promptText.length.toLocaleString()} chars
                          </p>
                        </div>
                        <textarea
                          className="w-full max-h-[600px] min-h-[280px] overflow-y-auto rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm font-mono leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          value={promptText}
                          onChange={(e) =>
                            setEditedPrompts((prev) => ({ ...prev, [prompt.id]: e.target.value }))
                          }
                        />
                        <div className="flex justify-end">
                          <Button
                            variant="default"
                            size="sm"
                            className="gap-1.5 h-8"
                            onClick={() => handleCopy(prompt.id, promptText)}
                          >
                            {copiedId === prompt.id ? (
                              <><Check className="w-3.5 h-3.5" />Copied!</>
                            ) : (
                              <><Copy className="w-3.5 h-3.5" />Copy prompt</>
                            )}
                          </Button>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </TabsContent>

        {/* ------------------------------------------------------------------ */}
        {/* Tab: Automatic Prompt Generator                                      */}
        {/* ------------------------------------------------------------------ */}
        <TabsContent value="automatic" className="mt-4 space-y-4">

          {/* How it works banner — compact */}
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">How it works</p>
            <ol className="grid gap-2 sm:grid-cols-3 text-xs">
              {[
                {
                  n: 1,
                  title: "Configure",
                  body: "Fill in product, audience, tone & sequence — then generate the prompt.",
                },
                {
                  n: 2,
                  title: "Run in your AI",
                  body:
                    promptMode === "json-import"
                      ? "Paste into ChatGPT / Claude. The AI replies with JSON."
                      : "Paste into your AI. Copy each Step / Variation block manually.",
                },
                {
                  n: 3,
                  title: promptMode === "json-import" ? "Import" : "Create",
                  body:
                    promptMode === "json-import"
                      ? "Paste the JSON below — templates are created automatically."
                      : "Open Templates → New and create one template per block.",
                },
              ].map(({ n, title, body }) => (
                <li key={n} className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[0.65rem] font-bold text-primary mt-0.5">
                    {n}
                  </span>
                  <span>
                    <span className="font-semibold text-foreground">{title} — </span>
                    <span className="text-muted-foreground leading-relaxed">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Success banner */}
          {lastImportCount !== null && (
            <Alert className="border-green-500/30 bg-green-500/5">
              <ListChecks className="h-4 w-4 text-green-600 dark:text-green-500" />
              <AlertTitle className="text-green-800 dark:text-green-200">
                {lastImportCount} template{lastImportCount === 1 ? "" : "s"} saved
              </AlertTitle>
              <AlertDescription className="text-green-800/90 dark:text-green-200/90 flex flex-wrap items-center gap-2">
                They are ready to use in campaigns.
                <Button variant="outline" size="sm" className="h-8 border-green-600/40" asChild>
                  <Link href="/templates">View templates</Link>
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => setLastImportCount(null)}>
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Card className="border bg-card">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold tracking-tight">Automatic Prompt Generator</CardTitle>
                  <CardDescription className="mt-1.5 max-w-2xl text-sm leading-relaxed">
                    {promptMode === "json-import"
                      ? "The AI returns JSON you can paste back to create many templates at once."
                      : "The AI returns readable sections (no JSON). Copy each subject and body into templates yourself."}
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="w-fit shrink-0 gap-1 font-normal">
                  {promptMode === "json-import" ? <><Layers className="h-3.5 w-3.5" />JSON import</> : <><FileText className="h-3.5 w-3.5" />Classic prompt</>}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-0 p-0">

              {/* Mode selector */}
              <div className="border-b border-border bg-muted/25 px-5 py-4 sm:px-6">
                <Label className="text-sm font-semibold text-foreground">Prompt output style</Label>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  Choose whether the AI should reply with structured JSON (bulk import) or plain Step/Variation text (manual copy).
                </p>
                <RadioGroup
                  value={promptMode}
                  onValueChange={(v) => {
                    setPromptMode(v as AutomaticPromptMode);
                    setGeneratedPrompt("");
                    if (v === "classic") setPastedJson("");
                  }}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {[
                    {
                      value: "json-import",
                      label: "JSON import",
                      desc: "AI returns one json block — paste here to create all templates automatically.",
                    },
                    {
                      value: "classic",
                      label: "Classic (no JSON)",
                      desc: "AI writes labeled steps and HTML — you copy each into templates manually.",
                    },
                  ].map((opt) => (
                    <div key={opt.value}>
                      <label
                        htmlFor={`mode-${opt.value}`}
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                          promptMode === opt.value
                            ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                            : "border-border bg-background hover:bg-muted/50"
                        )}
                      >
                        <RadioGroupItem value={opt.value} id={`mode-${opt.value}`} className="mt-0.5" />
                        <span className="space-y-1 min-w-0">
                          <span className="block text-sm font-medium text-foreground">{opt.label}</span>
                          <span className="block text-xs text-muted-foreground leading-snug">{opt.desc}</span>
                        </span>
                      </label>
                    </div>
                  ))}
                </RadioGroup>

                <div className="mt-5 pt-5 border-t border-border space-y-2">
                  <Label htmlFor="template-body-format" className="text-sm font-semibold text-foreground">
                    Default template body format
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Used in the generated prompt and when creating templates from JSON if the JSON omits{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">body_type</code>. You can set a root{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">body_type</code> or per-variation{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">body_type</code> in the JSON to override.
                  </p>
                  <Select
                    value={templateBodyFormat}
                    onValueChange={(v) => setTemplateBodyFormat(v as TemplateBodyFormatChoice)}
                  >
                    <SelectTrigger id="template-body-format" className="w-full max-w-xs bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="plain">Plain text</SelectItem>
                      <SelectItem value="html">HTML</SelectItem>
                      <SelectItem value="rich">Rich text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* ---- Step 1: Build prompt ---- */}
              <div className="p-5 sm:p-6 space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[0.7rem] text-primary-foreground">1</span>
                    Configure your prompt
                  </div>
                </div>

                {/* Product / Service */}
                <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product / Service</p>

                  <div className="space-y-2">
                    <Label htmlFor="product-details">
                      Description
                      <span className="ml-1.5 text-[0.7rem] font-normal text-muted-foreground">what you sell &amp; who it's for</span>
                    </Label>
                    <Textarea
                      id="product-details"
                      placeholder="Describe what your product or service does and who it's for."
                      value={productDetails}
                      onChange={(e) => setProductDetails(e.target.value)}
                      className="min-h-[80px] resize-y"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="product-url">Website / Landing page URL</Label>
                      <Input
                        id="product-url"
                        placeholder="https://yourproduct.com"
                        value={productUrl}
                        onChange={(e) => setProductUrl(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">Used as the single link per email.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="brand-name">Brand / Company name</Label>
                      <Input
                        id="brand-name"
                        placeholder="Acme Inc."
                        value={brandName}
                        onChange={(e) => setBrandName(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Campaign context — essentials */}
                <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaign Details</p>

                  <div className="space-y-2">
                    <Label htmlFor="email-details">What should the emails say?</Label>
                    <Textarea
                      id="email-details"
                      placeholder="Campaign angle, offer, key value props, things to avoid…"
                      value={emailDetails}
                      onChange={(e) => setEmailDetails(e.target.value)}
                      className="min-h-[80px] resize-y"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="tone-select">Writing tone</Label>
                      <Select value={tone} onValueChange={setTone}>
                        <SelectTrigger id="tone-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TONE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cta-select">CTA style</Label>
                      <Select value={ctaStyle} onValueChange={setCtaStyle}>
                        <SelectTrigger id="cta-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CTA_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Email length</Label>
                    <RadioGroup
                      value={emailLength}
                      onValueChange={setEmailLength}
                      className="grid gap-2 sm:grid-cols-4"
                    >
                      {EMAIL_LENGTH_OPTIONS.map((opt) => (
                        <div key={opt.value}>
                          <label
                            htmlFor={`length-${opt.value}`}
                            className={cn(
                              "flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors",
                              emailLength === opt.value
                                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                : "border-border bg-background hover:bg-muted/50"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value={opt.value} id={`length-${opt.value}`} />
                              <span className="text-sm font-medium text-foreground">{opt.label}</span>
                            </div>
                            <span className="text-xs text-muted-foreground leading-snug pl-6">{opt.desc}</span>
                          </label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </div>

                {/* Contact list */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-foreground">
                      Contact list
                      <span className="ml-1.5 text-[0.7rem] font-normal text-muted-foreground">required for merge variables</span>
                    </Label>
                    {contactLists.length === 0 && !listsLoading && (
                      <span className="text-xs text-amber-600 dark:text-amber-500">
                        <Link href="/contacts" className="underline underline-offset-2 hover:text-amber-700">Create a list</Link> first
                      </span>
                    )}
                  </div>
                  <Select
                    value={selectedListId}
                    onValueChange={(value) => {
                      setSelectedListId(value);
                      setCommonVariables([]);
                      setAnalyzedContactsCount(0);
                      setGeneratedPrompt("");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={listsLoading ? "Loading lists…" : "Choose a list"} />
                    </SelectTrigger>
                    <SelectContent>
                      {contactLists.length === 0 ? (
                        <SelectItem value="__no_lists" disabled>No contact lists yet</SelectItem>
                      ) : (
                        contactLists.map((list) => {
                          const count = list.contact_count ?? list.contact_ids?.length ?? 0;
                          return (
                            <SelectItem key={list.id} value={list.id}>
                              {list.name} ({count} contacts)
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {analyzedContactsCount > 0
                      ? `Sampled ${analyzedContactsCount} contacts. Merge fields common to all: ${
                          commonVariables.length > 0
                            ? commonVariables.map((k) => `{{${k}}}`).join(", ")
                            : "none detected"
                        }.`
                      : `We'll sample up to ${CONTACT_SAMPLE_SIZE} contacts when you generate so merge variables match your list.`}
                  </p>
                </div>

                {/* Sequence & variations */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sequence-count">Sequence steps</Label>
                    <Input
                      id="sequence-count"
                      type="number"
                      min={1}
                      value={sequenceCount}
                      onChange={(e) => setSequenceCount(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Email 1, 2, 3… in your follow-up sequence.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="variation-count">Variations per step</Label>
                    <Input
                      id="variation-count"
                      type="number"
                      min={1}
                      value={variationCount}
                      onChange={(e) => setVariationCount(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      A/B-style variants for each step.
                      {expectedTemplateTotal != null && (
                        <span className="ml-1 font-medium text-foreground">→ {expectedTemplateTotal} templates total</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Advanced options — collapsible */}
                <div className="rounded-lg border border-dashed border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((prev) => !prev)}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                  >
                    <Settings2 className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left font-medium">Advanced options</span>
                    <span className="text-xs font-normal hidden sm:inline">ICP · email angles · sender details</span>
                    <ChevronDown className={cn("h-4 w-4 ml-1 transition-transform duration-200", showAdvanced && "rotate-180")} />
                  </button>
                  {showAdvanced && (
                    <div className="border-t border-border/60 p-4 space-y-5 bg-muted/10">
                      {/* ICP */}
                      <div className="space-y-2">
                        <Label htmlFor="icp-description">Ideal Customer Profile (ICP)</Label>
                        <Textarea
                          id="icp-description"
                          placeholder="e.g. B2B SaaS founders at seed–Series A, 5–50 employees, struggling with outbound pipeline."
                          value={icpDescription}
                          onChange={(e) => setIcpDescription(e.target.value)}
                          className="min-h-[70px] resize-y"
                        />
                        <p className="text-xs text-muted-foreground">Helps the AI personalise angle and pain points.</p>
                      </div>

                      {/* Email angles */}
                      <div className="space-y-2">
                        <Label>Email angles to rotate</Label>
                        <p className="text-xs text-muted-foreground">Select all angles that should appear across variations.</p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {EMAIL_ANGLE_OPTIONS.map((opt) => {
                            const active = emailAngles.includes(opt.value);
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => toggleEmailAngle(opt.value)}
                                className={cn(
                                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                                  active
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                                )}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sender Details */}
                      <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sender Details</p>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="sender-name">Default sender first name</Label>
                            <Input
                              id="sender-name"
                              placeholder="e.g. Alex  (leave blank for {{inbox_name}})"
                              value={senderName}
                              onChange={(e) => setSenderName(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="sender-title">Sender title / role</Label>
                            <Input
                              id="sender-title"
                              placeholder="e.g. Head of Growth"
                              value={senderTitle}
                              onChange={(e) => setSenderTitle(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Generate action */}
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    type="button"
                    onClick={handleGenerateAutomaticPrompt}
                    className="gap-2 w-full h-11 text-[0.95rem] font-semibold"
                    disabled={isAnalyzingList || !selectedListId}
                  >
                    {isAnalyzingList ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                    {isAnalyzingList ? "Analyzing contacts & building prompt…" : "Generate prompt"}
                  </Button>
                  {!selectedListId && !isAnalyzingList && (
                    <p className="text-xs text-center text-muted-foreground">Select a contact list above to enable this.</p>
                  )}
                </div>
              </div>

              <Separator />

              {/* ---- Step 2: Generated prompt ---- */}
              <div className={cn(
                "p-5 sm:p-6 space-y-3 overflow-x-hidden transition-colors duration-300",
                generatedPrompt.trim() ? "bg-primary/[0.04]" : "bg-muted/20"
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-[0.7rem] transition-colors",
                      generatedPrompt.trim()
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}>2</span>
                    Copy prompt to your AI
                    {generatedPrompt.trim() && (
                      <Badge variant="secondary" className="text-[0.65rem] bg-primary/10 text-primary border-primary/20 font-medium">
                        Ready
                      </Badge>
                    )}
                  </div>
                  {generatedPrompt.trim() && (
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5 h-8 shrink-0"
                      onClick={() => handleCopy("automatic-prompt-generator", generatedPrompt)}
                    >
                      {copiedId === "automatic-prompt-generator" ? (
                        <><Check className="w-3.5 h-3.5" />Copied!</>
                      ) : (
                        <><Copy className="w-3.5 h-3.5" />Copy prompt</>
                      )}
                    </Button>
                  )}
                </div>

                {!generatedPrompt.trim() ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
                    <Sparkles className="h-8 w-8 text-muted-foreground/30" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Your prompt will appear here</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        Fill in step 1 above, then click <span className="font-semibold">Generate prompt</span>
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                      Paste this into ChatGPT, Claude, or any AI. You can edit before copying.
                    </div>
                    <Label htmlFor="generated-prompt" className="sr-only">Generated prompt (editable)</Label>
                    <Textarea
                      id="generated-prompt"
                      value={generatedPrompt}
                      onChange={(e) => setGeneratedPrompt(e.target.value)}
                      className="min-h-[200px] max-h-[min(52vh,440px)] overflow-y-auto font-mono text-sm leading-relaxed resize-y"
                    />
                    <p className="text-xs text-muted-foreground">
                      {promptMode === "json-import"
                        ? "Tip: If the model wraps JSON in markdown fences, paste it in step 3 anyway — code fences are stripped automatically."
                        : "The AI will label each email (Step 1 — Variation 1, etc.) and use HTML code blocks."}
                    </p>
                  </>
                )}
              </div>

              <Separator />

              {/* ---- Step 3: Import / manual ---- */}
              <div className="p-5 sm:p-6 space-y-5">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[0.7rem] text-primary-foreground">3</span>
                  {promptMode === "json-import" ? "Paste JSON & create templates" : "Add templates manually"}
                </div>

                {promptMode === "classic" ? (
                  <Alert>
                    <FileText className="h-4 w-4" />
                    <AlertTitle>Classic mode — manual copy</AlertTitle>
                    <AlertDescription className="space-y-2 text-sm">
                      <p>
                        The AI labels each email (e.g. Step 1 — Variation 1). For each block, create a template and
                        paste the subject and HTML body. Use names like{" "}
                        <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">Your prefix - S1 - V1</code>.
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button type="button" variant="default" size="sm" className="gap-1.5" asChild>
                          <Link href="/templates/new"><Sparkles className="h-3.5 w-3.5" />New template</Link>
                        </Button>
                        <Button type="button" variant="outline" size="sm" asChild>
                          <Link href="/templates">All templates</Link>
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="template-base-name">Template name prefix</Label>
                        <Input
                          id="template-base-name"
                          placeholder="e.g. SaaS founders — March"
                          value={templateBaseName}
                          onChange={(e) => setTemplateBaseName(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          Each template is named{" "}
                          <span className="font-mono text-foreground">[prefix] - S&lt;step&gt; - V&lt;variation&gt;</span>.
                          If empty, we use "Template".
                        </p>
                      </div>
                      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground leading-relaxed">
                        <p className="font-medium text-foreground mb-1 flex items-center gap-1.5">
                          <ClipboardList className="h-3.5 w-3.5" />Naming preview
                        </p>
                        <p className="font-mono text-[0.7rem] sm:text-xs break-all">
                          {(templateBaseName.trim() || "Template") + " - S1 - V1"}
                          <span className="text-muted-foreground">, </span>
                          {(templateBaseName.trim() || "Template") + " - S1 - V2"}
                          <span className="text-muted-foreground">, …</span>
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="pasted-json">AI response (JSON)</Label>
                      <Textarea
                        id="pasted-json"
                        placeholder={`Paste the full JSON. Example: { "body_type": "${templateBodyFormat}", "steps": [ { "step_number": 1, "variations": [ … ] } ] }`}
                        value={pastedJson}
                        onChange={(e) => setPastedJson(e.target.value)}
                        className="min-h-[180px] font-mono text-xs leading-relaxed resize-y"
                      />
                    </div>

                    {jsonImportPreview.status === "empty" && (
                      <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
                        Paste JSON to see how many templates will be created and a sample of names.
                      </p>
                    )}
                    {jsonImportPreview.status === "error" && (
                      <Alert variant="destructive">
                        <AlertTitle>JSON needs a fix</AlertTitle>
                        <AlertDescription>{jsonImportPreview.message}</AlertDescription>
                      </Alert>
                    )}
                    {jsonImportPreview.status === "no-rows" && (
                      <Alert variant="warning">
                        <AlertTitle>Nothing to import</AlertTitle>
                        <AlertDescription>{jsonImportPreview.message}</AlertDescription>
                      </Alert>
                    )}
                    {jsonImportPreview.status === "ok" && (
                      <div className="rounded-lg border border-green-500/25 bg-green-500/5 px-3 py-3 text-sm">
                        <p className="font-medium text-green-800 dark:text-green-200 flex flex-wrap items-center gap-2">
                          <span>Ready to create {jsonImportPreview.count} template{jsonImportPreview.count === 1 ? "" : "s"}</span>
                          <Badge variant="secondary" className="font-mono text-xs font-normal">
                            {templateBaseName.trim() || "Template"} — S* — V*
                          </Badge>
                        </p>
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground font-mono">
                          {jsonImportPreview.sampleNames.map((n) => <li key={n}>• {n}</li>)}
                          {jsonImportPreview.more > 0 && (
                            <li className="text-muted-foreground/90">… and {jsonImportPreview.more} more</li>
                          )}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Button
                        type="button"
                        className="gap-2 w-full sm:w-auto"
                        disabled={!userId || jsonImportPreview.status !== "ok" || isCreatingTemplates}
                        onClick={handleCreateTemplatesFromJson}
                      >
                        {isCreatingTemplates ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                        {isCreatingTemplates && createProgress
                          ? `Creating ${createProgress.current} / ${createProgress.total}…`
                          : isCreatingTemplates
                            ? "Creating…"
                            : "Create all templates"}
                      </Button>
                      {!userId ? (
                        <p className="text-xs text-muted-foreground">Sign in to save templates.</p>
                      ) : jsonImportPreview.status !== "ok" && pastedJson.trim() ? (
                        <p className="text-xs text-muted-foreground">Fix JSON above to enable this button.</p>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}