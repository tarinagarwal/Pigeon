"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ScrollText,
  RefreshCw,
  ChevronDown,
  Check,
  Minus,
  Mail,
  Reply,
  Send,
  Info,
  Clock,
  Filter,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useWarmupSentLogs, type WarmupSentLogItem } from "@/hooks/useWarmup";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";

const PAGE_SIZE = 50;

function fmtDt(iso: string | undefined | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function fmtRelative(iso: string | undefined | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function mergeLogItems(
  existing: WarmupSentLogItem[],
  incoming: WarmupSentLogItem[]
) {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((item) => item.id));
  const additions = incoming.filter((item) => !seen.has(item.id));
  return additions.length ? [...existing, ...additions] : existing;
}

const MODE_CONFIG = {
  network: {
    label: "Network",
    description: "Sent to a real contact in your warmup network",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  shared_pool: {
    label: "Shared contacts",
    description: "Sent to a rented real recipient from other users' verified warmup networks (credits)",
    className:
      "border-primary/40 bg-primary/10 text-primary dark:text-primary",
  },
  quick: {
    label: "Quick Send",
    description: "A one-off warmup email you triggered manually",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  pool: {
    label: "Auto Pool",
    description: "Automatically sent to the shared warmup pool",
    className:
      "border-zinc-400/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  },
} as const;

type EngagementMode = keyof typeof MODE_CONFIG;

function EngagementBadge({ mode }: { mode: EngagementMode }) {
  const config = MODE_CONFIG[mode] ?? MODE_CONFIG.pool;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`${config.className} text-xs cursor-default`}
          >
            {config.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[200px]">
          {config.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function EngagementIcon({
  at,
  label,
}: {
  at: string | null | undefined;
  label: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="flex items-center justify-center w-full">
          {at ? (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <Check
                className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                strokeWidth={2.5}
              />
            </span>
          ) : (
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-muted/50">
              <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {at ? `${label} on ${fmtDt(at)}` : `Not ${label.toLowerCase()} yet`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  iconColor = "text-primary",
  bgColor = "bg-primary/10",
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  sub?: string;
  iconColor?: string;
  bgColor?: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border bg-card">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${bgColor}`}
      >
        <Icon className={`h-[18px] w-[18px] ${iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-tight tabular-nums">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && (
          <p className="text-[10px] text-muted-foreground/60 leading-tight">
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

export default function WarmupLogsPage() {
  const warmupGate = usePlanGate("warmup");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<"all" | "24" | "48">("24");
  const [offset, setOffset] = useState(0);
  const [allItems, setAllItems] = useState<WarmupSentLogItem[]>([]);

  const params = {
    limit: PAGE_SIZE,
    offset,
    ...(modeFilter !== "all" ? { engagement_mode: modeFilter } : {}),
    ...(timeRange !== "all" ? { since_hours: timeRange === "24" ? 24 : 48 } : {}),
  };

  const { data, isLoading, isFetching, refetch } = useWarmupSentLogs(
    params,
    !warmupGate.atLimit
  );

  const total = data?.total ?? 0;

  const handleRefresh = () => {
    setOffset(0);
    setAllItems([]);
    refetch();
  };

  const handleFilterChange = (val: string) => {
    setModeFilter(val);
    setOffset(0);
    setAllItems([]);
  };

  const handleTimeRangeChange = (val: string) => {
    if (val === "all" || val === "24" || val === "48") {
      setTimeRange(val);
      setOffset(0);
      setAllItems([]);
    }
  };

  const handleLoadMore = () => {
    if (data?.items?.length) {
      setAllItems((prev) => mergeLogItems(prev, data.items));
    }
    setOffset((o) => o + PAGE_SIZE);
  };

  const displayed =
    offset === 0
      ? data?.items ?? []
      : mergeLogItems(allItems, data?.items ?? []);

  const repliedCount = displayed.filter((i) => i.replied_at).length;
  const hasActiveFilters = modeFilter !== "all" || timeRange !== "all";

  if (warmupGate.atLimit) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/warmup">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Sent Emails</h1>
        </div>
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mx-auto">
              <ScrollText className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="font-medium">This feature requires a paid plan</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Upgrade to see every warmup email your inboxes have sent and track
              whether recipients replied.
            </p>
            <Button onClick={() => setUpgradeOpen(true)} className="mt-2">
              Upgrade Plan
            </Button>
          </CardContent>
        </Card>
        <UpgradeModal
          featureKey="warmup"
          gate={warmupGate}
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UpgradeModal
        featureKey="warmup"
        gate={warmupGate}
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/warmup">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Sent Emails</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Every warmup email sent from your inboxes — see what was sent and
              whether it got a response.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading || isFetching}
          className="shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Stats strip — shown when data is loaded */}
      {!isLoading && displayed.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
          <StatCard
            icon={Send}
            label="Emails sent"
            value={total.toLocaleString()}
            bgColor="bg-primary/10 dark:bg-primary/30"
            iconColor="text-primary dark:text-primary"
          />
          <StatCard
            icon={Reply}
            label="Replied"
            value={repliedCount}
            sub={
              displayed.length > 0
                ? `${Math.round((repliedCount / displayed.length) * 100)}% reply rate`
                : undefined
            }
            bgColor="bg-orange-50 dark:bg-orange-950/30"
            iconColor="text-orange-600 dark:text-orange-400"
          />
        </div>
      )}

      {/* Reply rate tip — shown once we have enough data */}
      {!isLoading && displayed.length >= 10 && (() => {
        const replyRate = Math.round((repliedCount / displayed.length) * 100);
        const isGood = replyRate >= 40;
        const isLow = replyRate < 20;
        return (
          <div
            className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${
              isGood
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300"
                : isLow
                ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800/40 dark:bg-red-950/20 dark:text-red-300"
                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300"
            }`}
          >
            <span className="text-base leading-none mt-0.5">
              {isGood ? "✓" : "💡"}
            </span>
            <p>
              {isGood ? (
                <>
                  <strong>Nice work!</strong> Your reply rate is{" "}
                  <strong>{replyRate}%</strong> — right in the healthy 40–50%
                  range. Keep it up to maintain strong inbox reputation.
                </>
              ) : (
                <>
                  <strong>Tip:</strong> Aim for a <strong>40–50% reply rate</strong> on
                  your warmup emails. Your current rate is{" "}
                  <strong>{replyRate}%</strong>
                  {isLow
                    ? " — this is low and may slow down your inbox warmup progress."
                    : " — you're getting close, keep warming up consistently."}
                </>
              )}
            </p>
          </div>
        );
      })()}

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          <span className="font-medium">Filters:</span>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={timeRange} onValueChange={handleTimeRangeChange}>
            <SelectTrigger className="w-[140px] h-8 text-sm bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Last 24 hours</SelectItem>
              <SelectItem value="48">Last 48 hours</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Send type:</span>
          <Select value={modeFilter} onValueChange={handleFilterChange}>
            <SelectTrigger className="w-[150px] h-8 text-sm bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="network">Network</SelectItem>
              <SelectItem value="shared_pool">Shared contacts</SelectItem>
              <SelectItem value="pool">Auto Pool</SelectItem>
              <SelectItem value="quick">Quick Send</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          <span>Hover any badge or icon for details</span>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">Sent emails</CardTitle>
            {total > 0 && (
              <span className="text-xs text-muted-foreground">
                Showing {displayed.length.toLocaleString()} of{" "}
                {total.toLocaleString()}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && displayed.length === 0 ? (
            <div className="space-y-1.5 p-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-md" />
              ))}
            </div>
          ) : displayed.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-center px-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <ScrollText className="h-7 w-7 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No emails found</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  {hasActiveFilters
                    ? "Try changing your filters above to see more results."
                    : "Once your warmup starts sending emails, they'll appear here."}
                </p>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setModeFilter("all");
                    setTimeRange("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-b-lg">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="whitespace-nowrap w-[120px]">
                      When sent
                    </TableHead>
                    <TableHead className="min-w-[160px]">
                      From (your inbox)
                    </TableHead>
                    <TableHead className="min-w-[160px]">To (recipient)</TableHead>
                    <TableHead className="min-w-[180px]">Email subject</TableHead>
                    <TableHead className="w-[130px]">
                      <span className="flex items-center gap-1">
                        Send type
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <Info className="h-3 w-3 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="text-xs max-w-[220px] space-y-1.5 p-3"
                            >
                              <p>
                                <span className="font-semibold">Network</span> —
                                real contacts in your warmup network
                              </p>
                              <p>
                                <span className="font-semibold">Shared contacts</span> — rented real recipients from
                                other users&apos; networks (credits)
                              </p>
                              <p>
                                <span className="font-semibold">Auto Pool</span>{" "}
                                — shared warmup pool (automatic)
                              </p>
                              <p>
                                <span className="font-semibold">Quick Send</span>{" "}
                                — manually triggered by you
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </span>
                    </TableHead>
                    <TableHead className="text-center w-[72px]">
                      <span className="flex flex-col items-center gap-0.5">
                        <Reply className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-normal">Replied</span>
                      </span>
                    </TableHead>
                    <TableHead className="w-[120px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayed.map((row) => {
                    const noEngagement = !row.replied_at;
                    return (
                    <TableRow
                      key={row.id}
                      className={noEngagement
                        ? "border-l-2 border-l-amber-400 bg-amber-50/60 dark:border-l-amber-500 dark:bg-amber-950/20"
                        : "border-l-2 border-l-transparent"
                      }
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="text-left cursor-default">
                              <span className="text-foreground">
                                {fmtRelative(row.sent_at)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              {fmtDt(row.sent_at)}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px]">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="text-left max-w-full">
                              <span className="truncate block">
                                {row.inbox_email}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {row.inbox_email}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px]">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="text-left max-w-full">
                              <span className="truncate block text-muted-foreground">
                                {row.receiver_email}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {row.receiver_email}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-sm max-w-[220px]">
                        <span
                          className="truncate block text-muted-foreground"
                          title={row.subject || undefined}
                        >
                          {row.subject || (
                            <span className="italic opacity-40">No subject</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <EngagementBadge mode={row.engagement_mode as EngagementMode} />
                      </TableCell>
                      <TableCell className="text-center">
                        <EngagementIcon at={row.replied_at} label="Replied" />
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        {noEngagement && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-400 whitespace-nowrap">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            No response
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {displayed.length < total && (
                <div className="flex flex-col items-center gap-1 border-t p-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={isFetching}
                  >
                    <ChevronDown className="h-4 w-4 mr-2" />
                    {isFetching
                      ? "Loading..."
                      : `Load more (${(total - displayed.length).toLocaleString()} remaining)`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
