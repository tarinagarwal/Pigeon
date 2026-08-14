"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Play,
  Pause,
  Loader2,
  MoreHorizontal,
  Copy,
  Trash2,
  Activity,
  Clock,
  Archive,
  ArchiveRestore,
  Pencil,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { useCampaignStats } from "@/hooks/useCampaigns";
import { HealthScoreTooltip } from "@/components/HealthScoreTooltip";
import { SentTooltipWithNumber, ClickRateTooltipWithNumber } from "@/components/SentTooltip";
import type { Campaign } from "@/types/api";
import { WEEKDAY_TOGGLE_OPTIONS } from "@/lib/campaign-editor/constants";

interface CampaignRowProps {
  campaign: Campaign;
  inboxEmail?: string;
  defaultHealth?: number;
  inboxLoading?: boolean;
  onToggle: (campaignId: string, currentStatus: string) => void;
  onDelete: (campaignId: string) => void;
  onDuplicate?: (campaign: Campaign) => void;
  onArchive?: (campaignId: string, archived: boolean) => void;
  archivePending?: boolean;
  pausePending?: boolean;
  startPending?: boolean;
  complianceStatus?: { ok: boolean; errors: string[] };
}

const TZ_LABELS: Record<string, string> = {
  "America/New_York": "Eastern Time (ET)",
  "America/Chicago": "Central Time (CT)",
  "America/Denver": "Mountain Time (MT)",
  "America/Los_Angeles": "Pacific Time (PT)",
  "Europe/London": "London (GMT)",
  "Asia/Kolkata": "India (IST)",
};

const localDateShort = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeZone: undefined,
});

function campaignTimeToLocal(
  timeStr: string | undefined,
  campaignTimezone: string
): { date: string; time: string } | null {
  if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr.trim())) return null;
  const now = new Date();
  const [hour, min] = timeStr.trim().split(":").map(Number);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: campaignTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parseInt(dateParts.find((p) => p.type === "year")!.value, 10);
  const m = parseInt(dateParts.find((p) => p.type === "month")!.value, 10) - 1;
  const day = parseInt(dateParts.find((p) => p.type === "day")!.value, 10);
  let d = new Date(Date.UTC(y, m, day, hour, min));
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: campaignTimezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const tzHour = parseInt(tzParts.find((p) => p.type === "hour")!.value, 10);
  const tzMin = parseInt(tzParts.find((p) => p.type === "minute")!.value, 10);
  const diffMs = ((hour - tzHour) * 60 + (min - tzMin)) * 60 * 1000;
  d = new Date(d.getTime() + diffMs);
  return {
    date: localDateShort.format(d),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
  };
}

/** Backend convention: 0=Monday … 6=Sunday. Default Mon–Fri when missing/empty. */
function normalizeScheduleWeekdays(campaign: Campaign): Set<number> {
  const raw = campaign.schedule_weekdays;
  const fallback = new Set([0, 1, 2, 3, 4]);
  if (!raw?.length) return fallback;
  const out = new Set<number>();
  for (const x of raw) {
    const n = typeof x === "number" ? x : parseInt(String(x), 10);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return out.size ? out : fallback;
}

/** Current weekday in `timeZone`, same encoding as schedule_weekdays (0=Mon … 6=Sun). */
function getWeekdayInTimezone(now: Date, timeZone: string): number {
  const short =
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).formatToParts(now).find((p) => p.type === "weekday")
      ?.value ?? "";
  const shortMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  if (short in shortMap) return shortMap[short];

  const long =
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).formatToParts(now).find((p) => p.type === "weekday")
      ?.value ?? "";
  const longMap: Record<string, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };
  if (long in longMap) return longMap[long];

  // Last resort: viewer's local weekday (wrong if TZ differs; should never run)
  return (now.getDay() + 6) % 7;
}

function formatActiveWeekdayLabels(allowed: Set<number>): string {
  return WEEKDAY_TOGGLE_OPTIONS.filter((o) => allowed.has(o.value))
    .map((o) => o.label)
    .join(", ");
}

