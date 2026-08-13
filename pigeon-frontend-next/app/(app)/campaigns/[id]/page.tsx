"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Link from "next/link";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  BarChart3,
  Loader2,
  Mail,
  MessageSquare,
  MousePointerClick,
  Pause,
  Play,
  Search,
  Settings,
  Square,
  Users,
  Download,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  useCampaign,
  useCampaignContacts,
  useCampaignStats,
  useCampaignStatsByTemplate,
  usePauseCampaign,
  useStartCampaign,
} from "@/hooks/useCampaigns";
import { useTemplates } from "@/hooks/useTemplates";
import { useAuth } from "@/contexts/AuthContext";
import { HealthScoreTooltip } from "@/components/HealthScoreTooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { CampaignAbAnalyticsTab } from "@/components/CampaignAbAnalyticsTab";
import { CampaignPlacementTab } from "@/components/campaigns/CampaignPlacementTab";
import { CampaignLeadsTab } from "@/components/campaigns/CampaignLeadsTab";
import { toast } from "sonner";
import { EmailHtmlViewer } from "@/components/EmailHtmlViewer";
import { useInboxes } from "@/hooks/useInboxes";

function getSequenceProgress(
  events: { type: string; timestamp?: string; metadata?: Record<string, any> }[] | undefined,
  totalSequenceSteps: number,
) {
  if (!totalSequenceSteps || !events?.length) {
    return { stepsCompleted: 0, progressPercent: 0 };
  }

  const sentEvents = events.filter((e) => e.type === "sent");
  if (!sentEvents.length) {
    return { stepsCompleted: 0, progressPercent: 0 };
  }

  const uniqueKeys = new Set<string | number>();

  for (const event of sentEvents) {
    const meta = event.metadata || {};
    const sequenceStep = typeof meta.sequence_step === "number" ? meta.sequence_step : undefined;
    if (sequenceStep && Number.isFinite(sequenceStep) && sequenceStep > 0) {
      uniqueKeys.add(sequenceStep);
      continue;
    }

    if (meta.template_id && typeof meta.template_id === "string") {
      uniqueKeys.add(`tpl:${meta.template_id}`);
      continue;
    }

    if (event.timestamp) {
      try {
        const key = new Date(event.timestamp).toISOString().slice(0, 16);
        uniqueKeys.add(key);
        continue;
      } catch {
        // ignore parse error and fall through
      }
    }

    // Fallback: ensure at least one key so we count progress
    uniqueKeys.add("fallback");
  }

  const stepsCompleted = Math.min(uniqueKeys.size || 0, totalSequenceSteps);
  const progressPercent =
    totalSequenceSteps > 0 ? (stepsCompleted / totalSequenceSteps) * 100 : 0;

  return { stepsCompleted, progressPercent };
}

function getSequenceStepLabel(stepIndex: number): string {
  if (stepIndex <= 1) return "Initial email";
  return `Follow-up ${stepIndex - 1}`;
}

