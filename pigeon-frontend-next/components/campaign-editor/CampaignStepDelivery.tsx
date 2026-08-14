"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ChevronDown,
  Clock,
  Globe,
  Gauge,
  Reply,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Listen } from "@/components/Listen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_GENERATION_PROMPT_PRESETS,
  getStartNowScheduleInTimezone,
  TZ_LABELS,
  WEEKDAY_TOGGLE_OPTIONS,
} from "@/lib/campaign-editor/constants";
import { TimeZoneClocks } from "@/lib/campaign-editor/timezone-clocks";
import type { CampaignFormData } from "@/lib/campaign-editor/types";
import type { LLMConfig } from "@/types/api";
import { cn } from "@/lib/utils";

type BestSendTime = {
  best_hour: number;
  best_hour_label: string;
  open_rate: number;
  based_on_sent: number;
  message: string;
} | null;

type InboxRow = { id: string; email: string; sender_type: string };
type ReplyToImapConfig = { id: string; email: string; imap_host: string };

function SubsectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
  );
}

/** Anchor targets for in-step navigation (create + edit tours can reference these ids). */
const DELIVERY_SECTION_IDS = {
  schedule: "campaign-delivery-schedule",
  volume: "campaign-delivery-volume",
  ai: "campaign-delivery-ai",
  replies: "campaign-delivery-replies",
} as const;

type DeliverySectionKey = keyof typeof DELIVERY_SECTION_IDS;

const DELIVERY_NAV_ITEMS: {
  key: DeliverySectionKey;
  title: string;
  /** Compact label for the sticky “Jump to” row */
  jumpLabel: string;
  description: string;
}[] = [
  {
    key: "schedule",
    title: "Schedule",
    jumpLabel: "Schedule",
    description: "Timezone, daily window, weekdays",
  },
  {
    key: "volume",
    title: "Volume",
    jumpLabel: "Volume",
    description: "Daily cap and multi-inbox rotation",
  },
  {
    key: "ai",
    title: "AI",
    jumpLabel: "AI",
    description: "Optional; expand only if you need it",
  },
  {
    key: "replies",
    title: "Replies & tracking",
    jumpLabel: "Replies",
    description: "Reply-To and open pixel",
  },
];

type CampaignStepDeliveryProps = {
  campaignData: CampaignFormData;
  setCampaignData: React.Dispatch<React.SetStateAction<CampaignFormData>>;
  replyToType: "default" | "none" | "gmail" | "imap" | "custom";
  setReplyToType: (v: "default" | "none" | "gmail" | "imap" | "custom") => void;
  replyToId: string | null;
  setReplyToId: (v: string | null) => void;
  replyToEmail: string;
  setReplyToEmail: (v: string) => void;
  inboxes: InboxRow[];
  replyToImapConfigs: ReplyToImapConfig[];
  llmConfigs: LLMConfig[];
  serperSettings?: { serper_configured?: boolean };
  bestSendTime: BestSendTime;
  bestSendTimeFetched: boolean;
  showListen?: boolean;
};