function CampaignLiveTime({ campaign }: { campaign: Campaign }) {
  const [now, setNow] = useState(new Date());
  const timezone = campaign.timezone || "America/New_York";

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const label = TZ_LABELS[timezone] ?? timezone;
  const timeInTz = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeStyle: "medium",
    hour12: true,
  }).format(now);

  const localTime = new Intl.DateTimeFormat("en-US", {
    timeStyle: "medium",
    hour12: true,
  }).format(now);

  const allowedWeekdays = normalizeScheduleWeekdays(campaign);
  const weekdayInCampaignTz = getWeekdayInTimezone(now, timezone);
  const isActiveWeekday = allowedWeekdays.has(weekdayInCampaignTz);

  const isOutsideTimeWindow = () => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const currentTimeStr = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    const start = campaign.start_time || "09:00";
    const end = campaign.end_time || "17:00";
    if (start <= end) return currentTimeStr < start || currentTimeStr > end;
    return currentTimeStr < start && currentTimeStr > end;
  };

  const outsideHours = isOutsideTimeWindow();
  const isWaiting = !isActiveWeekday || outsideHours;
  const waitingForWeekday = !isActiveWeekday;
  const startLocal = campaignTimeToLocal(campaign.start_time, timezone);
  const endLocal = campaignTimeToLocal(campaign.end_time, timezone);
  const startStr = startLocal ? startLocal.time : (campaign.start_time ?? "—");
  const endStr = endLocal ? endLocal.time : (campaign.end_time ?? "—");

  return (
    <div className="mt-2 space-y-1.5 text-[10px] leading-tight text-muted-foreground border-t border-border/50 pt-1.5">
      <div className="space-y-0.5">
        <p>
          <span className="font-medium text-foreground/80">{label}:</span> {timeInTz}
        </p>
        <p>
          <span className="font-medium text-foreground/80">Your local time:</span> {localTime}
        </p>
      </div>
      {isWaiting && waitingForWeekday && (
        <p className="text-amber-600 font-medium flex items-center gap-1 italic">
          <Clock className="w-2.5 h-2.5" />
          Waiting — not a scheduled sending day in {label} (active: {formatActiveWeekdayLabels(allowedWeekdays)})
        </p>
      )}
      {isWaiting && !waitingForWeekday && (
        <p className="text-amber-600 font-medium flex items-center gap-1 italic">
          <Clock className="w-2.5 h-2.5" />
          Waiting for specified time ({startStr} – {endStr} local time)
        </p>
      )}
      {campaign.sender_ids && campaign.sender_ids.length > 1 && (
        <div className="pt-1 flex flex-col gap-0.5 border-t border-border/30">
          <p className="font-medium text-foreground/80 flex items-center gap-1">
            <Activity className="w-2.5 h-2.5 text-primary" />
            Inbox Rotation
          </p>
          <p className="text-[9px] text-muted-foreground/80">Distribute sends across multiple inboxes</p>
        </div>
      )}
    </div>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-green-600 hover:bg-green-600">Running</Badge>;
    case "paused":
      return <Badge variant="secondary">Paused</Badge>;
    case "completed":
      return (
        <Badge className="bg-success text-success-foreground border-success hover:bg-success hover:text-success-foreground">
          Completed
        </Badge>
      );
    case "draft":
      return <Badge variant="outline">Draft</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function getHealthColor(health: number) {
  if (health >= 90) return "text-green-600";
  if (health >= 70) return "text-amber-500";
  return "text-destructive";
}

function getComplianceShortSummary(errors: string[]): string {
  if (!errors.length) return "";
  const labels: string[] = [];
  for (const e of errors) {
    const lower = e.toLowerCase();
    if (lower.includes("links") && lower.includes("max")) labels.push("Too many links");
    else if (lower.includes("unsubscribe")) labels.push("Unsubscribe required");
    else if (lower.includes("spam-trigger") || lower.includes("spam words")) labels.push("Spam words");
    else labels.push("Compliance issue");
  }
  return [...new Set(labels)].join(" · ");
}

export function CampaignRow({
  campaign,
  inboxEmail,
  defaultHealth = 95,
  inboxLoading,
  onToggle,
  onDelete,
  onDuplicate,
  onArchive,
  archivePending,
  pausePending,
  startPending,
  complianceStatus,
}: CampaignRowProps) {
  const { data: stats, isLoading: statsLoading } = useCampaignStats(campaign.id);

  const sent = stats?.sent ?? 0;
  const openRate = stats?.openRate ?? 0;
  const clickRate = stats?.clickRate ?? 0;
  const replyRate = stats?.replyRate ?? 0;
  const health = stats?.health ?? defaultHealth;

  const createdAt = new Date(campaign.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const hasCompliance =
    complianceStatus && !complianceStatus.ok && complianceStatus.errors.length > 0;

  return (
    <TableRow className="group hover:bg-secondary/50">
      {/* Campaign name */}
      <TableCell>
        <div className="space-y-0">
          <Link
            href={`/campaigns/${campaign.id}`}
            className="block rounded-md px-0.5 py-0.5 -mx-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="flex items-start gap-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium group-hover:text-primary transition-colors">
                    {campaign.name}
                  </span>
                  {campaign.archived && (
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      Archived
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground group-hover:text-foreground mt-1 transition-colors">
                  {createdAt}
                </p>
                {campaign.status === "active" && <CampaignLiveTime campaign={campaign} />}
              </div>
              {/* Subtle hover cue */}
              <ChevronRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
            </div>
          </Link>
          {hasCompliance && (
            <div className="mt-2 pt-1.5 flex flex-col gap-0.5 border-t border-border/30 -mx-0.5 px-0.5">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="font-medium text-foreground/80 flex items-center gap-1 text-amber-600 text-[10px] text-left underline decoration-dotted underline-offset-2 hover:text-amber-700 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                    aria-label="View compliance issues"
                  >
                    <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                    {getComplianceShortSummary(complianceStatus!.errors)}
                  </button>
                </PopoverTrigger>
                <PopoverContent side="right" align="start" className="max-w-xs">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium">Compliance issues:</p>
                    <ul className="list-disc list-inside text-xs space-y-0.5">
                      {complianceStatus!.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      </TableCell>

      {/* Status */}
      <TableCell>{getStatusBadge(campaign.status)}</TableCell>

      {/* Inbox */}
      <TableCell className="text-sm max-w-[160px]">
        {inboxLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground inline-block align-middle" />
        ) : inboxEmail ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate block max-w-[150px] cursor-default">{inboxEmail}</span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs font-mono">{inboxEmail}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">N/A</span>
        )}
      </TableCell>

      {/* Sent */}
      <TableCell className="text-right">
        {statsLoading ? (
          <div className="h-4 w-10 animate-pulse rounded bg-muted ml-auto" />
        ) : (
          <SentTooltipWithNumber sent={sent} isLoading={statsLoading} />
        )}
      </TableCell>

      {/* Open rate */}
      <TableCell className="text-right">
        {statsLoading ? (
          <div className="h-4 w-10 animate-pulse rounded bg-muted ml-auto" />
        ) : campaign.open_tracking === false ? (
          <span className="ml-auto inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
            Tracking off
          </span>
        ) : (
          <span className="text-green-600">{openRate}%</span>
        )}
      </TableCell>

      {/* Click rate */}
      <TableCell className="text-right">
        {statsLoading ? (
          <div className="h-4 w-10 animate-pulse rounded bg-muted ml-auto" />
        ) : (
          <ClickRateTooltipWithNumber clickRate={clickRate} isLoading={statsLoading} />
        )}
      </TableCell>

      {/* Reply rate */}
      <TableCell className="text-right">
        {statsLoading ? (
          <div className="h-4 w-10 animate-pulse rounded bg-muted ml-auto" />
        ) : (
          <span className="text-primary">{replyRate}%</span>
        )}
      </TableCell>

      {/* Health */}
      <TableCell className="text-center">
        {statsLoading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="h-2 w-16 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-8 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2">
            <Progress value={health} className="w-16 h-2" />
            <span className={`text-sm font-medium ${getHealthColor(health)}`}>{health}%</span>
            <HealthScoreTooltip />
          </div>
        )}
      </TableCell>

      {/* Actions */}
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {campaign.status === "active" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onToggle(campaign.id, campaign.status)}
                  disabled={pausePending}
                >
                  {pausePending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Pause className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Pause campaign</TooltipContent>
            </Tooltip>
          ) : ["paused", "draft", "pending"].includes(campaign.status) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggle(campaign.id, campaign.status);
                  }}
                  disabled={startPending}
                >
                  {startPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Start campaign</TooltipContent>
            </Tooltip>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/campaigns/${campaign.id}`}>
                  <Activity className="w-4 h-4 mr-2" />
                  Dashboard
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/campaigns/${campaign.id}/edit`}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate?.(campaign)}>
                <Copy className="w-4 h-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              {onArchive && (
                <DropdownMenuItem
                  onClick={() => onArchive(campaign.id, !campaign.archived)}
                  disabled={archivePending}
                >
                  {campaign.archived ? (
                    <>
                      <ArchiveRestore className="w-4 h-4 mr-2" />
                      Unarchive
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4 mr-2" />
                      Archive
                    </>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete(campaign.id)}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}