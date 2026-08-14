"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Mail,
  Eye,
  MousePointerClick,
  MessageSquare,
  BarChart3,
  ArrowUpRight,
  Download,
  Calendar,
  Megaphone,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useAnalytics, useAnalyticsTimeline } from "@/hooks/useAnalytics";
import { useCampaigns } from "@/hooks/useCampaigns";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { HelpLinks } from "@/components/HelpLinks";
import { AppPageShell } from "@/components/AppPageShell";
import { RetryBlock } from "@/components/feedback/RetryBlock";

export default function AnalyticsPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const searchParams = useSearchParams();
  const router = useRouter();
  const [timeRange, setTimeRange] = useState("7d");
  const { data: campaigns = [] } = useCampaigns(userId, { archived: false });

  const selectedCampaignId = searchParams.get("campaign") || "";
  const campaignExists = selectedCampaignId
    ? campaigns.some((c: { id: string }) => c.id === selectedCampaignId)
    : true;
  const effectiveCampaignId = campaignExists && selectedCampaignId ? selectedCampaignId : undefined;

  const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
    refetch: refetchAnalytics,
  } = useAnalytics(userId, effectiveCampaignId, days);
  const {
    data: timelineData = [],
    isLoading: timelineLoading,
    isError: timelineError,
    refetch: refetchTimeline,
  } = useAnalyticsTimeline(userId, days, effectiveCampaignId);

  const selectedCampaign = effectiveCampaignId ? campaigns.find((c: { id: string }) => c.id === effectiveCampaignId) : null;

  const handleCampaignChange = (value: string) => {
    if (value && value !== "all") {
      router.replace(`/analytics?campaign=${encodeURIComponent(value)}`);
    } else {
      router.replace("/analytics");
    }
  };

  const handleExport = () => {
    const escapeCsv = (v: string | number) => {
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const campaignLabel = selectedCampaign ? selectedCampaign.name : "All campaigns";
    const periodLabel = `Last ${days} days`;
    const rows: string[] = [
      "Analytics Export",
      `Campaign,${escapeCsv(campaignLabel)}`,
      `Period,${escapeCsv(periodLabel)}`,
      "",
      "Summary",
      "Metric,Value",
      `Total Emails Sent,${analytics?.total_sent ?? 0}`,
      `Open Rate (%),${analytics?.open_rate != null ? analytics.open_rate.toFixed(1) : "0"}`,
      `Click Rate (%),${analytics?.click_rate != null ? analytics.click_rate.toFixed(1) : "0"}`,
      `Reply Rate (%),${analytics?.reply_rate != null ? analytics.reply_rate.toFixed(1) : "0"}`,
      `Deliverability Score,${(analytics?.deliverability_rate ?? 0).toFixed(1)}%`,
      "",
      "Performance by day",
      "Date,Sent,Opened,Clicked,Replied",
      ...overviewData.map((d) => [d.date, d.sent, d.opened, d.clicked, d.replied].map(escapeCsv).join(",")),
    ];
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${campaignLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Analytics exported");
  };

  // Transform timeline data for chart
  const overviewData = useMemo(() => {
    if (!timelineData || timelineData.length === 0) {
      return Array.from({ length: days }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (days - i - 1));
        return {
          date: format(date, "EEE"),
          sent: 0,
          opened: 0,
          clicked: 0,
          replied: 0,
        };
      });
    }

    return timelineData.map((item: { _id?: string; sent?: number; opened?: number; clicked?: number; replied?: number }) => {
      const date = item._id ? parseISO(item._id) : new Date();
      return {
        date: format(date, "EEE"),
        sent: item.sent || 0,
        opened: item.opened || 0,
        clicked: item.clicked || 0,
        replied: item.replied || 0,
      };
    });
  }, [timelineData, days]);

  // Deliverability from real analytics
  const deliverabilityData = useMemo(() => {
    const total = analytics?.total_sent ?? 0;
    const delivered = analytics?.total_delivered ?? 0;
    const bounced = analytics?.total_failed ?? 0;

    if (total === 0) {
      return [
        { name: "Delivered", value: 0, color: "hsl(142, 76%, 36%)" },
        { name: "Bounced", value: 0, color: "hsl(0, 84%, 60%)" },
      ];
    }

    return [
      { name: "Delivered", value: Math.round((delivered / total) * 100), color: "hsl(142, 76%, 36%)" },
      { name: "Bounced", value: Math.round((bounced / total) * 100), color: "hsl(0, 84%, 60%)" },
    ].filter((d) => d.value > 0);
  }, [analytics]);

  const campaignPerformanceWithStats = useMemo(() => {
    return campaigns.slice(0, 4).map((campaign: { name: string }) => ({
      name: campaign.name.length > 20 ? campaign.name.substring(0, 20) + "..." : campaign.name,
      opens: 0,
      replies: 0,
      sent: 0,
    }));
  }, [campaigns]);

  const deliverabilityScore = analytics?.deliverability_rate ?? 0;

  const stats = [
    {
      title: "Total Emails Sent",
      value: analytics?.total_sent?.toLocaleString() || "0",
      change: analytics?.sent_change,
      icon: Mail,
    },
    {
      title: "Average Open Rate",
      value: analytics?.open_rate != null ? `${analytics.open_rate.toFixed(1)}%` : "0%",
      change: analytics?.open_rate_change,
      icon: Eye,
    },
    {
      title: "Average Click Rate",
      value: analytics?.click_rate != null ? `${analytics.click_rate.toFixed(1)}%` : "0%",
      change: analytics?.click_rate_change,
      icon: MousePointerClick,
    },
    {
      title: "Average Reply Rate",
      value: analytics?.reply_rate != null ? `${analytics.reply_rate.toFixed(1)}%` : "0%",
      change: analytics?.reply_rate_change,
      icon: MessageSquare,
    },
    {
      title: "Deliverability Score",
      value: `${deliverabilityScore.toFixed(1)}%`,
      change: analytics?.deliverability_rate_change,
      icon: BarChart3,
    },
  ];

  return (
    <AppPageShell
      title="Analytics"
      description={
        selectedCampaign
          ? `Performance for ${selectedCampaign.name}. Comparing last ${days} days vs previous ${days} days.`
          : `Performance across campaigns and time. Comparing last ${days} days vs previous ${days} days.`
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedCampaignId || "all"} onValueChange={handleCampaignChange}>
            <SelectTrigger className="w-48 min-w-0">
              <Megaphone className="w-4 h-4 mr-2 shrink-0" />
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.map((campaign: { id: string; name: string }) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-40">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export report
          </Button>
        </div>
      }
    >
    <div className="space-y-6">

      {/* Stats */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4"
        data-tour="analytics-overview-cards"
      >
        {stats.map((stat, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
                      <stat.icon className="w-6 h-6 text-white" />
                    </div>
                    {!analyticsLoading && stat.change !== undefined && (
                      <Badge
                        variant="secondary"
                        className={stat.change >= 0 ? "text-success" : "text-destructive"}
                      >
                        {stat.change >= 0 ? (
                          <TrendingUp className="w-3 h-3 mr-1" />
                        ) : (
                          <TrendingDown className="w-3 h-3 mr-1" />
                        )}
                        {stat.change >= 0 ? "+" : ""}{stat.change.toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                  <div className="mt-4">
                    <p className="text-3xl font-bold flex items-center gap-2">
                      {analyticsLoading ? (
                        <Loader2 className="h-6 w-6 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        stat.value
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">{stat.title}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Email Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {timelineLoading ? (
              <div className="h-80 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                Loading performance data...
              </div>
            ) : timelineError ? (
              <div className="h-80 flex items-center justify-center">
                <RetryBlock
                  title="Failed to load performance data"
                  description="Please try again."
                  onRetry={() => void refetchTimeline()}
                  className="text-center"
                />
              </div>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={overviewData}>
                    <defs>
                      <linearGradient id="sentGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="openedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="clickedGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(173, 80%, 40%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(173, 80%, 40%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" />
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
                      dataKey="sent"
                      stroke="hsl(199, 89%, 48%)"
                      fill="url(#sentGradient)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="opened"
                      stroke="hsl(142, 76%, 36%)"
                      fill="url(#openedGradient)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="clicked"
                      stroke="hsl(173, 80%, 40%)"
                      fill="url(#clickedGradient)"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="replied"
                      stroke="hsl(292, 84%, 61%)"
                      strokeWidth={2}
                      dot={{ fill: "hsl(292, 84%, 61%)" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-4 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-primary" />
                <span className="text-sm text-muted-foreground">Sent</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-success" />
                <span className="text-sm text-muted-foreground">Opened</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "hsl(173, 80%, 40%)" }} />
                <span className="text-sm text-muted-foreground">Clicked</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-accent" />
                <span className="text-sm text-muted-foreground">Replied</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Deliverability Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Deliverability</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="h-64 flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                Loading deliverability data...
              </div>
            ) : analyticsError ? (
              <div className="h-64 flex items-center justify-center">
                <RetryBlock
                  title="Failed to load deliverability data"
                  description="Please try again."
                  onRetry={() => void refetchAnalytics()}
                  className="text-center"
                />
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={deliverabilityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      dataKey="value"
                      paddingAngle={2}
                    >
                      {deliverabilityData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="space-y-2">
              {deliverabilityData.map((item, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                    <span>{item.name}</span>
                  </div>
                  <span className="font-medium">{item.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaign Performance */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Campaign Performance</CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/campaigns">
              View All
              <ArrowUpRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-muted-foreground">
              No campaigns yet
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={campaignPerformanceWithStats} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" />
                  <YAxis dataKey="name" type="category" width={120} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="opens" fill="hsl(199, 89%, 48%)" radius={[0, 4, 4, 0]} name="Open Rate %" />
                  <Bar dataKey="replies" fill="hsl(292, 84%, 61%)" radius={[0, 4, 4, 0]} name="Reply Rate %" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

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
