"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Mail,
  Eye,
  MousePointerClick,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpRight,
  Flame,
  Activity,
  Users,
  Server,
  Send,
  Sparkles,
  Loader2,
  X,
  BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { useCampaigns, useStartCampaign, usePauseCampaign } from "@/hooks/useCampaigns";
import { useAnalytics, useUserActivity } from "@/hooks/useAnalytics";
import { useInboxes } from "@/hooks/useInboxes";
import { useDomains } from "@/hooks/useDomains";
import { useAlerts } from "@/hooks/useAlerts";
import { DashboardCampaignCard } from "@/components/DashboardCampaignCard";
import { parseDateFromServer } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlanGate } from "@/hooks/usePlanGate";
import { PremiumBadge } from "@/components/PremiumBadge";
import { UpgradeModal } from "@/components/UpgradeModal";
import { HelpLinks } from "@/components/HelpLinks";
import { AppPageShell } from "@/components/AppPageShell";
import { EmptyState } from "@/components/EmptyState";
import { useActivationProgress } from "@/hooks/useActivationProgress";
import { SetupProgressCard } from "@/components/activation/SetupProgressCard";
import { NextBestActionCard } from "@/components/activation/NextBestActionCard";
import { trackEvent } from "@/lib/analytics-events";

export default function DashboardPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const showOnboardingBanner = searchParams.get("onboarding") === "1";

  const dismissOnboardingBanner = () => {
    router.replace("/dashboard", { scroll: false });
  };

  const { data: campaigns = [], isLoading: campaignsLoading } = useCampaigns(userId, { archived: false });
  const { data: analytics, isLoading: analyticsLoading } = useAnalytics(userId, undefined, 7);
  const { data: todayAnalytics, isLoading: todayAnalyticsLoading } = useAnalytics(userId, undefined, 1);
  const { data: inboxes = [], isLoading: inboxesLoading } = useInboxes(userId);
  const { data: domains = [], isLoading: domainsLoading } = useDomains();
  const { data: alerts = [], isLoading: alertsLoading, isError: alertsError } = useAlerts(userId);
  const { data: activities = [], isLoading: activitiesLoading, isError: activitiesError } = useUserActivity(userId);
  const startCampaign = useStartCampaign();
  const pauseCampaign = usePauseCampaign();
  const campaignGate = usePlanGate("campaigns");
  const activation = useActivationProgress(userId);

  const isFreePlan =
    !user?.plan_id || user.plan_id === "free" || user?.plan?.id === "free";
  const noTrialEver =
    !user?.trial_used_at &&
    !user?.trial_ends_at &&
    user?.subscription_status !== "trial" &&
    user?.subscription_status !== "active";
  const canClaimFreeTrial = isFreePlan && noTrialEver;

  const statsLoading = analyticsLoading || todayAnalyticsLoading || domainsLoading;
  const stats = [
    {
      title: "Emails Sent Today",
      value: todayAnalyticsLoading ? "—" : (todayAnalytics?.total_sent?.toLocaleString() ?? "0"),
      change: todayAnalytics?.sent_change,
      icon: Mail,
      color: "primary",
    },
    {
      title: "Open Rate",
      value: analyticsLoading ? "—" : (analytics?.open_rate != null ? `${analytics.open_rate.toFixed(1)}%` : "0%"),
      change: analytics?.open_rate_change,
      icon: Eye,
      color: "success",
    },
    {
      title: "Click Rate",
      value: analyticsLoading ? "—" : (analytics?.click_rate != null ? `${analytics.click_rate.toFixed(1)}%` : "0%"),
      change: analytics?.click_rate_change,
      icon: MousePointerClick,
      color: "accent",
    },
    {
      title: "Reply Rate",
      value: analyticsLoading ? "—" : (analytics?.reply_rate != null ? `${analytics.reply_rate.toFixed(1)}%` : "0%"),
      change: analytics?.reply_rate_change,
      icon: MessageSquare,
      color: "accent",
    },
    {
      title: "Domain Health",
      value: domainsLoading
        ? "—"
        : domains.length > 0
          ? `${Math.round(domains.reduce((sum, d) => sum + d.health_score, 0) / domains.length)}%`
          : "0%",
      change: undefined,
      icon: TrendingUp,
      color: "success",
    },
  ];

  const warmupProgress = inboxes.slice(0, 3).map((inbox) => ({
    inbox: inbox.email,
    progress: inbox.warmup_progress ?? 0,
    status:
      inbox.status === "ready" ? "Ready" : inbox.status === "warming" ? "Warming" : "Healthy",
  }));

  const handleCampaignToggle = (campaignId: string, currentStatus: string) => {
    if (currentStatus === "active") {
      pauseCampaign.mutate(campaignId);
    } else {
      startCampaign.mutate(campaignId);
    }
  };

  const activeCampaigns = campaigns.filter(
    (c) => c.status === "active" || c.status === "paused"
  );

  return (
    <AppPageShell
      title="Dashboard"
      description="Your email performance at a glance. Comparing last 7 days vs previous 7 days."
      actions={
        <div className="flex items-center gap-2 w-full md:w-auto" data-tour="dashboard-create-campaign">
          {campaignGate.atLimit && <PremiumBadge featureKey="campaigns" />}
          <Button
            className="w-full md:w-auto gradient-primary"
            onClick={() => {
              trackEvent("dashboard_primary_cta_clicked", { action: "create_campaign" });
              if (campaignGate.atLimit) {
                setUpgradeOpen(true);
              } else {
                window.location.href = "/campaigns/new";
              }
            }}
            disabled={campaignGate.atLimit && !campaignGate.canCreate}
          >
            {campaignGate.atLimit ? "Upgrade to add more" : "Create campaign"}
            <ArrowUpRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      }
    >
    <div className="space-y-6">
      {showOnboardingBanner && (
        <Card className="overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/8 via-background to-background shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Welcome to Pigeon</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      You are one step from your first send. Open the setup guide when you are ready, or explore the dashboard first.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={dismissOnboardingBanner}
                    aria-label="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" className="gradient-primary">
                    <Link href="/get-started">Open setup guide</Link>
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={dismissOnboardingBanner}>
                    I will explore on my own
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {isFreePlan && (
        <Card className="rounded-xl border-amber-200/60 bg-gradient-to-br from-amber-50/50 to-orange-50/30 shadow-sm dark:border-amber-400/35 dark:bg-gradient-to-br dark:from-[#1a1204] dark:via-[#14110a] dark:to-[#1a0d06]">
          <div className="relative z-10 p-6">
            <div className="flex items-center justify-between gap-6">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="relative shrink-0">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 border border-amber-300/80 shadow-inner">
                    <Sparkles className="h-7 w-7 text-white drop-shadow-sm" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold bg-gradient-to-r from-amber-700 via-orange-600 to-amber-700 bg-clip-text text-transparent mb-1.5 leading-tight dark:bg-none dark:text-amber-200">
                    {canClaimFreeTrial
                      ? "Step up to claim your free premium trial"
                      : "Unlock your full potential"}
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed mb-3 dark:text-amber-50/90">
                    {canClaimFreeTrial
                      ? "You're on the free plan and haven't used a trial yet. Claim your free premium trial to unlock more campaigns, domains, and daily emails."
                      : "Get more campaigns, domains, and daily emails. Scale your outreach with a plan that fits your growth."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {(canClaimFreeTrial
                      ? ["Higher sending limits", "More campaigns & domains", "Priority support"]
                      : ["Unlimited campaigns", "Priority support", "Advanced analytics"]
                    ).map((feature) => (
                      <span
                        key={feature}
                        className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 border border-amber-200/80 dark:bg-amber-400/15 dark:text-amber-100 dark:border-amber-300/40"
                      >
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="shrink-0">
                <Button
                  asChild
                  size="lg"
                  className="shrink-0 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-600 hover:via-orange-600 hover:to-amber-600 text-white font-semibold shadow-md shadow-amber-300/40 transition-all rounded-xl border-2 border-amber-400/40 group/btn dark:shadow-amber-950/50 dark:border-amber-300/70 dark:ring-1 dark:ring-amber-200/15"
                >
                  <Link
                    href="/pricing"
                    className="inline-flex items-center justify-center gap-2 px-6 whitespace-nowrap"
                  >
                    {canClaimFreeTrial ? "Upgrade" : "View Pricing"}
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {!activation.isLoading && !activation.isComplete && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6" data-tour="dashboard-setup">
          <div className="xl:col-span-2">
            <NextBestActionCard nextStep={activation.nextStep} />
          </div>
          <SetupProgressCard
            percent={activation.percent}
            completedCount={activation.completedCount}
            totalSteps={activation.totalSteps}
            steps={activation.steps}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4" data-tour="dashboard-stats">
        {stats.map((stat, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    stat.color === "primary"
                      ? "gradient-primary"
                      : stat.color === "success"
                        ? "bg-green-600"
                        : "bg-primary"
                  }`}
                >
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
                {!statsLoading && stat.change !== undefined && (
                  <Badge
                    variant="secondary"
                    className={
                      stat.change >= 0 ? "text-green-600" : "text-destructive"
                    }
                  >
                    {stat.change >= 0 ? (
                      <TrendingUp className="w-3 h-3 mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 mr-1" />
                    )}
                    {stat.change >= 0 ? "+" : ""}
                    {stat.change.toFixed(1)}%
                  </Badge>
                )}
              </div>
              <div className="mt-4">
                <div className="text-3xl font-bold flex items-center gap-2">
                  {statsLoading ? (
                    <Loader2 className="h-6 w-6 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    stat.value
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{stat.title}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2" data-tour="dashboard-campaigns">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Active Campaigns</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/campaigns">View all</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {campaignsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="p-4 rounded-lg bg-secondary/50">
                      <Skeleton className="h-5 w-1/2 mb-2" />
                      <Skeleton className="h-4 w-1/3" />
                    </div>
                  ))}
                </div>
              ) : activeCampaigns.length === 0 ? (
                <EmptyState
                  icon={Send}
                  headline="No active campaigns yet"
                  description="Create your first campaign to start sending outreach and collecting performance data."
                  primaryAction={
                    <Button asChild className="gradient-primary" size="sm">
                      <Link href="/campaigns/new">Create campaign</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-4">
                  {activeCampaigns.slice(0, 3).map((campaign) => (
                    <DashboardCampaignCard
                      key={campaign.id}
                      campaign={campaign}
                      onToggle={handleCampaignToggle}
                      pausePending={pauseCampaign.isPending && pauseCampaign.variables === campaign.id}
                      startPending={startCampaign.isPending && startCampaign.variables === campaign.id}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card data-tour="dashboard-warmup">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-500" />
                Warmup Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {inboxesLoading ? (
                  [1, 2, 3].map((i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-2 w-full" />
                    </div>
                  ))
                ) : warmupProgress.length === 0 ? (
                  <EmptyState
                    icon={Mail}
                    headline="No inboxes connected yet"
                    description="Add an inbox to enable warmup and start sending campaigns safely."
                    primaryAction={
                      <Button asChild variant="outline" size="sm">
                        <Link href="/inboxes/new">Add inbox</Link>
                      </Button>
                    }
                    secondaryLink={
                      <Link href="/settings?tab=integrations" className="text-sm text-primary hover:underline">
                        Connect Gmail in Settings
                      </Link>
                    }
                    className="py-8"
                  />
                ) : (
                  warmupProgress.map((item, index) => (
                    <div key={index} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{item.inbox}</span>
                        <Badge
                          variant={item.status === "Warming" ? "secondary" : "default"}
                          className={
                            item.status === "Ready"
                              ? "bg-success text-success-foreground border-success hover:bg-success hover:text-success-foreground"
                              : item.status === "Healthy"
                                ? "bg-green-600 hover:bg-green-600"
                                : ""
                          }
                        >
                          {item.status}
                        </Badge>
                      </div>
                      <Progress value={item.progress} className="h-2" />
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card data-tour="dashboard-alerts">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Recent Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="p-3 rounded-lg bg-secondary/50">
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : alertsError ? (
                <div className="text-center py-4">
                  <p className="text-destructive text-sm mb-1">Failed to load alerts</p>
                  <p className="text-xs text-muted-foreground">Please try again later</p>
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No recent alerts
                </div>
              ) : (
                <div className="space-y-3">
                  {alerts.slice(0, 3).map((alert) => {
                    const alertDate = parseDateFromServer(alert.time);
                    const timeAgo = formatDistanceToNow(alertDate, { addSuffix: true });
                    return (
                      <div
                        key={alert.id}
                        className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50"
                      >
                        <AlertTriangle
                          className={`w-4 h-4 mt-0.5 ${
                            alert.type === "warning"
                              ? "text-amber-500"
                              : alert.type === "error"
                                ? "text-destructive"
                                : alert.type === "success"
                                  ? "text-green-600"
                                  : "text-primary"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{alert.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {alert.message}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {timeAgo}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button variant="ghost" className="w-full mt-4" asChild>
                <Link href="/alerts">View all alerts</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activitiesError ? (
                <div className="text-center py-4">
                  <p className="text-destructive text-sm mb-1">
                    Failed to load activity
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Please try again later
                  </p>
                </div>
              ) : activitiesLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="p-3 rounded-lg bg-secondary/50">
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : activities.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  No recent activity
                </div>
              ) : (
                <div className="space-y-3">
                  {activities.slice(0, 5).map((activity, index) => {
                    const timeAgo = formatDistanceToNow(
                      new Date(activity.timestamp),
                      { addSuffix: true }
                    );
                    const iconMap: Record<
                      string,
                      React.ComponentType<{ className?: string }>
                    > = {
                      mail: Mail,
                      users: Users,
                      server: Server,
                      send: Send,
                      default: Activity,
                    };
                    const IconComponent =
                      iconMap[activity.icon] ?? iconMap.default;
                    return (
                      <div
                        key={`${activity.id}-${index}`}
                        className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50"
                      >
                        <IconComponent className="w-4 h-4 mt-0.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{activity.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {activity.description}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {timeAgo}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button variant="ghost" className="w-full mt-4" asChild>
                <Link href="/activity">View all activity</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <UpgradeModal
        featureKey="campaigns"
        gate={campaignGate}
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
      />

      <HelpLinks
        slugs={[
          "read-dashboard-analytics",
          "use-sending-behavior-tracking-improve-deliverability",
          "understand-sending-by-inbox-and-campaign",
        ]}
        className="mt-6"
      />
    </div>
    </AppPageShell>
  );
}
