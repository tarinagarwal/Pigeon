"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  Mail,
  TestTube,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Variable,
  Link2,
  Code,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useTemplates, useCreateTemplate, useUpdateTemplate } from "@/hooks/useTemplates";
import { useInboxes } from "@/hooks/useInboxes";
import { useSettings } from "@/hooks/useSettings";
import { useContactLists } from "@/hooks/useContacts";
import { useQuery } from "@tanstack/react-query";
import { runComplianceCheck } from "@/lib/compliance";
import { plainTextToHtml, looksLikeHtml, replacePlaceholdersWithSample } from "@/lib/templateBody";
import { api } from "@/lib/api";
import { useLLMConfigs, useGenerateTemplate } from "@/hooks/useLLM";
import { IsolatedPreview } from "@/components/IsolatedPreview";
import { RichTextEditor } from "@/components/RichTextEditor";
import { toast } from "sonner";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";

const TEST_AI_PROMPT_PRESETS = [
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

const TEMPLATE_VARIABLES = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Title" },
  { key: "industry", label: "Industry" },
  { key: "inbox_name", label: "Sender Name" },
  { key: "inbox_email", label: "Sender Email" },
  { key: "unsubscribe_url", label: "Unsubscribe URL (campaign)" },
] as const;

import { getRandomFramework } from "@/lib/emailFrameworks";

const UNSUBSCRIBE_LINK_OPTIONS = [
  "If you no longer wish to receive these emails, you can unsubscribe here: {insert-unsubscribe-link-here}",
  "To stop receiving future emails from us, please unsubscribe here: {insert-unsubscribe-link-here}",
  "You're receiving this email because you subscribed to updates. Unsubscribe anytime: {insert-unsubscribe-link-here}",
  "Manage your email preferences or unsubscribe here: {insert-unsubscribe-link-here}",
  "Don't want to hear from us anymore? Unsubscribe here: {insert-unsubscribe-link-here}",
  "You can opt out of these emails at any time: {insert-unsubscribe-link-here}",
  "To unsubscribe from future communications, click here: {insert-unsubscribe-link-here}",
  "Not finding these emails helpful? Unsubscribe here: {insert-unsubscribe-link-here}",
  "Change your email preferences or unsubscribe here: {insert-unsubscribe-link-here}",
  "To stop receiving marketing emails, unsubscribe here: {insert-unsubscribe-link-here}",
  "Unsubscribe: {insert-unsubscribe-link-here}",
  "Manage preferences: {insert-unsubscribe-link-here}",
  "Opt out anytime: {insert-unsubscribe-link-here}",
  "Stop emails: {insert-unsubscribe-link-here}",
  "Unsubscribe from future emails: {insert-unsubscribe-link-here}",
  "You may unsubscribe from these emails at any time using the link below: {insert-unsubscribe-link-here}",
  "If you prefer not to receive future emails, please unsubscribe here: {insert-unsubscribe-link-here}",
  "This message was sent to you because you subscribed to updates. Unsubscribe here: {insert-unsubscribe-link-here}",
  "To manage your subscription or unsubscribe, visit: {insert-unsubscribe-link-here}",
  "Click here to unsubscribe from all future messages: {insert-unsubscribe-link-here}",
  "No longer interested? You can unsubscribe here: {insert-unsubscribe-link-here}",
  "If these emails aren't relevant to you, unsubscribe here: {insert-unsubscribe-link-here}",
  "To stop all email updates, click here to unsubscribe: {insert-unsubscribe-link-here}",
  "Prefer fewer emails? Manage your preferences here: {insert-unsubscribe-link-here}",
  "You're in control of your inbox — unsubscribe here: {insert-unsubscribe-link-here}",
  "Take a break from our emails by unsubscribing here: {insert-unsubscribe-link-here}",
  "To opt out of our mailing list, click here: {insert-unsubscribe-link-here}",
  "Unsubscribe from our mailing list here: {insert-unsubscribe-link-here}",
  "If you no longer want updates from us, unsubscribe here: {insert-unsubscribe-link-here}",
  "Stop receiving updates from us: {insert-unsubscribe-link-here}",
  "You can update your preferences or unsubscribe here: {insert-unsubscribe-link-here}",
  "Click here to manage your email settings or unsubscribe: {insert-unsubscribe-link-here}",
  "Not the right fit? Unsubscribe here: {insert-unsubscribe-link-here}",
  "To end these email notifications, unsubscribe here: {insert-unsubscribe-link-here}",
  "Unsubscribe from promotional emails here: {insert-unsubscribe-link-here}",
  "Change how often you hear from us or unsubscribe here: {insert-unsubscribe-link-here}",
  "You may stop receiving these emails at any time: {insert-unsubscribe-link-here}",
  "To withdraw from our email list, unsubscribe here: {insert-unsubscribe-link-here}",
  "No hard feelings — unsubscribe here: {insert-unsubscribe-link-here}",
  "Want to leave our list? Unsubscribe here: {insert-unsubscribe-link-here}",
  "Click here if you wish to stop receiving our emails: {insert-unsubscribe-link-here}",
  "Unsubscribe from all updates here: {insert-unsubscribe-link-here}",
  "Prefer to opt out? Unsubscribe here: {insert-unsubscribe-link-here}",
  "You can leave our mailing list anytime: {insert-unsubscribe-link-here}",
  "If you'd like to stop hearing from us, unsubscribe here: {insert-unsubscribe-link-here}",
  "Turn off email notifications here: {insert-unsubscribe-link-here}",
  "To cancel your email subscription, unsubscribe here: {insert-unsubscribe-link-here}",
  "No longer want emails from us? Unsubscribe here: {insert-unsubscribe-link-here}",
  "You can remove yourself from our list here: {insert-unsubscribe-link-here}",
  "Click here to stop receiving emails from us: {insert-unsubscribe-link-here}",
];

