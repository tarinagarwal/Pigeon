"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  Mail,
  MessageSquare,
  Clock,
  RefreshCw,
  ChevronRight,
  Inbox,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRYN, rynFetch } from "@/contexts/RYNContext";
import RYNShell from "../RYNShell";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────
interface ActivityItem {
  id: string;
  inbox_email: string;
  receiver_email: string;
  engagement_mode: string;
  subject: string;
  sent_at: string;
  replied_at: string | null;
}

interface ActivityStats {
  sent: number;
  replied: number;
}

interface ActivityData {
  items: ActivityItem[];
  total: number;
  stats: ActivityStats;
}

// ─── Time filter options ────────────────────────────────────────────────────
const TIME_FILTERS = [
  { label: "24 hours", value: 24 },
  { label: "48 hours", value: 48 },
  { label: "7 days", value: 168 },
  { label: "30 days", value: 720 },
] as const;

// ─── Stat card ──────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  rate,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent: string;
  rate?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", accent)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {rate && <p className="text-xs font-medium text-primary mt-0.5">{rate}</p>}
      </div>
    </div>
  );
}

// ─── Row status badges ───────────────────────────────────────────────────────
function StatusBadges({ item }: { item: ActivityItem }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary dark:bg-primary/40 dark:text-primary font-medium">
        <Mail className="w-2.5 h-2.5" />
        Sent
      </span>
      {item.replied_at && (
        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 font-medium">
          <MessageSquare className="w-2.5 h-2.5" />
          Replied
        </span>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function modeLabel(mode: string) {
  const map: Record<string, string> = {
    pool: "Pool",
    network: "Network",
    shared_pool: "Shared Pool",
    quick: "Quick",
  };
  return map[mode] ?? mode;
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function RYNActivityPage() {
  const { user, isLoading } = useRYN();
  const [sinceHours, setSinceHours] = useState<24 | 48 | 168 | 720>(24);
  const [data, setData] = useState<ActivityData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) setFetching(true);
      else setRefreshing(true);
      try {
        const d = await rynFetch(`/ryn/activity?since_hours=${sinceHours}&limit=100`);
        setData(d);
      } catch {
        toast.error("Failed to load activity");
      } finally {
        setFetching(false);
        setRefreshing(false);
      }
    },
    [user, sinceHours]
  );

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading || fetching) {
    return (
      <RYNShell>
        <div className="p-6 max-w-4xl mx-auto space-y-4">
          {/* Skeleton */}
          <div className="h-7 w-40 rounded-lg bg-muted animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        </div>
      </RYNShell>
    );
  }

  const { items = [], stats } = data ?? { items: [], stats: { sent: 0, replied: 0 } };
  const replyRate = stats.sent > 0 ? `${Math.round((stats.replied / stats.sent) * 100)}%` : "—";

  return (
    <RYNShell>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Warmup Activity</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Emails sent and replied for your listed accounts.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Time filter */}
        <div className="flex gap-1.5 flex-wrap">
          {TIME_FILTERS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setSinceHours(value)}
              className={cn(
                "text-xs px-3.5 py-1.5 rounded-full font-medium transition-colors border",
                sinceHours === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary hover:text-primary"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-2 gap-4">
          <StatCard
            label="Emails sent"
            value={stats.sent}
            icon={Mail}
            accent="bg-primary/10 text-primary dark:bg-primary dark:text-primary"
          />
          <StatCard
            label="Replied"
            value={stats.replied}
            icon={MessageSquare}
            accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
            rate={`${replyRate} reply rate`}
          />
        </div>

        {/* Activity feed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Recent activity
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({items.length} of {data?.total ?? 0})
              </span>
            </h2>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border bg-muted/30 p-12 flex flex-col items-center gap-3 text-center">
              {/* No listings vs no activity */}
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Inbox className="w-5 h-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No activity yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Activity appears here once your listed emails are used in warmup from the main Pigeon dashboard. Try a longer time range.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden divide-y">
              {items.map((item) => {
                const isOpen = expanded === item.id;
                const hasEngagement = item.replied_at;
                return (
                  <div key={item.id} className={cn("bg-card transition-colors", hasEngagement && "")}>
                    {/* Row */}
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                      onClick={() => setExpanded(isOpen ? null : item.id)}
                    >
                      {/* Icon */}
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        item.replied_at
                          ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-primary/10 text-primary dark:bg-primary/40 dark:text-primary"
                      )}>
                        {item.replied_at ? (
                          <MessageSquare className="w-3.5 h-3.5" />
                        ) : (
                          <Mail className="w-3.5 h-3.5" />
                        )}
                      </div>

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate max-w-[200px]">
                            {item.inbox_email || item.receiver_email}
                          </span>
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {modeLabel(item.engagement_mode)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {item.subject || "(no subject)"}
                        </p>
                      </div>

                      {/* Right side */}
                      <div className="flex items-center gap-3 shrink-0">
                        <StatusBadges item={item} />
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {relativeTime(item.sent_at)}
                        </span>
                        <ChevronRight
                          className={cn(
                            "w-4 h-4 text-muted-foreground transition-transform duration-200",
                            isOpen && "rotate-90"
                          )}
                        />
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 bg-muted/20 border-t grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-xs">
                        <DetailRow label="From (inbox)" value={item.inbox_email || "—"} />
                        <DetailRow label="To (receiver)" value={item.receiver_email} />
                        <DetailRow label="Subject" value={item.subject || "(no subject)"} />
                        <DetailRow label="Mode" value={modeLabel(item.engagement_mode)} />
                        <DetailRow label="Sent at" value={formatDate(item.sent_at)} />
                        <DetailRow
                          label="Replied at"
                          value={item.replied_at ? formatDate(item.replied_at) : "—"}
                          highlight={!!item.replied_at}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info note */}
        <div className="flex items-start gap-2.5 rounded-xl border bg-primary/5 border-primary/20 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Activity is pulled from the main Pigeon warmup system. Your listed email accounts
            must be connected as inboxes in the main dashboard for warmup sends to appear here.
          </p>
        </div>
      </div>
    </RYNShell>
  );
}

function DetailRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={cn("font-medium truncate", highlight && "text-primary")}>{value}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