export function CampaignStepDelivery({
  campaignData,
  setCampaignData,
  replyToType,
  setReplyToType,
  replyToId,
  setReplyToId,
  replyToEmail,
  setReplyToEmail,
  inboxes,
  replyToImapConfigs,
  llmConfigs,
  serperSettings,
  bestSendTime,
  bestSendTimeFetched,
  showListen = false,
}: CampaignStepDeliveryProps) {
  const [aiSectionOpen, setAiSectionOpen] = useState(false);

  const scrollToDeliverySection = useCallback((key: DeliverySectionKey) => {
    const id = DELIVERY_SECTION_IDS[key];
    if (key === "ai") {
      setAiSectionOpen(true);
      window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      {/* Overview */}
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-foreground">Delivery</h2>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          Control <strong className="font-medium text-foreground">when</strong> mail goes out,{" "}
          <strong className="font-medium text-foreground">how much</strong> per day, optional{" "}
          <strong className="font-medium text-foreground">AI</strong> personalization, and{" "}
          <strong className="font-medium text-foreground">replies / opens</strong>.
        </p>
        <ol className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
          {DELIVERY_NAV_ITEMS.map((item, index) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => scrollToDeliverySection(item.key)}
                className="flex w-full gap-2 rounded-lg p-1 text-left transition-colors hover:bg-background/80 hover:ring-1 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background text-xs font-bold text-primary ring-1 ring-border">
                  {index + 1}
                </span>
                <span>
                  <span className="font-medium text-foreground">{item.title}</span>
                  {" — "}
                  {item.description}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <nav
        aria-label="Delivery sections"
        className="sticky top-2 z-10 rounded-xl border border-border bg-background/95 px-3 py-2.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Jump to
          </span>
          <div className="flex flex-wrap gap-2">
            {DELIVERY_NAV_ITEMS.map((item, index) => (
              <Button
                key={item.key}
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "h-8 gap-1.5 px-2.5 text-xs font-normal shadow-none",
                  "border-border bg-card/30 text-foreground",
                  "hover:border-primary/50 hover:bg-primary/15 hover:text-primary",
                  "dark:border-border dark:bg-card/40",
                  "dark:hover:border-primary/55 dark:hover:bg-primary/20 dark:hover:text-primary",
                  "hover:[&_.delivery-jump-num]:text-primary/90",
                )}
                onClick={() => scrollToDeliverySection(item.key)}
              >
                <span className="delivery-jump-num tabular-nums text-muted-foreground transition-colors">
                  {index + 1}.
                </span>
                <span className="font-medium">{item.jumpLabel}</span>
              </Button>
            ))}
          </div>
        </div>
      </nav>

      {/* 1 — Schedule */}
      <div id={DELIVERY_SECTION_IDS.schedule} className="scroll-mt-28">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Clock className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">1. When emails can send</CardTitle>
                <span className="rounded-md bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-border">
                  Schedule
                </span>
              </div>
              <CardDescription>
                All times use the campaign timezone below. Sending only occurs on the days you enable.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-8 pt-6">
          <div className="space-y-3">
            <SubsectionTitle>Time zone</SubsectionTitle>
            <Select
              value={campaignData.timezone}
              onValueChange={(value) => setCampaignData({ ...campaignData, timezone: value })}
            >
              <SelectTrigger className="max-w-[min(100%,280px)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                <SelectItem value="Europe/London">London (GMT)</SelectItem>
                <SelectItem value="Asia/Kolkata">India (IST)</SelectItem>
              </SelectContent>
            </Select>
            <TimeZoneClocks timezone={campaignData.timezone} />
          </div>

          <Separator />

          <div className="space-y-3">
            <SubsectionTitle>Sending window (same day)</SubsectionTitle>
            <p className="text-xs text-muted-foreground">
              Emails are queued only between these clock times in the campaign timezone.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-md">
              <div className="space-y-2">
                <Label htmlFor="delivery-start">Start</Label>
                <Input
                  id="delivery-start"
                  type="time"
                  value={campaignData.startTime}
                  onChange={(e) => setCampaignData({ ...campaignData, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delivery-end">End</Label>
                <Input
                  id="delivery-end"
                  type="time"
                  value={campaignData.endTime}
                  onChange={(e) => setCampaignData({ ...campaignData, endTime: e.target.value })}
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <SubsectionTitle>Active weekdays</SubsectionTitle>
            <p className="text-xs text-muted-foreground">At least one day must stay on. Uses the timezone above.</p>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_TOGGLE_OPTIONS.map(({ value, label }) => {
                const on = campaignData.scheduleWeekdays.includes(value);
                return (
                  <Button
                    key={value}
                    type="button"
                    variant={on ? "default" : "outline"}
                    size="sm"
                    className="min-w-[2.75rem] px-2"
                    onClick={() => {
                      setCampaignData((prev) => {
                        const next = new Set(prev.scheduleWeekdays);
                        if (next.has(value)) {
                          if (next.size <= 1) return prev;
                          next.delete(value);
                        } else {
                          next.add(value);
                        }
                        return {
                          ...prev,
                          scheduleWeekdays: Array.from(next).sort((a, b) => a - b),
                        };
                      });
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <SubsectionTitle>Quick adjustments &amp; insights</SubsectionTitle>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="space-y-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const { startTime, endTime } = getStartNowScheduleInTimezone(campaignData.timezone);
                    setCampaignData((prev) => ({
                      ...prev,
                      startTime,
                      endTime,
                    }));
                  }}
                >
                  Start from now (+12h window)
                </Button>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Sets start to current time and end to 12 hours later in the selected timezone.
                </p>
              </div>
            </div>

            {bestSendTime && (
              <div className="flex flex-col gap-3 rounded-lg border-2 border-primary/25 bg-primary/5 p-4">
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  Suggested window from your data
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {(() => {
                    const tzLabel = TZ_LABELS[campaignData.timezone] ?? campaignData.timezone;
                    const openRate =
                      typeof bestSendTime.open_rate === "number"
                        ? bestSendTime.open_rate.toFixed(1)
                        : bestSendTime.open_rate;
                    return `In ${tzLabel}, opens were strongest around ${bestSendTime.best_hour_label} (${openRate}% open rate, last 30 days, ${bestSendTime.based_on_sent} emails).`;
                  })()}
                </p>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="w-fit gap-2"
                  onClick={() => {
                    const h = bestSendTime.best_hour;
                    const startH = Math.max(0, Math.min(23, h));
                    const endH = (startH + 6) % 24;
                    setCampaignData((prev) => ({
                      ...prev,
                      startTime: `${String(startH).padStart(2, "0")}:00`,
                      endTime: `${String(endH).padStart(2, "0")}:00`,
                    }));
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                  Apply suggested window
                </Button>
              </div>
            )}
            {bestSendTimeFetched && !bestSendTime && (
              <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/40 px-3 py-2.5">
                After you send more campaigns, we&apos;ll suggest a window based on your open rates.
              </p>
            )}

            <div className="flex items-start gap-3 rounded-lg border border-border/80 bg-muted/30 px-3 py-3">
              <Globe className="h-4 w-4 shrink-0 text-primary mt-0.5" aria-hidden />
              <p className="text-sm text-muted-foreground leading-relaxed">
                When we know a recipient&apos;s timezone, sends can align with their business hours as well.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* 2 — Volume */}
      <div id={DELIVERY_SECTION_IDS.volume} className="scroll-mt-28">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Gauge className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">2. Volume &amp; inbox rotation</CardTitle>
                <span className="rounded-md bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-border">
                  Limits
                </span>
              </div>
              <CardDescription>
                Cap total sends per day for this campaign. Turn on rotation only when multiple inboxes are selected in
                Basics.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-3">
            <SubsectionTitle>Daily send cap</SubsectionTitle>
            <p className="text-xs text-muted-foreground">Maximum emails this campaign may send per calendar day (all inboxes combined).</p>
            <div className="flex flex-wrap items-center gap-4">
              <Input
                type="number"
                min={1}
                value={campaignData.dailyLimit}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  const clamped = Number.isNaN(v) ? 30 : Math.max(1, v);
                  setCampaignData({ ...campaignData, dailyLimit: clamped, dailyLimitTouched: true });
                }}
                className="h-11 w-28 text-center font-semibold tabular-nums"
                aria-label="Daily email limit"
              />
              <span className="text-sm text-muted-foreground">emails / day</span>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                <Users className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground">Rotate across inboxes</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Spread each day&apos;s sends across the accounts you picked in Basics.
                  {campaignData.senderType === "gmail" &&
                    campaignData.senderIds.length === 1 &&
                    " Connect another Gmail inbox to enable rotation."}
                </p>
              </div>
            </div>
            <Switch
              checked={campaignData.enableRotation}
              disabled={campaignData.senderIds.length === 0}
              onCheckedChange={(checked) => setCampaignData({ ...campaignData, enableRotation: checked })}
              className="shrink-0"
              aria-label="Enable inbox rotation"
            />
          </div>
        </CardContent>
      </Card>
      </div>

      {/* 3 — AI (collapsible) */}
      <div id={DELIVERY_SECTION_IDS.ai} className="scroll-mt-28">
      <Collapsible
        open={aiSectionOpen}
        onOpenChange={setAiSectionOpen}
        className="group rounded-xl border border-border bg-card shadow-sm"
      >
        <CollapsibleTrigger className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/40 rounded-t-xl transition-colors sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Sparkles className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">3. Optional AI &amp; web enrichment</span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Advanced
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Per-recipient rewrites and optional Serper-backed research. Skip unless you need it — adds cost and
                latency.
              </p>
            </div>
          </div>
          <ChevronDown
            className={cn(
              "mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 sm:mt-0",
              "group-data-[state=open]:rotate-180"
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-6 border-t border-border px-4 pb-6 pt-5">
            <div className="rounded-xl border border-accent/25 bg-accent/5">
              <div className="border-b border-border/60 px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-accent" />
                  AI email variation
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Rewrites each send for uniqueness. Configure an LLM under Settings → Integrations first.
                </p>
              </div>
              <div className="space-y-4 p-4">
                <div className="flex flex-col gap-4 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">Enable AI variation</p>
                    <p className="text-sm text-muted-foreground">Different wording per recipient from the same template.</p>
                  </div>
                  <Switch
                    checked={campaignData.useAiGeneration}
                    onCheckedChange={(checked) => {
                      if (checked && !llmConfigs.length) {
                        toast.error("Configure an AI provider in Settings → Integrations to enable this feature");
                        return;
                      }
                      setCampaignData({ ...campaignData, useAiGeneration: checked });
                      if (checked && llmConfigs.length > 0 && !campaignData.aiGenerationProvider) {
                        setCampaignData({
                          ...campaignData,
                          useAiGeneration: checked,
                          aiGenerationProvider: llmConfigs[0].provider,
                        });
                      }
                    }}
                    disabled={llmConfigs.length === 0}
                  />
                </div>

                {llmConfigs.length === 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    Add an AI provider in Settings → Integrations to use this.
                  </div>
                )}

                {campaignData.useAiGeneration && (
                  <>
                    <div className="space-y-2">
                      <Label>Provider</Label>
                      <Select
                        value={campaignData.aiGenerationProvider}
                        onValueChange={(value) => setCampaignData({ ...campaignData, aiGenerationProvider: value })}
                      >
                        <SelectTrigger>
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

                    <div className="space-y-2">
                      <Label>Prompt</Label>
                      <Select
                        value={
                          AI_GENERATION_PROMPT_PRESETS.includes(campaignData.aiGenerationPrompt)
                            ? campaignData.aiGenerationPrompt
                            : ""
                        }
                        onValueChange={(value) => setCampaignData({ ...campaignData, aiGenerationPrompt: value })}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="Preset or edit below…" />
                        </SelectTrigger>
                        <SelectContent>
                          {AI_GENERATION_PROMPT_PRESETS.map((prompt) => (
                            <SelectItem key={prompt} value={prompt} className="whitespace-normal">
                              {prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Textarea
                        placeholder="How should the AI rewrite each email? Variables are preserved automatically."
                        value={campaignData.aiGenerationPrompt}
                        onChange={(e) => setCampaignData({ ...campaignData, aiGenerationPrompt: e.target.value })}
                        className="min-h-[100px]"
                      />
                    </div>

                    <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                      <strong className="font-medium text-foreground">Cost:</strong> Charged per send. For moderate
                      volume, Spintax in templates is often cheaper than full AI rewrites.
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-primary/20 bg-muted/25">
              <div className="border-b border-border/60 px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Search className="h-4 w-4 text-primary" />
                  Web context (Serper)
                </h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  We start with short blurbs from web search—like the lines you see under each Google result. If it helps
                  the email, we may open <strong className="font-medium text-foreground">up to two</strong> of those same
                  results for a little more detail. We never follow random links; only ones search already found, and we
                  respect what each site allows. To use this, add your Serper key in{" "}
                  <Link href="/settings?tab=integrations#serper" className="font-medium text-primary underline-offset-4 hover:underline">
                    Settings → Integrations → Serper
                  </Link>
                  .
                </p>
              </div>
              <div className="space-y-4 p-4">
                <div className="flex flex-col gap-4 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">Enable web enrichment</p>
                    <p className="text-sm text-muted-foreground">
                      Looks up public info about each person or company, then tweaks your template so the email feels
                      more relevant. If the lookup doesn&apos;t work, they still get your normal email.
                    </p>
                  </div>
                  <Switch
                    checked={campaignData.useExternalEnrichment}
                    onCheckedChange={(checked) => {
                      if (checked && !llmConfigs.length) {
                        toast.error("Configure an AI provider in Settings → Integrations first");
                        return;
                      }
                      if (checked && serperSettings?.serper_configured === false) {
                        toast.error("Add a Serper API key under Settings → Integrations → Serper to enable web search.");
                        return;
                      }
                      setCampaignData({
                        ...campaignData,
                        useExternalEnrichment: checked,
                        ...(checked && llmConfigs.length && !campaignData.externalEnrichmentProvider
                          ? { externalEnrichmentProvider: llmConfigs[0].provider }
                          : {}),
                      });
                    }}
                    disabled={llmConfigs.length === 0}
                  />
                </div>
                {serperSettings?.serper_configured === false && (
                  <div className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Serper not configured.{" "}
                      <Link href="/settings?tab=integrations#serper" className="font-medium text-primary underline-offset-4 hover:underline">
                        Add API key
                      </Link>
                    </span>
                  </div>
                )}
                {campaignData.useExternalEnrichment && (
                  <>
                    <div className="space-y-2">
                      <Label>LLM for enrichment</Label>
                      <Select
                        value={campaignData.externalEnrichmentProvider}
                        onValueChange={(value) => setCampaignData({ ...campaignData, externalEnrichmentProvider: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select provider" />
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
                      <p className="text-xs text-muted-foreground">Several LLM calls per recipient — watch your daily limit.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Extra instructions (optional)</Label>
                      <Textarea
                        placeholder='e.g. "Mention one recent public signal. Stay professional."'
                        value={campaignData.externalEnrichmentPrompt}
                        onChange={(e) => setCampaignData({ ...campaignData, externalEnrichmentPrompt: e.target.value })}
                        className="min-h-[80px]"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      </div>

      {/* 4 — Replies & tracking */}
      <div id={DELIVERY_SECTION_IDS.replies} className="scroll-mt-28">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Reply className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">4. Replies &amp; open tracking</CardTitle>
                  <span className="rounded-md bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ring-1 ring-border">
                    Inbox
                  </span>
                </div>
                <CardDescription>Where replies go and whether opens are measured.</CardDescription>
              </div>
            </div>
            {showListen ? <Listen componentId="ReplyFlow" /> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-8 pt-6">
          {(campaignData.senderType === "gmail" || campaignData.senderType === "smtp") && (
            <div className="relative overflow-hidden rounded-lg border border-primary/80 bg-gradient-to-br from-primary/90 to-slate-50/50 p-4 dark:border-primary/40 dark:from-primary/30 dark:to-background/80">
              <div className="absolute left-0 top-0 h-full w-1 rounded-l-lg bg-gradient-to-b from-primary to-primary/70" />
              <div className="space-y-1 pl-3">
                <p className="text-sm font-semibold text-foreground">Default behavior for your sender type</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {campaignData.senderType === "gmail" && (
                    <>Gmail: replies usually hit your connected inbox and are tracked without a separate Reply-To.</>
                  )}
                  {campaignData.senderType === "smtp" && (
                    <>
                      SMTP: if <span className="font-medium text-foreground">Enable Receiving</span> is on for the domain,
                      replies can go to the sending inbox automatically.
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <SubsectionTitle>Reply-To header</SubsectionTitle>
            <p className="text-xs text-muted-foreground">
              Overrides where the email client sends replies. Use Settings default, none, Gmail, IMAP, or a custom address.
            </p>
            <Label htmlFor="reply-to-mode" className="sr-only">
              Reply-To mode
            </Label>
            <Select
              value={replyToType}
              onValueChange={(v: "default" | "none" | "gmail" | "imap" | "custom") => {
                setReplyToType(v);
                setReplyToId(null);
                if (v !== "custom") setReplyToEmail("");
              }}
            >
              <SelectTrigger id="reply-to-mode" className="h-11 max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Use default (from Settings)</SelectItem>
                <SelectItem value="none">None (sender address)</SelectItem>
                <SelectItem value="gmail">Gmail account</SelectItem>
                <SelectItem value="imap">IMAP account</SelectItem>
                <SelectItem value="custom">Custom email</SelectItem>
              </SelectContent>
            </Select>

            {replyToType === "custom" && (
              <Input
                type="email"
                placeholder="e.g. replies@yourcompany.com"
                value={replyToEmail}
                onChange={(e) => setReplyToEmail(e.target.value)}
                className="h-11 max-w-md"
              />
            )}

            {replyToType === "gmail" && (
              <Select value={replyToId ?? ""} onValueChange={(v) => setReplyToId(v || null)}>
                <SelectTrigger className="h-11 max-w-md">
                  <SelectValue placeholder="Select Gmail account" />
                </SelectTrigger>
                <SelectContent>
                  {inboxes
                    .filter((i) => i.sender_type === "gmail")
                    .map((inb) => (
                      <SelectItem key={inb.id} value={inb.id}>
                        {inb.email}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}

            {replyToType === "imap" && (
              <div className="space-y-2 max-w-md">
                <Select value={replyToId ?? ""} onValueChange={(v) => setReplyToId(v || null)}>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select IMAP account" />
                  </SelectTrigger>
                  <SelectContent>
                    {replyToImapConfigs.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.email} ({c.imap_host})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Manage accounts in{" "}
                  <Link href="/settings?tab=integrations" className="text-primary underline-offset-4 hover:underline">
                    Integrations
                  </Link>
                  .
                </p>
              </div>
            )}

            <div className="rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
              {replyToType === "default" && "Uses the default Reply-To from Settings."}
              {replyToType === "none" && "Replies go to the visible From address."}
              {replyToType === "gmail" && "Replies go to the selected Gmail and appear in the app inbox."}
              {replyToType === "imap" && "Replies go to the selected IMAP mailbox and are tracked in the app."}
              {replyToType === "custom" && "Replies go to the address you entered."}
            </div>

            {replyToType === "custom" && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
                <div className="flex gap-3">
                  <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-destructive">Custom address limitation</p>
                    <p className="text-destructive/90 leading-relaxed dark:text-destructive/80">
                      Reply rate won&apos;t be tracked in-app and messages won&apos;t show in the unified inbox. Prefer
                      Gmail or IMAP Reply-To for full tracking.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <SubsectionTitle>Open tracking</SubsectionTitle>
            <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Label htmlFor="open-tracking-toggle" className="text-sm font-medium text-foreground">
                  Open tracking pixel
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  Inserts a small hidden image so you can see when recipients open the email.
                </p>
              </div>
              <Switch
                id="open-tracking-toggle"
                checked={campaignData.openTracking}
                onCheckedChange={(checked) => setCampaignData({ ...campaignData, openTracking: checked })}
                className="shrink-0"
              />
            </div>
          </div>

          <Separator />

          <div className="rounded-lg border border-border bg-card px-4 py-4">
            <p className="text-sm font-medium text-foreground">Choosing a Reply-To</p>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success text-xs font-bold">
                  ✓
                </span>
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">Set one</span> when you want replies in one place and
                  tracked in Pigeon.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-bold">
                  —
                </span>
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">Leave default / none</span> for one-way blasts where you
                  don&apos;t need a shared reply inbox.
                </span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
      </div>
    </motion.div>
  );
}
