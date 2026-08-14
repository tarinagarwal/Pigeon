"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Flame,
  TrendingUp,
  Calendar,
  Mail,
  CheckCircle,
  Coins,
  RefreshCw,
  Play,
  Pause,
  Users,
  Zap,
  Loader2,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useInboxes, usePatchInboxStatus } from "@/hooks/useInboxes";
import { useDomains } from "@/hooks/useDomains";
import {
  useWarmupTimeline,
  useWarmupStats,
  useWarmupNetworkContacts,
  useQuickEngagementSend,
  useWarmupSharedPoolState,
} from "@/hooks/useWarmup";
import { useAnalyticsTimeline } from "@/hooks/useAnalytics";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthScoreTooltip } from "@/components/HealthScoreTooltip";
import { usePlanGate } from "@/hooks/usePlanGate";
import { PremiumBadge } from "@/components/PremiumBadge";
import { UpgradeModal } from "@/components/UpgradeModal";
import { HelpLinks } from "@/components/HelpLinks";
import { Listen } from "@/components/Listen";
import { BillingSubscriptionStrip } from "@/components/BillingSubscriptionStrip";
import {
  outboundSubscriptionBlockMessage,
  userSubscriptionBlocksOutbound,
} from "@/lib/outboundSubscriptionGate";