function insertVariableAtCursor(
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  setValue: (v: string) => void,
  token: string
) {
  const el = ref.current;
  if (!el) return;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const newValue = value.slice(0, start) + token + value.slice(end);
  setValue(newValue);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}

/** Ensure space after closing inline tags and after <br /> so text doesn't run together */
function ensureSpacesInHtml(html: string): string {
  return html
    .replace(/(<\/(?:strong|b|em|i|span|a)>)([a-zA-Z\-])/g, "$1 $2")
    .replace(/(<br\s*\/?>)([a-zA-Z])/gi, "$1 $2");
}

/** Basic HTML formatter: newlines after tags and simple indent (no Prettier dependency). */
function formatHtmlBasic(html: string): string {
  const trimmed = html.trim();
  let out = trimmed
    .replace(/>\s*</g, ">\n<")
    .replace(/\n\s*\n/g, "\n");
  const lines = out.split("\n");
  let indent = 0;
  const result: string[] = [];
  const skipIndent = /^<\?(xml|!DOCTYPE)|^<\!--|^<\/?(html|head|body|meta|link|br|hr|img|input|col)(\s|>|\/)/i;
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    if (trimmedLine.startsWith("</") && !skipIndent.test(trimmedLine)) indent = Math.max(0, indent - 1);
    result.push("  ".repeat(indent) + trimmedLine);
    if (trimmedLine.startsWith("<") && !trimmedLine.startsWith("</") && !trimmedLine.startsWith("<!") && !trimmedLine.startsWith("<?") && !/\/\s*>$/.test(trimmedLine) && !/^<(br|hr|img|input|col|meta|link)\s/i.test(trimmedLine)) indent += 1;
  }
  return result.join("\n");
}

type TemplateFormProps = { templateId?: string };

