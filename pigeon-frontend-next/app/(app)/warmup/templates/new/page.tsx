"use client";

import { useState, useEffect, useMemo, useRef, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  Lightbulb,
  Sparkles,
  Loader2,
  AlertCircle,
  Eye,
  RefreshCw,
  Variable,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanGate } from "@/hooks/usePlanGate";
import { useCreateWarmupSendTemplate } from "@/hooks/useWarmup";
import { useLLMConfigs, useGenerateTemplate } from "@/hooks/useLLM";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  htmlToPlainText,
  plainTextToHtml,
  looksLikeHtml,
  replacePlaceholdersWithWarmupSample,
} from "@/lib/templateBody";
import { IsolatedPreview } from "@/components/IsolatedPreview";
import { RichTextEditor } from "@/components/RichTextEditor";
import { toast } from "sonner";

const WARMUP_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: "receiver_email", label: "Receiver email" },
  { key: "receiver_name", label: "Receiver name" },
  { key: "receiverEmail", label: "Receiver email (alt)" },
  { key: "receiverName", label: "Receiver name (alt)" },
  { key: "sender_email", label: "Sender email" },
  { key: "sender_name", label: "Sender name" },
  { key: "senderEmail", label: "Sender email (alt)" },
  { key: "senderName", label: "Sender name (alt)" },
];

function warmupBodyHasContent(body: string, bodyType: "html" | "plain" | "rich"): boolean {
  const b = body.trim();
  if (!b) return false;
  if (bodyType === "plain") return true;
  return htmlToPlainText(b).trim().length > 0 || /<img\b/i.test(b);
}

function stripLlmCodeFences(raw: string): string {
  let c = raw.trim();
  if (c.includes("```json")) {
    const m = c.match(/```json\s*([\s\S]*?)\s*```/i);
    if (m) c = m[1].trim();
  } else if (c.includes("```")) {
    const m = c.match(/```\s*([\s\S]*?)\s*```/);
    if (m) c = m[1].trim();
  }
  return c;
}

function buildWarmupAiPrompt(about: string, bodyType: "html" | "plain" | "rich"): string {
  const formatBlock =
    bodyType === "plain"
      ? `BODY FORMAT — PLAIN TEXT (required):
- The "body" field MUST be plain text only: real line breaks, no HTML tags, no markdown (**bold** or similar).`
      : `BODY FORMAT — HTML (required):
- The "body" field MUST be HTML suitable for email: inline CSS (e.g. style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.5") on <p> or a wrapping <div>.
- Use <p>, <br>, <strong> as needed. No external stylesheets, no scripts, no tracking pixels.`;

  return `You are writing a single inbox warmup email template (subject + body). Warmup sends neutral, human-like messages between real addresses for deliverability—NOT sales blasts or marketing newsletters.

USER REQUEST — WHAT THIS EMAIL SHOULD BE ABOUT:
${about.trim()}

${formatBlock}

WARMUP MERGE VARIABLES ONLY (snake_case and camelCase): {{sender_name}} {{sender_email}} {{senderName}} {{senderEmail}} {{receiver_name}} {{receiver_email}} {{receiverName}} {{receiverEmail}}

1) SPINTAX — {option1|option2|option3} in subject/body; resolved first, then merge variables. Example: {Hi|Hello} {{receiver_name}}, … {{sender_name}}.

2) COMBINE — Prefer spintax plus at least one of the four merge fields above when it fits the topic.

CRITICAL OUTPUT RULES:
1. Return ONLY valid JSON with exactly two keys: "subject" and "body". No "name" field. No markdown fences. No text outside JSON.
2. Subject: one line, no "Subject:" prefix.
3. Tone: casual, authentic, matching the user request.

JSON shape:
{"subject":"...","body":"..."}`;
}