function formatJobDateLocal(s: string | undefined): string {
  if (!s) return "—";
  try {
    let iso = s.trim();
    if (iso && !/Z$|[+-]\d{2}:?\d{2}$/.test(iso)) {
      iso = `${iso}Z`;
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

function getJobStatusBadge(status: string) {
  switch (status) {
    case "success":
      return (
        <Badge className="bg-success text-success-foreground border-success hover:bg-success hover:text-success-foreground">
          Completed
        </Badge>
      );
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "running":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Running
        </Badge>
      );
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    case "cancelled":
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getContactStatusBadge(status: string) {
  switch (status) {
    case "sent":
      return <Badge className="bg-primary hover:bg-primary">Sent</Badge>;
    case "opened":
      return <Badge className="bg-success hover:bg-success">Opened</Badge>;
    case "clicked":
      return <Badge className="bg-primary hover:bg-primary">Clicked</Badge>;
    case "replied":
      return <Badge className="bg-primary hover:bg-primary">Replied</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getContactEventIcon(type: string) {
  switch (type) {
    case "sent":
      return <Mail className="w-4 h-4 text-primary" />;
    case "opened":
      return <MousePointerClick className="w-4 h-4 text-green-500" />;
    case "clicked":
      return <ExternalLink className="w-4 h-4 text-primary" />;
    case "replied":
      return <MessageSquare className="w-4 h-4 text-primary" />;
    case "failed":
      return <AlertCircle className="w-4 h-4 text-destructive" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

export default function CampaignDetailPage() {
  const { user, effectiveUserId } = useAuth();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const id = typeof params.id === "string" ? params.id : "";
  const userId = effectiveUserId;

  const rawTab = searchParams.get("tab");
  const initialTab: "analytics" | "actions" | "contacts" | "ab" | "placement" | "leads" =
    rawTab === "actions" || rawTab === "contacts" || rawTab === "ab" || rawTab === "placement" || rawTab === "leads"
      ? rawTab
      : "analytics";
  const [activeTab, setActiveTab] = useState<"analytics" | "actions" | "contacts" | "ab" | "placement" | "leads">(initialTab);

  useEffect(() => {
    if (rawTab === "actions" || rawTab === "contacts" || rawTab === "ab" || rawTab === "placement" || rawTab === "leads") {
      setActiveTab(rawTab);
    }
  }, [rawTab]);

  const { data: campaign, isLoading: campaignLoading } = useCampaign(id);
  const { data: stats, isLoading: statsLoading } = useCampaignStats(id);
  const { data: contacts = [], isLoading: contactsLoading } = useCampaignContacts(id);
  const { data: statsByTemplate, isLoading: statsByTemplateLoading } = useCampaignStatsByTemplate(id);
  const { data: templates = [], isLoading: templatesLoading } = useTemplates(userId);
  const { data: inboxes = [] } = useInboxes(userId);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [replyPreview, setReplyPreview] = useState<string | null>(null);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [listStatuses, setListStatuses] = useState<string[]>(["opened"]);

  const queryClient = useQueryClient();
  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ["campaign-jobs", id],
    queryFn: () => api.campaigns.getJobs(id),
    enabled: !!id,
  });
  const stopJobMutation = useMutation({
    mutationFn: (jobId: string) => api.campaigns.stopJob(id, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-jobs", id] });
    },
  });

  const filteredContacts = useMemo(() => {
    const filtered = contacts.filter((cc) => {
      const email = cc.contact_details?.email ?? "";
      const firstName = cc.contact_details?.first_name ?? "";
      const lastName = cc.contact_details?.last_name ?? "";
      const query = searchQuery.toLowerCase();

      const matchesSearch =
        email.toLowerCase().includes(query) ||
        firstName.toLowerCase().includes(query) ||
        lastName.toLowerCase().includes(query);

      const matchesStatus = statusFilter === "all" || cc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    return [...filtered].sort((a, b) => {
      const aTime = a.last_activity ? new Date(a.last_activity).getTime() : 0;
      const bTime = b.last_activity ? new Date(b.last_activity).getTime() : 0;
      return bTime - aTime;
    });
  }, [contacts, searchQuery, statusFilter]);

  const contactMatchesStatuses = (
    statuses: string[],
    events: { type: string }[] | undefined
  ): boolean => {
    if (!statuses.length) return true;
    const types = new Set((events || []).map((e) => e.type));
    return statuses.every((s) => types.has(s));
  };

  const contactsForNewList = useMemo(
    () =>
      filteredContacts.filter((cc) =>
        contactMatchesStatuses(listStatuses, (cc.events || []) as { type: string }[])
      ),
    [filteredContacts, listStatuses]
  );

  const toggleListStatus = (status: string) => {
    setListStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  const createListMutation = useMutation({
    mutationFn: async () => {
      if (!userId) {
        throw new Error("You must be logged in to create a list.");
      }
      const ids = contactsForNewList.map((cc) => cc.contact_id).filter(Boolean);
      if (ids.length === 0) {
        throw new Error("No contacts match the selected engagement filters.");
      }
      const baseName = campaign?.name ?? "Campaign";
      const name = listName.trim() || `${baseName} - segment`;
      const description =
        `Created from campaign contacts for "${campaign?.name ?? ""}" with statuses: ` +
        (listStatuses.length ? listStatuses.join(" + ") : "any engagement");
      return api.contactLists.create(userId, name, ids, description);
    },
    onSuccess: () => {
      toast.success("Contact list created from campaign contacts.");
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["contact-lists", userId] });
      }
      setCreateListOpen(false);
      setListName("");
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to create list.";
      toast.error(message);
    },
  });

  const jobs = jobsData?.jobs ?? [];

  const totalSequenceSteps = useMemo(() => {
    if (!campaign) return 0;
    if (campaign.email_sequence && campaign.email_sequence.length > 0) {
      const byDelay = new Set<number>();
      for (const step of campaign.email_sequence) {
        const delay = step.delay_days ?? 0;
        byDelay.add(delay);
      }
      return byDelay.size || 0;
    }
    if (campaign.template_ids && campaign.template_ids.length > 0) {
      // Fallback: templates without explicit sequence means a single-step campaign
      return 1;
    }
    return 0;
  }, [campaign]);

  const startCampaign = useStartCampaign();
  const pauseCampaign = usePauseCampaign();

  const sequenceStepsForAb = useMemo(() => {
    if (!campaign) return [];

    const rawSequence =
      (campaign.email_sequence && campaign.email_sequence.length > 0
        ? campaign.email_sequence
        : (campaign.template_ids || []).map((tid, index) => ({
            template_id: tid,
            delay_days: index === 0 ? 0 : index * 2,
          }))) || [];

    if (!rawSequence.length) return [];

    const byDelay = new Map<number, string[]>();
    for (const step of rawSequence) {
      const delay = step.delay_days ?? 0;
      if (!byDelay.has(delay)) byDelay.set(delay, []);
      byDelay.get(delay)!.push(step.template_id);
    }

    const delays = Array.from(byDelay.keys()).sort((a, b) => a - b);

    const templateNameMap = new Map<string, string>();
    for (const t of templates) {
      templateNameMap.set(t.id, t.name);
    }

    const statsMap = new Map<
      string,
      {
        sent: number;
        opened: number;
        clicked: number;
        replied: number;
        openRate: number;
        clickRate: number;
        replyRate: number;
        templateName: string;
      }
    >();

    for (const row of statsByTemplate?.byTemplate ?? []) {
      statsMap.set(row.templateId, {
        sent: row.sent,
        opened: row.opened,
        clicked: row.clicked,
        replied: row.replied,
        openRate: row.openRate,
        clickRate: row.clickRate,
        replyRate: row.replyRate,
        templateName: row.templateName,
      });
    }

    return delays.map((delay, index) => {
      const templateIds = byDelay.get(delay) ?? [];
      const variants = templateIds.map((tid, variantIndex) => {
        const statsRow = statsMap.get(tid);
        const templateName =
          statsRow?.templateName || templateNameMap.get(tid) || tid;

        return {
          templateId: tid,
          templateName,
          variantLabel: String.fromCharCode(65 + variantIndex),
          sent: statsRow?.sent ?? 0,
          opened: statsRow?.opened ?? 0,
          clicked: statsRow?.clicked ?? 0,
          replied: statsRow?.replied ?? 0,
          openRate: statsRow?.openRate ?? 0,
          clickRate: statsRow?.clickRate ?? 0,
          replyRate: statsRow?.replyRate ?? 0,
        };
      });

      const label = index === 0 ? "Initial email" : `Follow-up ${index}`;

      return {
        stepIndex: index,
        label,
        delayDays: delay,
        variants,
      };
    });
  }, [campaign, statsByTemplate, templates]);

  const estimatedEndDate = useMemo(() => {
    if (!campaign || campaign.status === "completed") return null;
    const pending = contacts.filter((cc) => cc.status === "pending").length;
    if (pending <= 0) return null;

    const dailyCap = campaign.daily_limit;
    if (!dailyCap || dailyCap <= 0) return null;

    const workingDaysPerWeek = campaign.schedule_weekdays?.length ?? 5;
    if (workingDaysPerWeek <= 0) return null;

    // Working days needed to send the initial email to all remaining pending contacts
    const workingDaysNeeded = Math.ceil(pending / dailyCap);

    // Convert working days to calendar days
    const calendarDaysForInitial = Math.ceil(workingDaysNeeded * (7 / workingDaysPerWeek));

    // Max follow-up delay in the sequence (last step's delay_days)
    const maxFollowUpDelay =
      campaign.email_sequence && campaign.email_sequence.length > 0
        ? Math.max(...campaign.email_sequence.map((s) => s.delay_days ?? 0))
        : 0;

    const totalCalendarDays = calendarDaysForInitial + maxFollowUpDelay;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + totalCalendarDays);
    return endDate;
  }, [campaign, contacts]);

  const estimatedEndLabel = useMemo(() => {
    if (!estimatedEndDate) return null;
    const today = new Date();
    const diffMs = estimatedEndDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const dateStr = estimatedEndDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (diffDays <= 1) return { primary: "Today", secondary: dateStr };
    if (diffDays <= 7) return { primary: `~${diffDays} days`, secondary: dateStr };
    return { primary: dateStr, secondary: `~${diffDays} days away` };
  }, [estimatedEndDate]);

  const estimatedSendsPerDay = useMemo(() => {
    if (!campaign) return null;
    const campaignCap = Number(campaign.daily_limit) > 0 ? Number(campaign.daily_limit) : 0;
    if (campaignCap <= 0) return null;

    const senderIds = campaign.sender_ids ?? [];
    const senderType = campaign.sender_type;

    const selectedInboxes =
      senderIds.length > 0
        ? inboxes.filter((inbox) => senderIds.includes(inbox.id))
        : inboxes.filter((inbox) => inbox.sender_type === senderType);

    const eligibleInboxes =
      senderType === "smtp"
        ? selectedInboxes.filter((inbox) => inbox.status === "ready")
        : selectedInboxes;

    const dayMs = 24 * 60 * 60 * 1000;
    const effectiveInboxCap = eligibleInboxes.reduce((sum, inbox) => {
      const baseLimit = Math.min(50, Math.max(1, Number(inbox.daily_limit) || 50));
      if (!inbox.campaign_rampup) return sum + baseLimit;

      const startRaw = inbox.campaign_rampup_started_at || inbox.created_at;
      const start = startRaw ? new Date(startRaw) : null;
      if (!start || Number.isNaN(start.getTime())) return sum + baseLimit;

      const daysSinceStart = Math.max(0, Math.floor((Date.now() - start.getTime()) / dayMs));
      const fraction = daysSinceStart <= 6 ? 0.2 : daysSinceStart <= 13 ? 0.4 : daysSinceStart <= 20 ? 0.6 : 0.8;
      const ramped = Math.min(baseLimit, Math.max(1, Math.round(baseLimit * fraction)));
      return sum + ramped;
    }, 0);

    const estimated = Math.min(campaignCap, effectiveInboxCap || campaignCap);
    return {
      primary: estimated.toLocaleString(),
      secondary: `campaign ${campaignCap.toLocaleString()} • inbox effective ${effectiveInboxCap.toLocaleString()} (${eligibleInboxes.length}/${selectedInboxes.length} eligible)`,
    };
  }, [campaign, inboxes]);

  const handleTabChange = (value: string) => {
    const nextTab = value as typeof activeTab;
    setActiveTab(nextTab);

    const params = new URLSearchParams(searchParams.toString());

    if (nextTab === "analytics") {
      params.delete("tab");
    } else {
      params.set("tab", nextTab);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  if (!id) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Invalid campaign ID.</p>
        <Link href="/campaigns">
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to campaigns
          </Button>
        </Link>
      </div>
    );
  }

  if (campaignLoading || !campaign) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const sent = stats?.sent ?? 0;
  const openRate = stats?.openRate ?? 0;
  const clickRate = stats?.clickRate ?? 0;
  const replyRate = stats?.replyRate ?? 0;
  const spamRate = stats?.spamRate ?? 0;
  const health = stats?.health ?? 95;
  const opened = stats?.opened ?? 0;
  const clicked = stats?.clicked ?? 0;
  const replied = stats?.replied ?? 0;
  const complained = stats?.complained ?? 0;
  const totalContacts = contacts.length;
  const failedCount = contacts.filter((cc) => cc.status === "failed").length;
  const unsubscribedCount = contacts.filter((cc) => cc.status === "unsubscribed").length;
  const engagedContacts = contacts.filter((cc) =>
    ["opened", "clicked", "replied", "unsubscribed"].includes(cc.status)
  ).length;
  const engagementRate =
    totalContacts > 0 ? (engagedContacts / totalContacts) * 100 : 0;
  const delivered = Math.max(sent - failedCount, 0);
  const clickToOpenRate =
    openRate > 0 ? (clickRate / openRate) * 100 : 0;
  const pendingCount = contacts.filter((cc) => cc.status === "pending").length;
  const sentNoActivityCount = contacts.filter((cc) => cc.status === "sent").length;
  const unreachedShare =
    totalContacts > 0 ? ((pendingCount + failedCount) / totalContacts) * 100 : 0;
  const avgEmailsPerContact =
    totalContacts > 0 ? sent / totalContacts : 0;
  const completedSequenceContacts =
    totalSequenceSteps > 0
      ? contacts.filter(
          (cc) =>
            (cc.events?.filter((e) => e.type === "sent").length ?? 0) >=
            totalSequenceSteps
        ).length
      : 0;
  const sequenceCompletionRate =
    totalContacts > 0
      ? (completedSequenceContacts / totalContacts) * 100
      : 0;
  const openersWhoRepliedRate =
    openRate > 0 ? (replyRate / openRate) * 100 : 0;
  const clickersWhoRepliedRate =
    clickRate > 0 ? (replyRate / clickRate) * 100 : 0;

  const metricValueClass = "text-3xl font-semibold leading-tight flex items-center gap-2";
  const metricLabelClass = "text-sm text-muted-foreground";
  const metricCardContentClass =
    "p-5 flex items-center gap-5 md:gap-4 min-h-[120px]";

  const handleToggle = () => {
    if (campaign.status === "active") {
      pauseCampaign.mutate(id);
    } else if (campaign.status === "paused" || campaign.status === "draft") {
      startCampaign.mutate(id);
    }
  };

  const statusBadge =
    campaign.status === "active" ? (
      <Badge className="bg-green-600">Running</Badge>
    ) : campaign.status === "paused" ? (
      <Badge variant="secondary">Paused</Badge>
    ) : campaign.status === "completed" ? (
      <Badge variant="secondary">Stopped</Badge>
    ) : (
      <Badge variant="outline">Draft</Badge>
    );

  const handleExportXlsx = () => {
    if (!campaign) return;

    // Analytics summary
    const analyticsMetrics: { metric: string; value: number | string }[] = [
      { metric: "Total emails sent", value: sent },
      { metric: "Open rate (%)", value: openRate.toFixed(1) },
      { metric: "Click rate (%)", value: clickRate.toFixed(1) },
      { metric: "Reply rate (%)", value: replyRate.toFixed(1) },
      { metric: "Total contacts", value: totalContacts },
      { metric: "Unique opens", value: opened },
      { metric: "Unique clicks", value: clicked },
      { metric: "Unique replies", value: replied },
      { metric: "Engagement rate (%)", value: engagementRate.toFixed(1) },
      { metric: "Delivered emails", value: delivered },
      { metric: "Failed / bounced", value: failedCount },
      { metric: "Unsubscribed", value: unsubscribedCount },
      { metric: "Spam reports", value: complained },
      { metric: "Spam rate (%)", value: spamRate.toFixed(2) },
      { metric: "Click-to-open rate (%)", value: clickToOpenRate.toFixed(1) },
      { metric: "Pending (not yet sent)", value: pendingCount },
      { metric: "Sent · no engagement yet", value: sentNoActivityCount },
      { metric: "Unreached share (%)", value: unreachedShare.toFixed(1) },
      { metric: "Avg. emails per contact", value: avgEmailsPerContact.toFixed(1) },
      { metric: "Completed full sequence (%)", value: sequenceCompletionRate.toFixed(1) },
      { metric: "Openers who replied (%)", value: openersWhoRepliedRate.toFixed(1) },
      { metric: "Clickers who replied (%)", value: clickersWhoRepliedRate.toFixed(1) },
    ];

    const analyticsSheet: (string | number)[][] = [
      ["Metric", "Value"],
      ...analyticsMetrics.map((m) => [m.metric, m.value]),
    ];

    const abSheet: (string | number)[][] = [
      [
        "Step",
        "Variant",
        "Template name",
        "Sent",
        "Opened",
        "Clicked",
        "Replied",
        "Open rate (%)",
        "Click rate (%)",
        "Reply rate (%)",
      ],
    ];

    for (const step of sequenceStepsForAb) {
      for (const variant of step.variants) {
        abSheet.push([
          step.label,
          variant.variantLabel,
          variant.templateName,
          variant.sent,
          variant.opened,
          variant.clicked,
          variant.replied,
          Number(variant.openRate.toFixed(1)),
          Number(variant.clickRate.toFixed(1)),
          Number(variant.replyRate.toFixed(1)),
        ]);
      }
    }

    const contactsSheet: (string | number)[][] = [
      [
        "Email",
        "First name",
        "Last name",
        "Company",
        "Status",
        "Click count",
        "Last activity (ISO)",
        "Sequence step",
        "Sequence progress (%)",
      ],
    ];

    for (const cc of contacts) {
      const sequenceSentSteps = totalSequenceSteps
        ? Math.min(
            cc.events.filter((e) => e.type === "sent").length,
            totalSequenceSteps,
          )
        : 0;
      const sequenceProgressPercent =
        totalSequenceSteps > 0
          ? (sequenceSentSteps / totalSequenceSteps) * 100
          : 0;

      contactsSheet.push([
        cc.contact_details?.email ?? "",
        cc.contact_details?.first_name ?? "",
        cc.contact_details?.last_name ?? "",
        cc.contact_details?.company ?? "",
        cc.status,
        cc.click_count ?? 0,
        cc.last_activity
          ? new Date(cc.last_activity).toISOString()
          : "",
        totalSequenceSteps > 0
          ? `${sequenceSentSteps} of ${totalSequenceSteps}`
          : "",
        Number(sequenceProgressPercent.toFixed(1)),
      ]);
    }

    const workbook = XLSX.utils.book_new();

    // Analytics sheet
    const analyticsWs = XLSX.utils.aoa_to_sheet(analyticsSheet);
    ["A1", "B1"].forEach((addr) => {
      if (analyticsWs[addr]) {
        analyticsWs[addr].s = {
          font: { bold: true },
        };
      }
    });
    analyticsWs["!cols"] = [{ wch: 26 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(workbook, analyticsWs, "Analytics");

    // A/B analytics sheet
    const abWs = XLSX.utils.aoa_to_sheet(abSheet);
    ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1", "J1"].forEach(
      (addr) => {
        if (abWs[addr]) {
          abWs[addr].s = {
            font: { bold: true },
          };
        }
      },
    );
    abWs["!cols"] = [
      { wch: 18 }, // Step
      { wch: 8 }, // Variant
      { wch: 32 }, // Template name
      { wch: 8 }, // Sent
      { wch: 8 }, // Opened
      { wch: 8 }, // Clicked
      { wch: 8 }, // Replied
      { wch: 14 }, // Open rate
      { wch: 14 }, // Click rate
      { wch: 14 }, // Reply rate
    ];
    XLSX.utils.book_append_sheet(workbook, abWs, "A-B analytics");

    // Contacts sheet
    const contactsWs = XLSX.utils.aoa_to_sheet(contactsSheet);
    ["A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1", "I1"].forEach((addr) => {
      if (contactsWs[addr]) {
        contactsWs[addr].s = {
          font: { bold: true },
        };
      }
    });
    contactsWs["!cols"] = [
      { wch: 30 }, // Email
      { wch: 16 }, // First name
      { wch: 16 }, // Last name
      { wch: 22 }, // Company
      { wch: 12 }, // Status
      { wch: 10 }, // Click count
      { wch: 24 }, // Last activity
      { wch: 16 }, // Sequence step
      { wch: 18 }, // Sequence progress
    ];
    XLSX.utils.book_append_sheet(workbook, contactsWs, "Contacts");

    const wbout = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
      cellStyles: true,
    });

    const blob = new Blob([wbout], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${campaign.name || "campaign"}-analytics-export.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/campaigns">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{campaign.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {statusBadge}
              {campaign.archived && <Badge variant="secondary">Archived</Badge>}
              {estimatedEndLabel && (campaign.status === "active" || campaign.status === "paused") && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5 text-orange-500" />
                  Est. completion:
                  <span className="font-medium text-foreground">{estimatedEndLabel.primary}</span>
                  {estimatedEndLabel.secondary && (
                    <span className="text-xs text-muted-foreground/70">({estimatedEndLabel.secondary})</span>
                  )}
                </span>
              )}
              {estimatedSendsPerDay && (campaign.status === "active" || campaign.status === "paused") && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Mail className="w-3.5 h-3.5 text-primary" />
                  Est. sends/day:
                  <span className="font-medium text-foreground">{estimatedSendsPerDay.primary}</span>
                  <span className="text-xs text-muted-foreground/70">({estimatedSendsPerDay.secondary})</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {(campaign.status === "paused" || campaign.status === "draft") && (
            <Button
              onClick={handleToggle}
              disabled={startCampaign.isPending}
              className="gradient-primary"
            >
              {startCampaign.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Start campaign
                </>
              )}
            </Button>
          )}
          {campaign.status === "active" && (
            <Button
              variant="outline"
              onClick={handleToggle}
              disabled={pauseCampaign.isPending}
            >
              {pauseCampaign.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Pausing…
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 mr-2" />
                  Pause campaign
                </>
              )}
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href={`/campaigns/${id}/edit`}>
              <Settings className="w-4 h-4 mr-2" />
              Edit
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={handleExportXlsx}
            disabled={statsLoading || contactsLoading || statsByTemplateLoading || templatesLoading}
          >
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Analytics, placement tests, batch jobs, and contacts in one place.
            </p>
          </div>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="ab">A/B analytics</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="leads">Leads</TabsTrigger>
            <TabsTrigger value="placement">Placement</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="analytics">
          <div className="space-y-4">
            {/* Primary metrics */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Mail className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">
                      {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : sent.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">Emails sent</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                    <MousePointerClick className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">
                      {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : `${openRate.toFixed(1)}%`}
                    </p>
                    <p className="text-xs text-muted-foreground">Open rate</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ExternalLink className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">
                      {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : `${clickRate.toFixed(1)}%`}
                    </p>
                    <p className="text-xs text-muted-foreground">Click rate</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold">
                      {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : `${replyRate.toFixed(1)}%`}
                    </p>
                    <p className="text-xs text-muted-foreground">Reply rate</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Delivery + Engagement grouped cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Delivery</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-2 gap-y-4">
                    <div>
                      <p className="text-xl font-semibold">
                        {contactsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : totalContacts.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Total contacts</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold">
                        {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : delivered.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Delivered</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold text-amber-500">
                        {contactsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : pendingCount.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Pending</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold text-red-500">
                        {contactsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : failedCount.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Failed / bounced</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold text-muted-foreground">
                        {contactsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : unsubscribedCount.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Unsubscribed</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold text-red-500">
                        {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : `${spamRate.toFixed(2)}%`}
                      </p>
                      <p className="text-xs text-muted-foreground">Spam rate</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2 pt-4 px-5">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Engagement</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-4">
                  <div className="grid grid-cols-2 gap-y-4">
                    <div>
                      <p className="text-xl font-semibold">
                        {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : opened.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Unique opens</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold">
                        {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : clicked.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Unique clicks</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold">
                        {statsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : replied.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Unique replies</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold">
                        {contactsLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : `${engagementRate.toFixed(1)}%`}
                      </p>
                      <p className="text-xs text-muted-foreground">Engagement rate</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold">
                        {statsLoading || !Number.isFinite(clickToOpenRate) ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : `${clickToOpenRate.toFixed(1)}%`}
                      </p>
                      <p className="text-xs text-muted-foreground">Click-to-open rate</p>
                    </div>
                    <div>
                      <p className="text-xl font-semibold">
                        {statsLoading || !Number.isFinite(openersWhoRepliedRate) ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : `${openersWhoRepliedRate.toFixed(1)}%`}
                      </p>
                      <p className="text-xs text-muted-foreground">Openers who replied</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ab">
          <CampaignAbAnalyticsTab campaignId={id} />
        </TabsContent>

        <TabsContent value="contacts">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-lg font-medium flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Contacts {contactsLoading ? "" : `(${filteredContacts.length})`}
                </CardTitle>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="inline-flex items-center gap-2 mt-2 sm:mt-0"
                  disabled={!userId || contactsForNewList.length === 0}
                  onClick={() => {
                    const baseName = campaign?.name ?? "Campaign";
                    const statusLabel =
                      statusFilter !== "all"
                        ? statusFilter
                        : listStatuses.length
                          ? listStatuses.join(" + ")
                          : "segment";
                    setListName(`${baseName} - ${statusLabel}`);
                    if (!listStatuses.length && statusFilter !== "all") {
                      setListStatuses([statusFilter]);
                    }
                    setCreateListOpen(true);
                  }}
                >
                  <Users className="w-4 h-4" />
                  Create contact list
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search contacts by name or email..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {["all", "pending", "sent", "opened", "clicked", "replied", "failed"].map((status) => (
                    <Button
                      key={status}
                      variant={statusFilter === status ? "default" : "outline"}
                      onClick={() => setStatusFilter(status)}
                      size="sm"
                    >
                      {status === "all"
                        ? "All"
                        : status.charAt(0).toUpperCase() + status.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Sequence</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Clicks</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead className="text-right">Timeline</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contactsLoading ? (
                    [1, 2, 3, 4, 5].map((i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-5 w-40" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-6 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-12" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-8 w-24 ml-auto" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredContacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No contacts found matching your criteria.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredContacts.map((cc, index) => (
                      <TableRow
                        key={
                          cc.id ??
                          cc.contact_id ??
                          cc.contact_details?.email ??
                          `contact-row-${index}`
                        }
                      >
                        <TableCell>
                          <div>
                            <p className="font-medium">
                              {cc.contact_details?.first_name} {cc.contact_details?.last_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {cc.contact_details?.email}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{cc.contact_details?.company ?? "N/A"}</TableCell>
                        <TableCell>
                          {totalSequenceSteps > 0 ? (
                            <div className="space-y-1 min-w-[140px]">
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                <span>
                                  Step{" "}
                                  {
                                    getSequenceProgress(
                                      cc.events as any,
                                      totalSequenceSteps,
                                    ).stepsCompleted
                                  }
                                  {" of "}
                                  {totalSequenceSteps}
                                </span>
                              </div>
                              <Progress
                                value={
                                  getSequenceProgress(
                                    cc.events as any,
                                    totalSequenceSteps,
                                  ).progressPercent
                                }
                                className="w-full h-1.5"
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{getContactStatusBadge(cc.status)}</TableCell>
                        <TableCell className="text-center">
                          <span
                            className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums"
                            title="Link clicks in this campaign"
                          >
                            {cc.click_count ?? 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {cc.last_activity
                            ? new Date(cc.last_activity).toLocaleString()
                            : "No activity"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                View history
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md">
                              <DialogHeader>
                                <DialogTitle>Engagement history</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4 mt-4">
                                {cc.events && cc.events.length > 0 ? (
                                  cc.events
                                    .sort(
                                      (a, b) =>
                                        new Date(b.timestamp).getTime() -
                                        new Date(a.timestamp).getTime(),
                                    )
                                    .map((event, idx) => (
                                      <div
                                        key={`${event.type}-${event.timestamp ?? idx}`}
                                        className="flex gap-3 items-start border-l-2 border-muted pl-4 relative"
                                      >
                                        <div className="absolute -left-[9px] top-1 bg-background p-0.5 rounded-full border border-muted">
                                          {getContactEventIcon(event.type)}
                                        </div>
                                        <div className="flex-1">
                                          <p className="text-sm font-medium capitalize">
                                            {event.type}
                                          </p>
                                          {event.metadata?.sequence_step != null &&
                                            typeof event.metadata.sequence_step === "number" && (
                                              <p className="text-xs text-muted-foreground">
                                                {getSequenceStepLabel(event.metadata.sequence_step)}
                                              </p>
                                            )}
                                          <p className="text-xs text-muted-foreground">
                                            {new Date(event.timestamp).toLocaleString()}
                                          </p>
                                          {event.metadata?.url && (
                                            <p className="text-xs text-primary mt-1 truncate max-w-[250px]">
                                              {String(event.metadata.url)}
                                            </p>
                                          )}
                                          {event.metadata?.reply_body && (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="mt-2 h-7 px-2 text-xs"
                                              onClick={() =>
                                                setReplyPreview(
                                                  String(event.metadata?.reply_body),
                                                )
                                              }
                                            >
                                              View reply
                                            </Button>
                                          )}
                                        </div>
                                      </div>
                                    ))
                                ) : (
                                  <p className="text-center py-4 text-muted-foreground">
                                    No history available
                                  </p>
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              <p className="text-xs text-muted-foreground text-center mt-4">
                Contact tracking is real-time and separate for each campaign.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="placement">
          <CampaignPlacementTab campaignId={id} campaignName={campaign.name} />
        </TabsContent>

        <TabsContent value="leads">
          <CampaignLeadsTab campaignId={id} />
        </TabsContent>

        <TabsContent value="actions">
          <Card className="border border-border bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Batch jobs
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Send-batch jobs run periodically to send emails for this campaign. Jobs are
                created when you start the campaign and every hour while it is active.
              </p>
            </CardHeader>
            <CardContent>
              {jobsLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : jobs.length === 0 ? (
                <p className="text-muted-foreground text-sm py-6 text-center">
                  No batch jobs yet. Start the campaign to create the first job.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Scheduled (local)</TableHead>
                      <TableHead>Started (local)</TableHead>
                      <TableHead>Finished (local)</TableHead>
                      <TableHead className="min-w-[160px] whitespace-nowrap">
                        Error / notes
                      </TableHead>
                      <TableHead className="w-[80px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-mono text-sm">
                          {job.job_type || "send_campaign_batch"}
                        </TableCell>
                        <TableCell>{getJobStatusBadge(job.status)}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatJobDateLocal(job.scheduled_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatJobDateLocal(job.started_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatJobDateLocal(job.finished_at)}
                        </TableCell>
                        <TableCell
                          className="text-sm text-muted-foreground min-w-[160px] max-w-[320px] break-words align-top"
                          title={job.error_message}
                        >
                          {job.error_message || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {(job.status === "pending" || job.status === "running") && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              onClick={() => stopJobMutation.mutate(job.id)}
                              disabled={stopJobMutation.isPending}
                            >
                              <Square className="w-3.5 h-3.5" />
                              Stop
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!replyPreview}
        onOpenChange={(open) => {
          if (!open) {
            setReplyPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Reply preview</DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            {replyPreview && <EmailHtmlViewer html={replyPreview} />}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createListOpen}
        onOpenChange={(open) => {
          setCreateListOpen(open);
          if (!open) {
            setListStatuses(["opened"]);
            setListName("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create contact list from campaign</DialogTitle>
            <DialogDescription>
              Build a reusable contact list based on engagement in this campaign, such as{" "}
              <span className="font-semibold">sent + opened</span> or{" "}
              <span className="font-semibold">opened + clicked</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="list-name">List name</Label>
              <Input
                id="list-name"
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder="e.g. Q1 Outreach - Opened + Clicked"
              />
            </div>
            <div className="space-y-2">
              <Label>Include contacts who have ALL of:</Label>
              <div className="grid grid-cols-2 gap-2">
                {["sent", "opened", "clicked", "replied"].map((status) => (
                  <label key={status} className="flex items-center gap-2 text-sm capitalize">
                    <Checkbox
                      checked={listStatuses.includes(status)}
                      onCheckedChange={() => toggleListStatus(status)}
                    />
                    {status}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                A contact must have every selected engagement event in this campaign to be added to
                the list.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              Matching contacts:{" "}
              <span className="font-semibold">{contactsForNewList.length}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreateListOpen(false);
                setListStatuses(["opened"]);
                setListName("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="gradient-primary"
              disabled={
                createListMutation.isPending ||
                !userId ||
                contactsForNewList.length === 0 ||
                !listStatuses.length
              }
              onClick={() => createListMutation.mutate()}
            >
              {createListMutation.isPending ? "Creating..." : "Create list"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