export default function TemplateForm({ templateId }: TemplateFormProps) {
  const router = useRouter();
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const isEdit = !!templateId;

  const [templateName, setTemplateName] = useState("");
  const [templateSubject, setTemplateSubject] = useState("");
  const [templateHtml, setTemplateHtml] = useState("");
  const [templateBodyType, setTemplateBodyType] = useState<"html" | "plain" | "rich">("rich");
  const [testEmail, setTestEmail] = useState("");
  const [testSenderType, setTestSenderType] = useState<"gmail" | "smtp">("gmail");
  const [testInboxId, setTestInboxId] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testUseAiVariation, setTestUseAiVariation] = useState(false);
  const [testAiProvider, setTestAiProvider] = useState("");
  const [testAiPrompt, setTestAiPrompt] = useState("");
  const [testDataMode, setTestDataMode] = useState<"sample" | "contact">("sample");
  const [testContactListId, setTestContactListId] = useState("");
  const [testContactId, setTestContactId] = useState("");

  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiProvider, setAiProvider] = useState("");
  const [generatedContent, setGeneratedContent] = useState("");
  const [generatingFor, setGeneratingFor] = useState<"full" | "subject">("full");

  const [unsubscribeDialogOpen, setUnsubscribeDialogOpen] = useState(false);
  /** tracking = {{unsubscribe_url}} replaced at send (same host as click tracking). custom = your own URL. */
  const [unsubscribeLinkMode, setUnsubscribeLinkMode] = useState<"tracking" | "custom">("tracking");
  const [unsubscribeUrl, setUnsubscribeUrl] = useState("");
  const [unsubscribeOptionIndex, setUnsubscribeOptionIndex] = useState<number>(0);

  const subjectInputRef = useRef<HTMLInputElement>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const richEditorRef = useRef<import("@/components/RichTextEditor").RichTextEditorRef>(null);

  const { data: templates = [], isLoading: templatesLoading } = useTemplates(userId);
  const { data: inboxes = [] } = useInboxes(userId);
  const { data: settingsData } = useSettings();
  const { data: contactLists = [] } = useContactLists(userId);
  const { data: testListContactsData } = useQuery({
    queryKey: ["contact-lists-contacts", testContactListId],
    queryFn: () => api.contactLists.getContacts(testContactListId, 0, 5),
    enabled: !!testContactListId,
  });
  const testListContacts = testListContactsData?.contacts ?? [];
  const gmailInboxes = useMemo(() => inboxes.filter((i) => i.sender_type === "gmail"), [inboxes]);
  const smtpInboxes = useMemo(
    () => inboxes.filter((i) => i.sender_type === "smtp" && i.status === "ready"),
    [inboxes]
  );

  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const { data: llmConfigs = [] } = useLLMConfigs(userId);
  const generateTemplate = useGenerateTemplate();
  const aiGate = usePlanGate("ai_emails");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const template = useMemo(
    () => (templateId ? templates.find((t) => t.id === templateId) : null),
    [templateId, templates]
  );

  useEffect(() => {
    if (llmConfigs.length === 1 && !aiProvider) setAiProvider(llmConfigs[0].provider);
  }, [llmConfigs, aiProvider]);

  useEffect(() => {
    if (testSenderType === "gmail" && gmailInboxes.length === 1 && !testInboxId) {
      setTestInboxId(gmailInboxes[0].id);
    } else if (testSenderType === "smtp" && smtpInboxes.length === 1 && !testInboxId) {
      setTestInboxId(smtpInboxes[0].id);
    }
  }, [testSenderType, gmailInboxes, smtpInboxes, testInboxId]);

  useEffect(() => {
    if (testContactListId) setTestContactId("");
  }, [testContactListId]);

  useEffect(() => {
    if (!isEdit || !template) return;
    setTemplateName(template.name);
    setTemplateSubject(template.subject);
    setTemplateHtml(template.body ?? "");
    setTemplateBodyType((template.body_type as "html" | "plain" | "rich") ?? "rich");
  }, [isEdit, template]);

  const templateContentForCompliance = `${templateSubject || ""} ${templateHtml?.trim() || ""}`;
  const complianceResult = useMemo(
    () => runComplianceCheck(templateContentForCompliance, settingsData?.compliance),
    [templateContentForCompliance, settingsData?.compliance]
  );

  const saveTemplate = async (navigateAfter: boolean): Promise<string | null> => {
    if (!templateName.trim()) {
      toast.error("Please enter a template name");
      return null;
    }
    if (!templateSubject.trim()) {
      toast.error("Please enter a subject line");
      return null;
    }
    if (!templateHtml.trim()) {
      toast.error("Please enter email body content");
      return null;
    }

    try {
      let sequenceNumber = 1;
      if (!isEdit) {
        const maxSequence = templates.length > 0 ? Math.max(...templates.map((t) => t.sequence_number || 0)) : 0;
        sequenceNumber = maxSequence + 1;
      } else {
        sequenceNumber = template?.sequence_number ?? 1;
      }

      const id = templateId || crypto.randomUUID();
      const templateData = {
        id,
        user_id: userId,
        name: templateName.trim(),
        subject: templateSubject.trim(),
        body: templateHtml.trim(),
        body_type: templateBodyType,
        sequence_number: sequenceNumber,
        created_at: template?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (isEdit) {
        await updateTemplate.mutateAsync({ templateId: id, data: templateData });
      } else {
        await createTemplate.mutateAsync(templateData);
      }

      if (navigateAfter) router.push("/templates");
      return id;
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to save template");
      return null;
    }
  };

  const handleSendTestTemplate = async () => {
    const email = testEmail.trim();
    if (!email) {
      toast.error("Please enter an email address to send the test email");
      return;
    }
    if (testUseAiVariation && (!testAiProvider || !testAiPrompt.trim())) {
      toast.error("Enable AI variation requires an AI provider and prompt");
      return;
    }
    setIsSendingTest(true);
    try {
      const id = await saveTemplate(false);
      if (!id) return;
      const aiOptions =
        testUseAiVariation && testAiProvider && testAiPrompt.trim()
          ? { useAiVariation: true, aiProvider: testAiProvider, aiPrompt: testAiPrompt.trim() }
          : undefined;
      const contactIdOpt = testDataMode === "contact" && testContactId ? testContactId : undefined;
      const options = { ...aiOptions, ...(contactIdOpt ? { contactId: contactIdOpt } : {}) };
      if (testSenderType === "gmail") {
        const result = await api.emails.sendTemplateTest(userId, id, email, testInboxId || undefined, options);
        toast.success(result.message || `Test email sent to ${email}`);
      } else {
        const result = await api.emails.sendSmtpTemplateTest(userId, id, testInboxId, email, options);
        toast.success(result.message || `Test email sent to ${email}`);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to send test email");
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleAIGenerate = async () => {
    if (!aiProvider || !aiPrompt.trim() || llmConfigs.length === 0) {
      toast.error("Please select an AI provider and enter a prompt");
      return;
    }
    const isFullGeneration = generatingFor === "full" || aiPrompt.length > 100;
    try {
      const frameworkInstruction = getRandomFramework();
      const fullTemplatePrompt = `You are an expert email template generator. Generate a COMPLETE email template based on this request: "${aiPrompt}"

CRITICAL INSTRUCTIONS:
1. You MUST return a valid JSON object with exactly 3 fields: "name", "subject", and "body"
2. Do NOT return markdown code blocks, do NOT add any text before or after the JSON
3. The JSON must be valid and parseable
${frameworkInstruction}

PERSONALIZATION (use these exact placeholder names so they get replaced when sending):
- {{first_name}} {{last_name}} {{email}} {{company}} {{industry}}
- Custom contact fields use the same format, e.g. {{title}} if the contact list has a "title" field.

SPINTAX (optional): Use {option1|option2|option3} for random variation per email. One option is picked at random. Example: {Hi|Hello|Hey} {{first_name}}, {hope you're well|just reaching out}.

BODY FORMAT: Use plain text with line breaks, or HTML for richer emails. When using HTML, use custom CSS via inline styles (e.g. style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.5") for compatibility across email clients. Avoid external stylesheets; prefer inline style attributes on elements like <p>, <div>, <a>, <strong>.

Required JSON format:
{
  "name": "A descriptive template name (e.g., 'Cold Outreach - Initial Contact')",
  "subject": "A single compelling email subject line (just one subject, not a list). Use {{first_name}} or {{company}} for personalization if relevant.",
  "body": "Complete email body (plain text with line breaks, or HTML with inline CSS styles). Use {{first_name}}, {{last_name}}, {{company}}, {{industry}} for personalization. You may use spintax like {Hi|Hello} {{first_name}}, for variation."
}

Return ONLY valid JSON for: "${aiPrompt}"`;

      const promptToUse = isFullGeneration
        ? fullTemplatePrompt
        : `Generate a single, compelling email subject line for: ${aiPrompt}. Return ONLY the subject line text, no labels, no numbering, no extra text.`;

      const result = await generateTemplate.mutateAsync({
        userId,
        provider: aiProvider,
        prompt: promptToUse,
      });

      let content = (result.content || "").trim();
      if (!isFullGeneration) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.subject) setTemplateSubject(parsed.subject);
          else setTemplateSubject(content.split("\n")[0].replace(/^["']|["']$/g, "") || content);
        } catch {
          setTemplateSubject(content.replace(/^["']|["']$/g, ""));
        }
        setAiGenerateOpen(false);
        toast.success("Subject line generated!");
        return;
      }

      if (content.includes("```json")) {
        const m = content.match(/```json\s*([\s\S]*?)\s*```/i);
        if (m) content = m[1].trim();
      } else if (content.includes("```")) {
        const m = content.match(/```\s*([\s\S]*?)\s*```/);
        if (m) content = m[1].trim();
      }

      try {
        const parsed = JSON.parse(content);
        const name = String(parsed.name || "").trim() || "AI Generated Template";
        const subject = String(parsed.subject || "").trim() || "No subject";
        const bodyRaw = String(parsed.body || "").trim();
        const body = looksLikeHtml(bodyRaw) ? bodyRaw : plainTextToHtml(bodyRaw);

        const sequenceNumber =
          templates.length > 0
            ? Math.max(...templates.map((t) => t.sequence_number || 0)) + 1
            : 1;
        const id = crypto.randomUUID();
        const templateData = {
          id,
          user_id: userId,
          name,
          subject,
          body,
          body_type: templateBodyType,
          sequence_number: sequenceNumber,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        await createTemplate.mutateAsync(templateData);
        setAiGenerateOpen(false);
        router.push(`/templates/${id}/edit`);
      } catch {
        setGeneratedContent(result.content || "");
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to generate template");
    }
  };

  const handleInsertUnsubscribeLink = () => {
    const option = UNSUBSCRIBE_LINK_OPTIONS[unsubscribeOptionIndex] ?? UNSUBSCRIBE_LINK_OPTIONS[0];
    const placeholder = "{insert-unsubscribe-link-here}";
    const url = unsubscribeUrl.trim();

    if (unsubscribeLinkMode === "custom" && !url) {
      toast.error("Please enter the unsubscribe link URL");
      return;
    }

    const isHtmlLike = templateBodyType === "html" || templateBodyType === "rich";
    let replacement: string;
    if (unsubscribeLinkMode === "tracking") {
      replacement = isHtmlLike ? `<a href="{{unsubscribe_url}}">here</a>` : "{{unsubscribe_url}}";
    } else {
      replacement = isHtmlLike ? `<a href="${url.replace(/"/g, "&quot;")}">here</a>` : url;
    }
    const snippet = option.replace(placeholder, replacement);

    if (templateBodyType === "rich") {
      richEditorRef.current?.editor?.chain().focus().insertContent("<p>" + snippet + "</p>").run();
      setUnsubscribeDialogOpen(false);
      setUnsubscribeUrl("");
      setUnsubscribeOptionIndex(0);
      setUnsubscribeLinkMode("tracking");
      return;
    }

    const isHtml = templateBodyType === "html";
    const value = templateHtml || "";
    const separator = value.trim() ? (isHtml ? "<br><br>" : "\n\n") : "";
    const newValue = value.trimEnd() + separator + snippet;
    setTemplateHtml(newValue);
    setUnsubscribeDialogOpen(false);
    setUnsubscribeUrl("");
    setUnsubscribeOptionIndex(0);
    setUnsubscribeLinkMode("tracking");
    requestAnimationFrame(() => {
      htmlTextareaRef.current?.focus();
      const pos = newValue.length;
      htmlTextareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const handleFormatHtml = () => {
    const html = templateHtml?.trim() || "";
    if (!html) {
      toast.error("No HTML to format");
      return;
    }
    try {
      // Basic HTML formatting: indent tags for readability (no Prettier dependency)
      const formatted = formatHtmlBasic(html);
      setTemplateHtml(ensureSpacesInHtml(formatted).trim());
      toast.success("HTML formatted");
    } catch (err) {
      console.error(err);
      toast.error("Could not format HTML. Check for invalid syntax.");
    }
  };

  const handleUseGeneratedContent = () => {
    if (!generatedContent) return;
    try {
      let content = generatedContent.trim().replace(/```json\n?/i, "").replace(/```\n?$/g, "");
      const parsed = JSON.parse(content);
      if (parsed.name) setTemplateName(String(parsed.name).trim());
      if (parsed.subject) setTemplateSubject(String(parsed.subject).trim());
      if (parsed.body) setTemplateHtml(looksLikeHtml(parsed.body) ? parsed.body : plainTextToHtml(parsed.body));
    } catch {
      const lines = generatedContent.split("\n");
      const subjectMatch = generatedContent.match(/subject[:\s]+["']?([^"'\n]+)["']?/i);
      if (subjectMatch) setTemplateSubject(subjectMatch[1].trim());
      else if (lines[0]) setTemplateSubject(lines[0].replace(/^(subject|Subject)[:\s]*/i, "").trim());
      const bodyMatch = generatedContent.match(/body[:\s]+["']?([\s\S]+)["']?/i);
      if (bodyMatch) setTemplateHtml(looksLikeHtml(bodyMatch[1]) ? bodyMatch[1] : plainTextToHtml(bodyMatch[1]));
      else setTemplateHtml(plainTextToHtml(lines.slice(1).join("\n")));
    }
    setGeneratedContent("");
    setAiGenerateOpen(false);
  };

  if (isEdit && !templatesLoading && !template) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/templates">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to templates
          </Link>
        </Button>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="font-medium">Template not found</p>
            <p className="text-sm text-muted-foreground mt-1">The template may have been deleted.</p>
            <Button asChild className="mt-4">
              <Link href="/templates">Back to templates</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <UpgradeModal featureKey="ai_emails" gate={aiGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/templates")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{isEdit ? "Edit Template" : "Create New Template"}</h1>
          <p className="text-muted-foreground text-sm">Design your email template with personalization</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Template Name</Label>
          <Input
            className="bg-background"
            placeholder="e.g., Cold Outreach - Initial Contact"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Subject Line</Label>
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    <Variable className="w-3 h-3" />
                    Insert variable
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {TEMPLATE_VARIABLES.map(({ key, label }) => (
                    <DropdownMenuItem
                      key={key}
                      onClick={() =>
                        insertVariableAtCursor(subjectInputRef, templateSubject, setTemplateSubject, `{{${key}}}`)
                      }
                    >
                      {`{{${key}}}`}
                      <span className="ml-1 text-muted-foreground text-xs">({label})</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-accent"
                onClick={() => {
                  if (aiGate.atLimit) {
                    toast.error(aiGate.upgradeLine || "AI generation is available on higher plans.");
                    setUpgradeOpen(true);
                    return;
                  }
                  if (llmConfigs.length === 0) {
                    toast.error("Configure an AI provider in Settings first");
                    return;
                  }
                  setGeneratingFor("subject");
                  setAiPrompt("");
                  setAiGenerateOpen(true);
                }}
                disabled={llmConfigs.length === 0}
              >
                <Sparkles className="w-3 h-3" />
                {aiGate.atLimit ? "Upgrade for AI" : "AI Generate"}
              </Button>
            </div>
          </div>
          <Input
            ref={subjectInputRef}
            className="bg-background"
            placeholder="Enter subject line with {{personalization}}"
            value={templateSubject}
            onChange={(e) => setTemplateSubject(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Variables (e.g. {`{{first_name}}`}, {`{{company}}`}) are replaced with contact data;{" "}
            {`{{unsubscribe_url}}`} is filled with the real unsubscribe link when each campaign email is sent. Use spintax{" "}
            {`{Hi|Hello|Hey}`} for random variations.
          </p>
          <p className="text-xs text-muted-foreground">
            Sender variables {`{{inbox_name}}`} and {`{{inbox_email}}`} use the sending inbox and should be used{" "}
            <span className="font-medium">only in the signature</span>.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Label>Email Body</Label>
            <Select value={templateBodyType} onValueChange={(v: "html" | "plain" | "rich") => setTemplateBodyType(v)}>
              <SelectTrigger className="w-[140px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="html">HTML</SelectItem>
                <SelectItem value="plain">Plain Text</SelectItem>
                <SelectItem value="rich">Rich Text</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {templateBodyType !== "rich" && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p>
                You can easily generate HTML using AI tools like Claude or ChatGPT—simply paste it here, click
                &quot;Format HTML&quot; to clean and standardize your code, then use Preview and Send Test Email to see
                the real result.
              </p>
            </div>
          )}
          <Tabs defaultValue="html">
            <TabsList className="mb-2">
              <TabsTrigger value="html">
                {templateBodyType === "plain" ? "Text" : templateBodyType === "rich" ? "Editor" : "HTML"}
              </TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="html" className="space-y-2">
              <div className="flex justify-end gap-1 flex-wrap">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1">
                      <Variable className="w-3 h-3" />
                      Insert variable
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {TEMPLATE_VARIABLES.map(({ key, label }) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => {
                          const token = `{{${key}}}`;
                          if (templateBodyType === "rich") {
                            richEditorRef.current?.editor?.chain().focus().insertContent(token).run();
                          } else {
                            const el = htmlTextareaRef.current;
                            const v = templateHtml || "";
                            const start = el?.selectionStart ?? v.length;
                            const end = el?.selectionEnd ?? v.length;
                            setTemplateHtml(v.slice(0, start) + token + v.slice(end));
                            requestAnimationFrame(() => {
                              el?.focus();
                              el?.setSelectionRange(start + token.length, start + token.length);
                            });
                          }
                        }}
                      >
                        {`{{${key}}}`}
                        <span className="ml-1 text-muted-foreground text-xs">({label})</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setUnsubscribeDialogOpen(true)}
                >
                  <Link2 className="w-3 h-3" />
                  Insert unsubscribe link
                </Button>
                {templateBodyType === "html" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={handleFormatHtml}
                  >
                    <Code className="w-3 h-3" />
                    Format HTML
                  </Button>
                )}
              </div>
              {templateBodyType === "rich" ? (
                <RichTextEditor
                  ref={richEditorRef}
                  value={templateHtml}
                  onChange={setTemplateHtml}
                  placeholder="Hi {{first_name}}, write your email here..."
                />
              ) : (
                <Textarea
                  ref={htmlTextareaRef}
                  placeholder={
                    templateBodyType === "plain"
                      ? "Hi {{first_name}},\n\nYour message here..."
                      : "<html>...</html> or paste HTML from any AI tool"
                  }
                  className="min-h-[300px] font-mono text-sm bg-background"
                  value={templateHtml}
                  onChange={(e) => setTemplateHtml(e.target.value)}
                />
              )}
            </TabsContent>
            <TabsContent value="preview">
              {templateHtml?.trim() ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 border border-border/50">
                    <strong>Sample values used for placeholders in this preview:</strong>{" "}
                    {
                      "{{first_name}} → John, {{last_name}} → Doe, {{company}} → Acme Inc, {{industry}} → Technology, {{title}} → CEO, {{unsubscribe_url}} → sample API link"
                    }
                    . Other placeholders appear as-is.
                  </p>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="text-sm text-muted-foreground mb-1">Subject:</div>
                    <div className="font-medium text-base">
                      {replacePlaceholdersWithSample(templateSubject || "") || (
                        <span className="text-muted-foreground italic">No subject line</span>
                      )}
                    </div>
                  </div>
                  <IsolatedPreview
                    mode={templateBodyType}
                    html={replacePlaceholdersWithSample(templateHtml)}
                    plainText={replacePlaceholdersWithSample(templateHtml)}
                    title="Email body preview"
                    className="min-h-[300px] max-h-[400px] w-full rounded-lg border bg-white overflow-hidden"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[300px] text-center text-muted-foreground rounded-lg border bg-muted/20">
                  <Mail className="w-12 h-12 mb-3 opacity-50" />
                  <p>Add content to see preview</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compliance Check</CardTitle>
            <CardDescription>Based on your Settings → Compliance rules</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Link count</span>
              <span className={complianceResult.linkOk ? "text-green-600 dark:text-green-400" : "text-destructive"}>
                {complianceResult.linkCount} / {complianceResult.linkMax}
                {complianceResult.linkOk ? <CheckCircle className="inline w-4 h-4 ml-1" /> : <XCircle className="inline w-4 h-4 ml-1" />}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Spam words</span>
              <span className={`text-right ${complianceResult.spamOk ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                {complianceResult.spamOk ? (
                  <>None <CheckCircle className="inline w-4 h-4 ml-1" /></>
                ) : (
                  <>
                    {complianceResult.spamWordsFound.length} found: {complianceResult.spamWordsFound.join(", ")}
                    <XCircle className="inline w-4 h-4 ml-1 shrink-0" />
                  </>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Unsubscribe link</span>
              <span className={complianceResult.unsubscribeOk ? "text-green-600 dark:text-green-400" : "text-destructive"}>
                {complianceResult.hasUnsubscribe ? "Present" : "Missing"}
                {complianceResult.unsubscribeOk ? <CheckCircle className="inline w-4 h-4 ml-1" /> : <XCircle className="inline w-4 h-4 ml-1" />}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TestTube className="w-4 h-4 text-primary" />
              Test this template
            </CardTitle>
            <CardDescription>Send a test email with sample data replacing your variables.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* AI variation (optional) - same as campaign */}
            <div className="rounded-lg border border-accent/20 bg-accent/5 p-4 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    Test with AI variation
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Generate a unique AI rewrite for this test (like campaign AI variation)
                  </p>
                </div>
                <Switch
                  checked={testUseAiVariation}
                  onCheckedChange={(checked) => {
                    if (checked && llmConfigs.length === 0) {
                      toast.error("Configure an AI provider in Settings → Integrations to enable this feature");
                      return;
                    }
                    setTestUseAiVariation(checked);
                    if (checked && llmConfigs.length > 0 && !testAiProvider) {
                      setTestAiProvider(llmConfigs[0].provider);
                    }
                  }}
                  disabled={llmConfigs.length === 0}
                />
              </div>
              {llmConfigs.length === 0 && (
                <div className="p-3 rounded-lg border border-border bg-muted/50 flex items-start gap-2 font-sans">
                  <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    Configure an AI provider in Settings → Integrations to enable this feature
                  </p>
                </div>
              )}
              {testUseAiVariation && llmConfigs.length > 0 && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <Label>AI Provider</Label>
                    <Select value={testAiProvider} onValueChange={setTestAiProvider}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select AI provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {llmConfigs.map((config) => (
                          <SelectItem key={config.provider} value={config.provider}>
                            {config.provider.charAt(0).toUpperCase() + config.provider.slice(1)}
                            {config.model_name && ` (${config.model_name})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>AI prompt</Label>
                    <Select
                      value={TEST_AI_PROMPT_PRESETS.includes(testAiPrompt) ? testAiPrompt : ""}
                      onValueChange={setTestAiPrompt}
                    >
                      <SelectTrigger className="bg-background h-11">
                        <SelectValue placeholder="Choose a preset or type below..." />
                      </SelectTrigger>
                      <SelectContent>
                        {TEST_AI_PROMPT_PRESETS.map((prompt) => (
                          <SelectItem key={prompt} value={prompt} className="whitespace-normal">
                            {prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      placeholder="e.g., Rewrite this email to sound more casual and friendly while keeping the same core message. Maintain all personalization variables."
                      value={testAiPrompt}
                      onChange={(e) => setTestAiPrompt(e.target.value)}
                      className="min-h-[80px] bg-background"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Test data: sample placeholders vs select a contact */}
            <div className="space-y-3">
              <Label>Test data</Label>
              <Select
                value={testDataMode}
                onValueChange={(v: "sample" | "contact") => {
                  setTestDataMode(v);
                  if (v === "sample") {
                    setTestContactListId("");
                    setTestContactId("");
                  }
                }}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sample">Use sample data (John, Acme Inc, Technology)</SelectItem>
                  <SelectItem value="contact">Use a contact (pick from list)</SelectItem>
                </SelectContent>
              </Select>
              {testDataMode === "contact" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Contact list</Label>
                    <Select value={testContactListId} onValueChange={setTestContactListId}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Choose a list" />
                      </SelectTrigger>
                      <SelectContent>
                        {contactLists.map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name} ({list.contact_count ?? list.contact_ids?.length ?? 0} contacts)
                          </SelectItem>
                        ))}
                        {contactLists.length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground">No contact lists. Create one in Contacts.</div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact</Label>
                    <Select
                      value={testContactId}
                      onValueChange={setTestContactId}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder={testContactListId ? "Choose a contact" : "Select a list first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {testListContacts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || c.id}
                            {c.email ? ` (${c.email})` : ""}
                          </SelectItem>
                        ))}
                        {testContactListId && testListContacts.length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground">No contacts in this list</div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Send via</Label>
              <Select
                value={testSenderType}
                onValueChange={(v: "gmail" | "smtp") => {
                  setTestSenderType(v);
                  setTestInboxId("");
                }}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gmail">Gmail</SelectItem>
                  <SelectItem value="smtp">Domain</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {testSenderType === "gmail" ? (
              gmailInboxes.length > 0 ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Inbox</Label>
                    <Select value={testInboxId} onValueChange={setTestInboxId}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Choose Gmail inbox" />
                      </SelectTrigger>
                      <SelectContent>
                        {gmailInboxes.map((inbox) => (
                          <SelectItem key={inbox.id} value={inbox.id}>
                            {inbox.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor="test-email">Test email address</Label>
                      <Input
                        id="test-email"
                        type="email"
                        className="bg-background"
                        placeholder="Enter email to send test"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                      />
                    </div>
                    <Button
                      className="sm:w-auto w-full gap-2"
                      variant="outline"
                      disabled={isSendingTest || createTemplate.isPending || updateTemplate.isPending || !testEmail.trim() || !testInboxId || (testUseAiVariation && (!testAiProvider || !testAiPrompt.trim())) || (testDataMode === "contact" && !testContactId)}
                      onClick={handleSendTestTemplate}
                    >
                      {isSendingTest ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <TestTube className="w-4 h-4" />
                          Send test
                        </>
                      )}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Connect Gmail in Settings to send a test.</p>
              )
            ) : smtpInboxes.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  <Label>Inbox</Label>
                  <Select value={testInboxId} onValueChange={setTestInboxId}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Choose SMTP inbox" />
                    </SelectTrigger>
                    <SelectContent>
                      {smtpInboxes.map((inbox) => (
                        <SelectItem key={inbox.id} value={inbox.id}>
                          {inbox.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="test-email-smtp">Test email address</Label>
                    <Input
                      id="test-email-smtp"
                      type="email"
                      className="bg-background"
                      placeholder="Enter email to send test"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                    />
                  </div>
                  <Button
                    className="sm:w-auto w-full gap-2"
                    variant="outline"
                    disabled={isSendingTest || createTemplate.isPending || updateTemplate.isPending || !testEmail.trim() || !testInboxId || (testUseAiVariation && (!testAiProvider || !testAiPrompt.trim())) || (testDataMode === "contact" && !testContactId)}
                    onClick={handleSendTestTemplate}
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <TestTube className="w-4 h-4" />
                        Send test
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Add a Domain inbox to send a test.</p>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => router.push("/templates")}>
            Cancel
          </Button>
          <Button
            className="gradient-primary"
            onClick={() => saveTemplate(true)}
            disabled={createTemplate.isPending || updateTemplate.isPending}
          >
            {createTemplate.isPending || updateTemplate.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : isEdit ? (
              "Update Template"
            ) : (
              "Save Template"
            )}
          </Button>
        </div>
      </div>

      {/* AI Generate Dialog */}
      <Dialog open={aiGenerateOpen} onOpenChange={setAiGenerateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI Generate {generatingFor === "subject" ? "Subject Line" : "Template"}
            </DialogTitle>
            <DialogDescription>
              {generatingFor === "subject"
                ? "Describe what your email is about and we'll generate a compelling subject line"
                : "Describe your email template needs and we'll generate a professional template for you"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {llmConfigs.length > 1 && (
              <div className="space-y-2">
                <Label>AI Provider</Label>
                <Select value={aiProvider} onValueChange={setAiProvider}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select AI provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {llmConfigs.map((config) => (
                      <SelectItem key={config.provider} value={config.provider}>
                        {config.provider.charAt(0).toUpperCase() + config.provider.slice(1)}
                        {config.model_name && ` (${config.model_name})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {llmConfigs.length === 0 && (
              <div className="p-4 rounded-lg border border-border bg-muted/50 flex items-start gap-3 font-sans">
                <AlertCircle className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">No AI Provider Configured</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Configure an AI provider in Settings → Integrations first.
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Prompt</Label>
              <Textarea
                placeholder={
                  generatingFor === "subject"
                    ? "e.g., Follow-up email for a sales meeting about our product demo"
                    : "e.g., Create a cold outreach email for B2B SaaS companies targeting CTOs."
                }
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="min-h-[120px] bg-background"
                disabled={llmConfigs.length === 0}
              />
            </div>
            {generatedContent && generatingFor === "full" && (
              <div className="space-y-2">
                <Label>Generated Content</Label>
                <div className="p-4 rounded-lg border bg-secondary/50 max-h-[300px] overflow-y-auto">
                  <pre className="whitespace-pre-wrap text-sm">{generatedContent}</pre>
                </div>
                <Button variant="outline" onClick={handleUseGeneratedContent} className="w-full">
                  Use This Content
                </Button>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAiGenerateOpen(false);
                setGeneratedContent("");
                setAiPrompt("");
              }}
            >
              Cancel
            </Button>
            <Button
              className="gradient-primary"
              onClick={handleAIGenerate}
              disabled={generateTemplate.isPending || !aiPrompt.trim() || llmConfigs.length === 0}
            >
              {generateTemplate.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2 text-white" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Insert Unsubscribe Link Dialog */}
      <Dialog
        open={unsubscribeDialogOpen}
        onOpenChange={(open) => {
          setUnsubscribeDialogOpen(open);
          if (!open) setUnsubscribeLinkMode("tracking");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary" />
              Insert unsubscribe link
            </DialogTitle>
            <DialogDescription>
              For campaigns, <strong className="text-foreground">Pigeon unsubscribe</strong> uses the same tracking
              host as your links and fills in a unique URL when each email is sent. Choose custom only if you want a
              fixed URL (e.g. your marketing site).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <RadioGroup
              value={unsubscribeLinkMode}
              onValueChange={(v) => setUnsubscribeLinkMode(v as "tracking" | "custom")}
              className="gap-3"
            >
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <RadioGroupItem value="tracking" id="unsub-tracking" className="mt-1" />
                <div className="space-y-1">
                  <Label htmlFor="unsub-tracking" className="font-medium cursor-pointer">
                    Pigeon unsubscribe (recommended)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Inserts <code className="text-xs bg-muted px-1 rounded">{"{{unsubscribe_url}}"}</code> in the link.
                    At send time it becomes your real <code className="text-xs bg-muted px-1 rounded">/unsubscribe/…</code>{" "}
                    URL (same system as tracking links).
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-border p-3">
                <RadioGroupItem value="custom" id="unsub-custom" className="mt-1" />
                <div className="space-y-1 w-full">
                  <Label htmlFor="unsub-custom" className="font-medium cursor-pointer">
                    Custom URL
                  </Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Your own page (include &quot;unsubscribe&quot; in the path so clicks opt contacts out in Pigeon), or
                    a contact page.
                  </p>
                  <Input
                    id="unsubscribe-url"
                    type="url"
                    className="bg-background"
                    placeholder="https://yoursite.com/unsubscribe"
                    value={unsubscribeUrl}
                    onChange={(e) => setUnsubscribeUrl(e.target.value)}
                    disabled={unsubscribeLinkMode !== "custom"}
                  />
                </div>
              </div>
            </RadioGroup>
            <div className="space-y-2">
              <Label>Wording</Label>
              <Select
                value={String(unsubscribeOptionIndex)}
                onValueChange={(v) => setUnsubscribeOptionIndex(Number(v))}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNSUBSCRIBE_LINK_OPTIONS.map((text, i) => (
                    <SelectItem key={i} value={String(i)}>
                      <span className="line-clamp-2 text-left">{text.replace("{insert-unsubscribe-link-here}", "[link]")}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setUnsubscribeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="gradient-primary"
              onClick={handleInsertUnsubscribeLink}
              disabled={unsubscribeLinkMode === "custom" && !unsubscribeUrl.trim()}
            >
              Insert
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