export default function WarmupPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const outboundBlocked = user ? userSubscriptionBlocksOutbound(user) : false;
  const canChangeWarmup =
    !user?._is_sub_user || user?._sub_user_permissions?.warmup !== false;
  const { data: inboxes = [], isLoading: inboxesLoading, refetch: refetchInboxes } = useInboxes(userId);
  const patchInboxStatus = usePatchInboxStatus();
  const { data: domains = [], isLoading: domainsLoading } = useDomains();
  const { data: warmupData = [], isLoading: warmupLoading, isError: warmupError } = useWarmupTimeline();
  const { data: warmupStats, isLoading: warmupStatsLoading } = useWarmupStats();
  const { data: analyticsTimeline = [], isLoading: timelineLoading } = useAnalyticsTimeline(userId, 7);
  const statsLoading = inboxesLoading || domainsLoading;
  const warmupGate = usePlanGate("warmup");
  const { data: networkData } = useWarmupNetworkContacts(!warmupGate.atLimit);
  const { data: sharedPoolData } = useWarmupSharedPoolState(!warmupGate.atLimit);
  const networkContactCount = networkData?.contacts?.length ?? 0;
  const sharedPoolCredits = sharedPoolData?.credits.balance ?? user?.credits_balance ?? 0;
  const sharedPoolAvailableContacts = sharedPoolData?.marketplace.available_contacts ?? 0;
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Mode selection dialog state
  const [modeDialogOpen, setModeDialogOpen] = useState(false);
  const [pendingInboxId, setPendingInboxId] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<"pool" | "network" | "hybrid">("network");
  const [useSharedPoolAddon, setUseSharedPoolAddon] = useState(false);

  // Quick Engagement dialog state
  const [quickEngageOpen, setQuickEngageOpen] = useState(false);
  const [quickInboxId, setQuickInboxId] = useState("");
  const [quickEmail, setQuickEmail] = useState("");
  const quickSend = useQuickEngagementSend();

  const calculateDaysActive = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  };

  const avgHealthScore =
    domains.length > 0
      ? Math.round(domains.reduce((sum, d) => sum + d.health_score, 0) / domains.length)
      : 0;

  const warmingInboxes = inboxes.filter((i) => i.status === "warming");
  const readyInboxes = inboxes.filter((i) => i.status === "ready");
  const totalDailyCapacity = inboxes.reduce((sum, i) => sum + i.daily_limit, 0);

  const healthTrendData =
    analyticsTimeline.length > 0
      ? analyticsTimeline.map((item, index) => {
          const baseHealth = avgHealthScore || 90;
          const variation = Math.sin(index * 0.5) * 2;
          return {
            date: item._id
              ? new Date(item._id).toLocaleDateString("en-US", { weekday: "short" })
              : `Day ${index + 1}`,
            health: Math.max(70, Math.min(100, Math.round(baseHealth + variation))),
          };
        })
      : [
          { date: "Mon", health: avgHealthScore || 92 },
          { date: "Tue", health: avgHealthScore || 93 },
          { date: "Wed", health: avgHealthScore || 91 },
          { date: "Thu", health: avgHealthScore || 94 },
          { date: "Fri", health: avgHealthScore || 95 },
          { date: "Sat", health: avgHealthScore || 94 },
          { date: "Sun", health: avgHealthScore || 96 },
        ];

  const inboxDisplayData = inboxes.map((inbox) => {
    const daysActive = calculateDaysActive(inbox.created_at);
    const domain = inbox.domain_id ? domains.find((d) => d.id === inbox.domain_id) : null;
    const health = domain?.health_score ?? 90;
    const at = inbox.email.lastIndexOf("@");
    const domainFromEmail = at >= 0 ? inbox.email.slice(at + 1).toLowerCase() : "";
    const domainName = domain?.domain ?? (domainFromEmail || "Other");
    return {
      id: inbox.id,
      email: inbox.email,
      domainName,
      progress: inbox.warmup_progress,
      status: inbox.status,
      dailyVolume: inbox.daily_limit,
      sentToday: inbox.sent_today,
      health,
      daysActive,
      engagementMode: inbox.warmup_engagement_mode ?? "pool",
    };
  });

  const domainGroups = Array.from(
    inboxDisplayData.reduce((map, row) => {
      const list = map.get(row.domainName) ?? [];
      list.push(row);
      map.set(row.domainName, list);
      return map;
    }, new Map<string, Array<(typeof inboxDisplayData)[number]>>())
  ).sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const warmupDomainSections = domainGroups.map(([domainName, rows], index) => ({
    domainName,
    rows,
    startIndex: domainGroups
      .slice(0, index)
      .reduce((sum, [, previousRows]) => sum + previousRows.length, 0),
  }));

  const getStatusBadge = (status: string, progress: number) => {
    // When actively warming, always show "Warming" so Play/Pause state is clear
    if (status === "warming") {
      return (
        <Badge className="bg-warning/10 text-warning border-warning/20 inline-flex items-center gap-1" variant="outline">
          <RefreshCw className="w-3 h-3 animate-spin" />
          Warming
        </Badge>
      );
    }
    if (status === "paused") {
      return <Badge variant="secondary">Paused</Badge>;
    }
    if (progress === 100 || status === "ready") {
      return (
        <Badge className="bg-success/10 text-success border-success/20" variant="outline">
          <CheckCircle className="w-3 h-3 mr-1" />
          Ready
        </Badge>
      );
    }
    return (
      <Badge className="bg-warning/10 text-warning border-warning/20" variant="outline">
        <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
        Warming
      </Badge>
    );
  };

  const getHealthColor = (health: number) => {
    if (health >= 90) return "text-success";
    if (health >= 70) return "text-warning";
    return "text-destructive";
  };

  return (
    <div className="space-y-6">
      <UpgradeModal featureKey="warmup" gate={warmupGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <Listen componentId="Warmup" side="bottom" align="start" />
            {warmupGate.atLimit && <PremiumBadge featureKey="warmup" />}
          </div>
          <p className="text-muted-foreground">
            {warmupGate.atLimit
              ? "Warmup is a premium feature. Upgrade your plan to automatically warm up new inboxes."
              : "Monitor and manage your inbox warmup progress"}
          </p>
          {!warmupGate.atLimit && (
            <p className="text-xs text-muted-foreground mt-1">
              We recommend <em>Real engagement</em> — send to your own Warmup Network contacts for genuine reputation building. Artificial pool warmup (used by most tools) can burn out your domain.
              {!warmupStatsLoading && warmupStats && (
                <span className="ml-0 sm:ml-2 block sm:inline mt-1 sm:mt-0">
                  Last 7 days: <strong>{warmupStats.sent_count_7d}</strong> sent,{" "}
                  <strong>{warmupStats.replied_count_7d}</strong> tracked replies.
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="default" className="h-10 w-full sm:w-auto">
            <Link href="/warmup/learn">
              <BookOpen className="w-4 h-4 mr-2" />
              Learn Warmup
            </Link>
          </Button>
          {!warmupGate.atLimit && (
            <Button
              variant="outline"
              size="default"
              className="h-10 w-full sm:w-auto"
              onClick={() => {
                setQuickInboxId(inboxDisplayData[0]?.id ?? "");
                setQuickEmail("");
                setQuickEngageOpen(true);
              }}
            >
              <Zap className="w-4 h-4 mr-2" />
              Quick Engagement
            </Button>
          )}
        </div>
      </div>

      <BillingSubscriptionStrip />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        {[
          {
            title: "Active Warmups",
            value: warmingInboxes.length.toString(),
            icon: RefreshCw,
            color: "warning",
          },
          {
            title: "Ready Inboxes",
            value: readyInboxes.length.toString(),
            icon: CheckCircle,
            color: "success",
          },
          {
            title: "Avg. Health Score",
            value: `${avgHealthScore}%`,
            icon: TrendingUp,
            color: "primary",
          },
          {
            title: "Total Daily Capacity",
            value: totalDailyCapacity.toString(),
            icon: Mail,
            color: "accent",
          },
        ].map((stat, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card>
              <CardContent className="p-3 flex items-center gap-3 sm:p-4 sm:gap-4">
                <div
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex flex-shrink-0 items-center justify-center ${
                    stat.color === "primary"
                      ? "gradient-primary"
                      : stat.color === "success"
                        ? "bg-success"
                        : stat.color === "warning"
                          ? "bg-warning"
                          : "gradient-accent"
                  }`}
                >
                  <stat.icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-xl font-bold truncate sm:text-2xl">
                    {statsLoading ? <Skeleton className="h-6 w-10 sm:h-8 sm:w-12" /> : stat.value}
                  </div>
                  <p className="text-xs text-muted-foreground truncate sm:text-sm">{stat.title}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-warning" />
              Warmup Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {warmupLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                Loading warmup data...
              </div>
            ) : warmupError ? (
              <div className="h-64 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-destructive mb-2">Failed to load warmup data</p>
                  <p className="text-sm text-muted-foreground">Please try again later</p>
                </div>
              </div>
            ) : warmupData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No warmup data available
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={warmupData}>
                    <defs>
                      <linearGradient id="warmupGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="target"
                      stroke="hsl(var(--muted-foreground))"
                      fill="none"
                      strokeDasharray="5 5"
                    />
                    <Area
                      type="monotone"
                      dataKey="volume"
                      stroke="hsl(38, 92%, 50%)"
                      fill="url(#warmupGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-success" />
              Health Score Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {timelineLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                Loading health trend...
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={healthTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[80, 100]} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="health"
                      stroke="hsl(142, 76%, 36%)"
                      strokeWidth={2}
                      dot={{ fill: "hsl(142, 76%, 36%)" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        {inboxesLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading inboxes...</div>
        ) : inboxDisplayData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No inboxes configured yet</div>
        ) : (
          <div className="space-y-10">
            {warmupDomainSections.map(({ domainName, rows, startIndex }) => (
                <section key={domainName} className="space-y-4">
                  <div className="flex items-baseline gap-2 border-b border-border pb-2">
                    <h2 className="text-sm font-semibold tracking-tight text-foreground">{domainName}</h2>
                    <span className="text-xs text-muted-foreground">
                      {rows.length} inbox{rows.length !== 1 ? "es" : ""}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {rows.map((inbox, rowIndex) => {
                      const index = startIndex + rowIndex;
                      return (
                        <motion.div
                          key={inbox.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.1 }}
                        >
                          <Card>
                            <CardContent className="p-6">
                              <div className="flex items-start justify-between mb-4">
                                <div>
                                  <h3 className="font-medium">{inbox.email}</h3>
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    {getStatusBadge(inbox.status, inbox.progress)}
                                    {inbox.status === "warming" && (
                                      <Badge variant="outline" className="text-xs">
                                        {inbox.engagementMode === "network" ? (
                                          <><Users className="w-3 h-3 mr-1" />Real</>
                                        ) : inbox.engagementMode === "network_plus_shared" ? (
                                          <><Coins className="w-3 h-3 mr-1" />Real + shared</>
                                        ) : inbox.engagementMode === "shared_pool" ? (
                                          <><Coins className="w-3 h-3 mr-1" />Shared contacts</>
                                        ) : inbox.engagementMode === "hybrid" ? (
                                          <><Users className="w-3 h-3 mr-1" />Hybrid</>
                                        ) : (
                                          "Artificial"
                                        )}
                                      </Badge>
                                    )}
                                    <span className="text-sm text-muted-foreground">
                                      <Calendar className="w-3 h-3 inline mr-1" />
                                      {inbox.daysActive} days active
                                    </span>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={
                                    !canChangeWarmup ||
                                    (patchInboxStatus.isPending &&
                                      patchInboxStatus.variables?.inboxId === inbox.id)
                                  }
                                  onClick={() => {
                                    if (!canChangeWarmup) {
                                      toast.error(
                                        "You don't have permission to change warmup for this workspace."
                                      );
                                      return;
                                    }
                                    if (inbox.status === "warming") {
                                      patchInboxStatus.mutate(
                                        { inboxId: inbox.id, status: "paused" },
                                        { onSuccess: () => refetchInboxes() }
                                      );
                                    } else {
                                      if (warmupGate.atLimit) {
                                        setUpgradeOpen(true);
                                        return;
                                      }
                                      if (outboundBlocked) {
                                        toast.error(
                                          outboundSubscriptionBlockMessage(user) ||
                                            "Fix your subscription in Settings → Billing before resuming warmup.",
                                          { duration: 8000 }
                                        );
                                        return;
                                      }
                                      setPendingInboxId(inbox.id);
                                      if (inbox.engagementMode === "pool") {
                                        setSelectedMode("pool");
                                        setUseSharedPoolAddon(false);
                                      } else if (inbox.engagementMode === "hybrid") {
                                        setSelectedMode("hybrid");
                                        setUseSharedPoolAddon(false);
                                      } else {
                                        setSelectedMode("network");
                                        setUseSharedPoolAddon(
                                          inbox.engagementMode === "network_plus_shared" ||
                                            inbox.engagementMode === "shared_pool"
                                        );
                                      }
                                      setModeDialogOpen(true);
                                    }
                                  }}
                                  aria-label={inbox.status === "warming" ? "Pause warmup" : "Resume warmup"}
                                >
                                  {patchInboxStatus.isPending &&
                                  patchInboxStatus.variables?.inboxId === inbox.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : inbox.status === "warming" ? (
                                    <Pause className="w-4 h-4" />
                                  ) : (
                                    <Play className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>

                              <div className="space-y-4">
                                <div>
                                  <div className="flex items-center justify-between text-sm mb-2">
                                    <span className="text-muted-foreground">Warmup Progress</span>
                                    <span className="font-medium">{inbox.progress}%</span>
                                  </div>
                                  <Progress value={inbox.progress} className="h-2" />
                                </div>

                                <div className="grid grid-cols-3 gap-4 pt-2">
                                  <div className="text-center">
                                    <p className="text-lg font-bold">{inbox.dailyVolume}</p>
                                    <p className="text-xs text-muted-foreground">Daily Limit</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-lg font-bold">{inbox.sentToday}</p>
                                    <p className="text-xs text-muted-foreground">Sent Today</p>
                                  </div>
                                  <div className="text-center">
                                    <p
                                      className={`text-lg font-bold inline-flex items-center justify-center gap-1 ${getHealthColor(inbox.health)}`}
                                    >
                                      {inbox.health}%
                                      <HealthScoreTooltip />
                                    </p>
                                    <p className="text-xs text-muted-foreground">Health</p>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                </section>
            ))}
          </div>
        )}
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center flex-shrink-0">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-medium mb-2">Warmup Best Practices</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Start with 5-10 emails per day and gradually increase</li>
                <li>• Maintain consistent sending patterns</li>
                <li>• Engage with replies to boost reputation</li>
                <li>• Monitor health scores and pause if they drop below 70%</li>
                <li>• Complete warmup takes 1 week for new inboxes</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <HelpLinks
        slugs={[
          "what-is-email-warmup-how-to-use-pigeon",
          "start-pause-resume-warmup-inboxes",
          "check-warmup-progress-when-inbox-ready",
          "understanding-inbox-status-ready-warming-warmup-required",
          "best-practices-inbox-warmup-before-sending-campaigns",
        ]}
        className="mt-6"
      />

      {/* Quick Engagement dialog */}
      <Dialog
        open={quickEngageOpen}
        onOpenChange={(open) => {
          setQuickEngageOpen(open);
          if (!open) { setQuickEmail(""); }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-warning" />
              Quick Engagement
            </DialogTitle>
            <DialogDescription>
              Send a random warmup email immediately to a specific address to get quick engagement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>From inbox</Label>
              <Select value={quickInboxId} onValueChange={setQuickInboxId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an inbox" />
                </SelectTrigger>
                <SelectContent>
                  {inboxDisplayData.map((inbox) => (
                    <SelectItem key={inbox.id} value={inbox.id}>
                      {inbox.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Recipient email</Label>
              <Input
                type="email"
                placeholder="recipient@example.com"
                value={quickEmail}
                onChange={(e) => setQuickEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickEngageOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!quickInboxId || !quickEmail || quickSend.isPending}
              onClick={() => {
                quickSend.mutate(
                  { inbox_id: quickInboxId, recipient_email: quickEmail },
                  { onSuccess: () => setQuickEngageOpen(false) }
                );
              }}
            >
              {quickSend.isPending ? "Sending…" : "Send now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mode selection dialog */}
      <Dialog
        open={modeDialogOpen}
        onOpenChange={(open) => {
          setModeDialogOpen(open);
          if (!open) {
            setPendingInboxId(null);
            setUseSharedPoolAddon(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Choose warmup engagement type</DialogTitle>
            <DialogDescription>
              Select how you want warmup emails to be sent for this inbox.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={selectedMode}
            onValueChange={(v) => {
              const nextMode = v as "pool" | "network" | "hybrid";
              setSelectedMode(nextMode);
              if (nextMode !== "network") {
                setUseSharedPoolAddon(false);
              }
            }}
            className="space-y-3 py-2"
          >
            <div className="flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 cursor-pointer hover:bg-primary/10" onClick={() => setSelectedMode("network")}>
              <RadioGroupItem value="network" id="mode-network" className="mt-1" />
              <div className="flex-1 min-w-0">
                <Label htmlFor="mode-network" className="font-medium cursor-pointer flex flex-wrap items-center gap-1.5">
                  Real engagement (Warmup Network)
                  <Badge variant="outline" className="text-xs text-primary border-primary/40 font-normal">Recommended</Badge>
                </Label>
                <p className="text-xs text-muted-foreground mt-1">Automated Real Network</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Sends to your own contacts — genuine email activity that builds real sender reputation.{" "}
                  {networkContactCount === 0 ? (
                    <span className="text-amber-600 font-medium">
                      You have no contacts yet.{" "}
                      <Link href="/warmup/network" className="underline" onClick={() => setModeDialogOpen(false)}>
                        Add contacts →
                      </Link>
                    </span>
                  ) : (
                    <span>{networkContactCount} contact{networkContactCount !== 1 ? "s" : ""} in your network.</span>
                  )}
                </p>
                <div
                  className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="mode-network-shared-addon"
                      checked={useSharedPoolAddon}
                      disabled={selectedMode !== "network"}
                      onCheckedChange={(checked) => {
                        setSelectedMode("network");
                        setUseSharedPoolAddon(Boolean(checked));
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <Label
                        htmlFor="mode-network-shared-addon"
                        className="font-medium cursor-pointer flex flex-wrap items-center gap-1.5"
                      >
                        Shared contact pool
                        <Badge
                          variant="outline"
                          className="text-xs text-primary border-primary/30 dark:text-primary font-normal"
                        >
                          Credits based
                        </Badge>
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        After your own Warmup Network, also send to real recipients from other users&apos; verified
                        networks. Each send uses 1 credit.
                      </p>
                      {useSharedPoolAddon ? (
                        sharedPoolCredits > 0 && sharedPoolAvailableContacts > 0 ? (
                          <p className="text-sm text-primary dark:text-primary mt-1.5">
                            Using your own network first, then supplementing with {sharedPoolAvailableContacts} shared contacts.
                          </p>
                        ) : (
                          <p className="text-sm text-amber-600 font-medium mt-1.5">
                            You have no credits.{" "}
                            <Link href="/warmup/network" className="underline" onClick={() => setModeDialogOpen(false)}>
                              Top up and manage the pool →
                            </Link>
                          </p>
                        )
                      ) : (
                        <p className="text-sm text-muted-foreground mt-1.5">
                          Leave unchecked to use only your personal network.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 cursor-pointer hover:bg-emerald-500/10" onClick={() => setSelectedMode("hybrid")}>
              <RadioGroupItem value="hybrid" id="mode-hybrid" className="mt-1 shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Label htmlFor="mode-hybrid" className="font-medium cursor-pointer flex flex-wrap items-center gap-1.5">
                  Hybrid
                  <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-500/30 dark:text-emerald-400 font-normal">60% Real</Badge>
                  <Badge variant="outline" className="text-xs text-muted-foreground border-border font-normal">40% Artificial</Badge>
                </Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Combines <span className="text-foreground/90">Real engagement (Warmup Network)</span> with shared
                  contact pool sends — weighted 60% real, 40% shared for stronger reputation building with broader
                  coverage.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 cursor-pointer hover:bg-destructive/10" onClick={() => setSelectedMode("pool")}>
              <RadioGroupItem value="pool" id="mode-pool" className="mt-0.5" />
              <div className="flex-1 min-w-0">
                <Label htmlFor="mode-pool" className="font-medium cursor-pointer flex items-center gap-1.5">
                  Artificial engagement
                  <Badge variant="outline" className="text-xs text-destructive border-destructive/30 font-normal">Not recommended</Badge>
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Sends to a platform receiver pool with reply-driven qualification.{" "}
                  <span className="text-destructive font-medium">
                    Same method used by most warmup tools — can burn out your domain.
                  </span>
                </p>
                <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-destructive/10 border border-destructive/15 px-2 py-1.5">
                  <span className="text-destructive mt-px text-xs">⚠</span>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground/80">The &ldquo;Unlimited Warmup&rdquo; trap:</span>{" "}
                    Tools like Instantly and Saleshandy use a closed loop of their own users&apos; inboxes. ESPs have flagged these patterns — you&apos;re sharing risk, not building reputation.
                  </p>
                </div>
              </div>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                patchInboxStatus.isPending ||
                ((selectedMode === "network" || selectedMode === "hybrid") && networkContactCount === 0) ||
                (selectedMode === "network" &&
                  useSharedPoolAddon &&
                  (sharedPoolCredits <= 0 || sharedPoolAvailableContacts <= 0))
              }
              onClick={() => {
                if (!pendingInboxId) return;
                const computedMode =
                  selectedMode === "network" && useSharedPoolAddon
                    ? "network_plus_shared"
                    : selectedMode;
                patchInboxStatus.mutate(
                  { inboxId: pendingInboxId, status: "warming", warmup_engagement_mode: computedMode },
                  {
                    onSuccess: () => {
                      refetchInboxes();
                      setModeDialogOpen(false);
                      setPendingInboxId(null);
                      setUseSharedPoolAddon(false);
                    },
                  }
                );
              }}
            >
              {patchInboxStatus.isPending ? "Starting…" : "Start warmup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
