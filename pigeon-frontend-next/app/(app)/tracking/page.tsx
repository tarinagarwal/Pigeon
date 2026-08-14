"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Mail,
  Clock,
  BarChart3,
  Send,
  Calendar,
  Inbox,
  Target,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAnalyticsTimeline,
  useSendingHourly,
  useSendingByInbox,
  useSendingByCampaign,
  useSendingInsights,
} from "@/hooks/useAnalytics";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpLinks } from "@/components/HelpLinks";
import { AppPageShell } from "@/components/AppPageShell";

export default function TrackingPage() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const [timeRange, setTimeRange] = useState("7d");

  const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
  const { data: timelineData = [], isLoading: timelineLoading } =
    useAnalyticsTimeline(userId, days);
  const { data: hourlyData = [], isLoading: hourlyLoading } = useSendingHourly(
    userId,
    days
  );
  const { data: byInbox = [], isLoading: inboxLoading } = useSendingByInbox(
    userId,
    days
  );
  const { data: byCampaign = [], isLoading: campaignLoading } =
    useSendingByCampaign(userId, days);
  const { data: insights, isLoading: insightsLoading } = useSendingInsights(
    userId,
    days
  );

  const dailySentData = useMemo(() => {
    if (!timelineData || timelineData.length === 0) {
      return Array.from({ length: days }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (days - i - 1));
        return { date: format(date, "EEE"), sent: 0 };
      });
    }
    return timelineData.map((item: { _id?: string; sent?: number }) => {
      const date = item._id ? parseISO(item._id) : new Date();
      return {
        date: format(date, "EEE"),
        sent: item.sent || 0,
      };
    });
  }, [timelineData, days]);

  const hourlyChartData = useMemo(() => {
    return (hourlyData as { hour: number; count: number }[]).map((d) => ({
      hour: `${d.hour}:00`,
      count: d.count,
    }));
  }, [hourlyData]);

  const peakHourLabel =
    insights?.peak_hour_utc != null
      ? `${String(insights.peak_hour_utc).padStart(2, "0")}:00 UTC`
      : "—";

  return (
    <AppPageShell
      title="Sending Behavior"
      description="Insights into when and how you send emails over time."
      actions={
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
      }
    >
    <div className="space-y-6">
      {/* Insights cards */}
      <div
        className="grid grid-cols-1 md:grid-cols-4 gap-4"
        data-tour="tracking-insights-cards"
      >
        {insightsLoading ? (
          [1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-12 w-12 rounded-xl mb-4" />
                <Skeleton className="h-8 w-24 mb-2" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <Mail className="w-6 h-6 text-primary" />
                </div>
                <p className="text-3xl font-bold">
                  {insights?.total_sent?.toLocaleString() ?? "0"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Total emails sent
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <Clock className="w-6 h-6 text-primary" />
                </div>
                <p className="text-2xl font-bold">{peakHourLabel}</p>
                <p className="text-sm text-muted-foreground">Peak sending hour</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <Inbox className="w-6 h-6 text-primary" />
                </div>
                <p
                  className="text-lg font-bold truncate"
                  title={insights?.top_inbox_email ?? undefined}
                >
                  {insights?.top_inbox_email ?? "—"}
                </p>
                <p className="text-sm text-muted-foreground">Top sending inbox</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <Target className="w-6 h-6 text-primary" />
                </div>
                <p
                  className="text-lg font-bold truncate"
                  title={insights?.top_campaign_name ?? undefined}
                >
                  {insights?.top_campaign_name ?? "—"}
                </p>
                <p className="text-sm text-muted-foreground">Top campaign</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Sending over time (daily) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Sends per day
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timelineLoading ? (
            <div className="h-72 flex items-center justify-center text-muted-foreground">
              Loading...
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailySentData}>
                  <defs>
                    <linearGradient id="sentOnlyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="hsl(199, 89%, 48%)"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="hsl(199, 89%, 48%)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                  />
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
                    fill="url(#sentOnlyGrad)"
                    strokeWidth={2}
                    name="Sent"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sending by hour of day */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Sends by hour of day (UTC)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hourlyLoading ? (
              <div className="h-80 flex items-center justify-center text-muted-foreground">
                Loading...
              </div>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyChartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      dataKey="hour"
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="hsl(199, 89%, 48%)"
                      radius={[4, 4, 0, 0]}
                      name="Emails"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sending by inbox */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Inbox className="w-5 h-5" />
              Sends by inbox
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/inboxes">
                View inboxes
                <ArrowUpRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {inboxLoading ? (
              <div className="h-80 flex items-center justify-center text-muted-foreground">
                Loading...
              </div>
            ) : byInbox.length === 0 ? (
              <div className="h-80 flex items-center justify-center text-muted-foreground">
                No sending data in this period
              </div>
            ) : (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byInbox.slice(0, 8).map((r) => ({
                      name: (r as { email: string }).email.length > 20
                        ? (r as { email: string }).email.slice(0, 20) + "..."
                        : (r as { email: string }).email,
                      count: (r as { count: number }).count,
                    }))}
                    layout="vertical"
                    margin={{ left: 0, right: 20 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                    />
                    <XAxis
                      type="number"
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={140}
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="hsl(142, 76%, 36%)"
                      radius={[0, 4, 4, 0]}
                      name="Sent"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sending by campaign */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Sends by campaign
          </CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/campaigns">
              View campaigns
              <ArrowUpRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {campaignLoading ? (
            <div className="h-80 flex items-center justify-center text-muted-foreground">
              Loading...
            </div>
          ) : byCampaign.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-muted-foreground">
              No sending data in this period
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={byCampaign.slice(0, 8).map((r) => ({
                    name: (r as { name: string }).name.length > 24
                      ? (r as { name: string }).name.slice(0, 24) + "..."
                      : (r as { name: string }).name,
                    count: (r as { count: number }).count,
                  }))}
                  layout="vertical"
                  margin={{ left: 0, right: 20 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={160}
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    fill="hsl(292, 84%, 61%)"
                    radius={[0, 4, 4, 0]}
                    name="Sent"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <HelpLinks
        slugs={[
          "use-sending-behavior-tracking-improve-deliverability",
          "understand-sending-by-inbox-and-campaign",
          "read-dashboard-analytics",
        ]}
        className="mt-6"
      />
    </div>
    </AppPageShell>
  );
}