export default function NewWarmupTemplatePage() {
  const router = useRouter();
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const warmupGate = usePlanGate("warmup");
  const aiGate = usePlanGate("ai_emails");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeAiOpen, setUpgradeAiOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodyType, setBodyType] = useState<"html" | "plain" | "rich">("rich");
  const richEditorRef = useRef<import("@/components/RichTextEditor").RichTextEditorRef>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [aiAbout, setAiAbout] = useState("");
  const [aiProvider, setAiProvider] = useState("");
  const [aiWriteOpen, setAiWriteOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const { data: llmConfigs = [] } = useLLMConfigs(userId);
  const generateTemplate = useGenerateTemplate();
  const createTemplate = useCreateWarmupSendTemplate();

  useEffect(() => {
    if (llmConfigs.length > 0 && !aiProvider) {
      setAiProvider(llmConfigs[0].provider);
    }
  }, [llmConfigs, aiProvider]);

  const previewResolved = useMemo(() => {
    return {
      subject: replacePlaceholdersWithWarmupSample(subject),
      body: replacePlaceholdersWithWarmupSample(body),
    };
  }, [subject, body, previewKey]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const s = subject.trim();
    const b = body.trim();
    if (!s || !warmupBodyHasContent(b, bodyType)) return;
    try {
      await createTemplate.mutateAsync({ subject: s, body: b, body_type: bodyType });
      router.push("/warmup/templates");
    } catch {
      // Hook shows error toast
    }
  };

  const handleAiWrite = async () => {
    if (aiGate.atLimit) {
      setUpgradeAiOpen(true);
      toast.error(aiGate.upgradeLine ?? "AI Write is available on higher plans.");
      return;
    }
    if (llmConfigs.length === 0) {
      toast.error("Configure an AI provider in Settings → Integrations first.");
      return;
    }
    const about = aiAbout.trim();
    if (!about) {
      toast.error("Describe what this email should be about so AI can generate subject and body.");
      return;
    }
    const provider = aiProvider || llmConfigs[0]?.provider;
    if (!provider) {
      toast.error("Select an AI provider.");
      return;
    }
    if (!userId) {
      toast.error("You must be signed in to use AI Write.");
      return;
    }
    try {
      const result = await generateTemplate.mutateAsync({
        userId,
        provider,
        prompt: buildWarmupAiPrompt(about, bodyType),
      });
      let content = stripLlmCodeFences((result?.content ?? "").trim());
      const parsed = JSON.parse(content) as { subject?: string; body?: string };
      const subjectRaw = String(parsed.subject ?? "").trim();
      let bodyRaw = String(parsed.body ?? "").trim();
      if (!subjectRaw || !bodyRaw) {
        toast.error("AI response was missing subject or body. Try again with a bit more detail.");
        return;
      }
      if (bodyType === "plain") {
        bodyRaw = looksLikeHtml(bodyRaw) ? htmlToPlainText(bodyRaw) : bodyRaw;
      } else {
        bodyRaw = looksLikeHtml(bodyRaw) ? bodyRaw : plainTextToHtml(bodyRaw);
      }
      setSubject(subjectRaw);
      setBody(bodyRaw);
      setPreviewKey((k) => k + 1);
      setAiWriteOpen(false);
      toast.success("Subject and body filled. Check Preview below, then save when ready.");
    } catch {
      toast.error("Could not parse AI response. Try again or adjust what the email should be about.");
    }
  };

  if (warmupGate.atLimit) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/warmup/templates">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Add template</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              Warmup send templates are available on plans that include inbox warmup.
            </p>
            <Button onClick={() => setUpgradeOpen(true)}>Upgrade plan</Button>
          </CardContent>
        </Card>
        <UpgradeModal featureKey="warmup" gate={warmupGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UpgradeModal featureKey="warmup" gate={warmupGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <UpgradeModal featureKey="ai_emails" gate={aiGate} open={upgradeAiOpen} onOpenChange={setUpgradeAiOpen} />

      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/warmup/templates">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6" />
            Add warmup template
          </h1>
          <p className="text-muted-foreground mt-1">
            One subject and one body per template. The system picks one random template per warmup send.
          </p>
        </div>
      </div>

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="py-3 px-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Choose <strong className="font-medium text-foreground">Plain text</strong>,{" "}
            <strong className="font-medium text-foreground">HTML</strong>, or{" "}
            <strong className="font-medium text-foreground">Rich text</strong> (same as campaign templates). Plain uses{" "}
            <code className="text-xs bg-muted px-1 rounded">text/plain</code>; HTML and Rich text send as{" "}
            <code className="text-xs bg-muted px-1 rounded">text/html</code>. Include both a subject and a body for each
            warmup template.
          </p>
          <div className="text-sm text-muted-foreground border-t border-amber-500/20 pt-3">
            <p className="font-medium text-foreground mb-1.5">Merge fields (warmup only — replaced on each send)</p>
            <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm">
              <li>
                <strong className="text-foreground">Receiver (pool account)</strong> —{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{receiver_email}}"}</code>,{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{receiver_name}}"}</code> (and{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{receiverEmail}}"}</code>,{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{receiverName}}"}</code>)
              </li>
              <li>
                <strong className="text-foreground">Sender (your warming inbox)</strong> —{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{sender_email}}"}</code>,{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{sender_name}}"}</code> (and{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{senderEmail}}"}</code>,{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{senderName}}"}</code>)
              </li>
              <li>
                <strong className="text-foreground">Warmup Network only</strong> —{" "}
                <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{tracking_link}}"}</code> is no longer
                transformed into a tracked redirect URL. Use your own normal link if needed.
              </li>
            </ul>
          </div>
          <div className="text-sm text-muted-foreground border-t border-amber-500/20 pt-3">
            <p className="font-medium text-foreground mb-1.5">Spintax (same as campaign templates)</p>
            <p className="text-xs sm:text-sm">
              Use curly braces with options separated by <code className="text-[0.7rem] bg-muted px-1 rounded">|</code> —
              one option is picked at random on each send, e.g.{" "}
              <code className="text-[0.7rem] bg-muted px-1 rounded">{"{Hi|Hello|Hey}"}</code>{" "}
              <code className="text-[0.7rem] bg-muted px-1 rounded">{"{{receiver_name}}"}</code>. Spintax is resolved first,
              then merge fields.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 px-4 flex items-start gap-3">
          <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            We recommend adding at least <strong>10 warmup send templates</strong> for best results. More variety helps warmup traffic look natural to providers.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New template</CardTitle>
          <CardDescription>Subject line and body for one warmup email template.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="body-type">Body format</Label>
                <Select value={bodyType} onValueChange={(v: "html" | "plain" | "rich") => setBodyType(v)}>
                  <SelectTrigger id="body-type" className="w-[160px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="html">HTML</SelectItem>
                    <SelectItem value="plain">Plain Text</SelectItem>
                    <SelectItem value="rich">Rich Text</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {bodyType !== "rich" && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <p>
                    For raw HTML from AI tools, pick <strong className="text-foreground">HTML</strong> and paste here.
                    Use <strong className="text-foreground">Rich text</strong> for the visual editor (same as campaign
                    templates).
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                HTML and Rich text are sent as <code className="text-[0.7rem]">text/html</code>; plain as{" "}
                <code className="text-[0.7rem]">text/plain</code>. AI Write uses HTML rules for HTML and Rich text. Merge
                fields and spintax <code className="text-[0.7rem] bg-muted px-0.5 rounded">{"{a|b}"}</code> work in
                subject and body (same as campaign templates).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                onClick={() => setAiWriteOpen(true)}
              >
                <Sparkles className="h-4 w-4" />
                AI Write
              </Button>
              <p className="text-xs text-muted-foreground">
                Open the assistant to generate subject and body from a short topic (uses your body format above).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder='e.g. {Quick check-in|Following up} — or plain text'
                required
              />
              <p className="text-xs text-muted-foreground">
                Merge fields ({`{{receiver_email}}`}, {`{{sender_name}}`}, …) and spintax ({`{Hi|Hello}`}) apply on
                each send—spintax first, then variables.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="body">Body</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="gap-1">
                      <Variable className="h-3.5 w-3.5" />
                      Insert merge field
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {WARMUP_MERGE_FIELDS.map(({ key, label }) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => {
                          const token = `{{${key}}}`;
                          if (bodyType === "rich") {
                            richEditorRef.current?.editor?.chain().focus().insertContent(token).run();
                          } else {
                            const el = bodyTextareaRef.current;
                            const v = body;
                            const start = el?.selectionStart ?? v.length;
                            const end = el?.selectionEnd ?? v.length;
                            setBody(v.slice(0, start) + token + v.slice(end));
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
              </div>
              {bodyType === "rich" ? (
                <RichTextEditor
                  ref={richEditorRef}
                  value={body}
                  onChange={setBody}
                  placeholder="Hi {{receiver_name}}, write your warmup message here…"
                  className="min-h-[280px]"
                />
              ) : (
                <Textarea
                  ref={bodyTextareaRef}
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder='e.g. {Hope you are well|Just wanted to say hi}. — or plain / HTML'
                  rows={6}
                  required
                  className="font-mono text-sm min-h-[200px]"
                />
              )}
            </div>

            <Card className="border-dashed bg-muted/20">
              <CardHeader className="pb-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Eye className="h-4 w-4 shrink-0" />
                      Preview
                    </CardTitle>
                    <CardDescription>
                      Shows one random spintax outcome plus sample merge values (e.g. recipient John, sender Alex).
                      Re-roll to try another spintax pick. Not saved.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => setPreviewKey((k) => k + 1)}
                    disabled={!subject.trim() && !body.trim()}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-roll spintax
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {!subject.trim() && !body.trim() ? (
                  <p className="text-sm text-muted-foreground">Add a subject or body to see a preview.</p>
                ) : (
                  <>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Subject</p>
                      <p className="text-sm font-medium rounded-md border bg-background px-3 py-2 break-words">
                        {previewResolved.subject.trim() || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Body</p>
                      <IsolatedPreview
                        mode={bodyType === "plain" ? "plain" : bodyType}
                        html={previewResolved.body}
                        plainText={previewResolved.body}
                        title="Warmup template preview"
                        className="min-h-[200px] max-h-[400px] w-full rounded-lg border bg-white overflow-hidden"
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={!subject.trim() || !warmupBodyHasContent(body, bodyType) || createTemplate.isPending}
              >
                {createTemplate.isPending ? "Saving…" : "Add template"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/warmup/templates">Cancel</Link>
              </Button>
            </div>
          </form>

          <Dialog open={aiWriteOpen} onOpenChange={setAiWriteOpen}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary shrink-0" />
                  AI Write
                </DialogTitle>
                <DialogDescription>
                  Generates subject + body using your topic, the selected HTML, Rich text, or plain format, merge
                  variables ({`{{receiver_name}}`}, {`{{sender_email}}`}, etc.), and spintax ({`{Hi|Hello}`})—same rules
                  as the editor below. Use Preview to see a sample send after you generate or edit.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-1">
                {llmConfigs.length === 0 && (
                  <div className="flex items-start gap-3 rounded-md border border-border bg-muted/50 p-3 text-sm">
                    <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-foreground">No AI provider configured</p>
                      <p className="text-muted-foreground mt-1">
                        Add an API key under{" "}
                        <Link href="/settings?tab=integrations" className="text-primary underline hover:no-underline">
                          Settings → Integrations
                        </Link>
                        .
                      </p>
                    </div>
                  </div>
                )}
                {llmConfigs.length > 1 && (
                  <div className="space-y-2">
                    <Label>AI provider</Label>
                    <Select value={aiProvider} onValueChange={setAiProvider}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {llmConfigs.map((config) => (
                          <SelectItem key={config.provider} value={config.provider}>
                            {config.provider.charAt(0).toUpperCase() + config.provider.slice(1)}
                            {config.model_name ? ` (${config.model_name})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="warmup-ai-about-dialog">
                    What should this email be about?{" "}
                    <span className="text-muted-foreground font-normal">(used by AI Write)</span>
                  </Label>
                  <Textarea
                    id="warmup-ai-about-dialog"
                    value={aiAbout}
                    onChange={(e) => setAiAbout(e.target.value)}
                    placeholder="e.g. a friendly check-in between colleagues, catching up after the weekend, short follow-up on a shared project…"
                    rows={4}
                    className="bg-background resize-y min-h-[100px]"
                    disabled={llmConfigs.length === 0}
                  />
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setAiWriteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="gap-2"
                  onClick={() => void handleAiWrite()}
                  disabled={generateTemplate.isPending || llmConfigs.length === 0 || !aiAbout.trim()}
                  title={!aiAbout.trim() ? "Describe what the email should be about first" : undefined}
                >
                  {generateTemplate.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {aiGate.atLimit ? "Upgrade for AI Write" : "AI Write"}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
