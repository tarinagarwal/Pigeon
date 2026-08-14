"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  TrendingUp,
  Mail,
  Eye,
  MousePointerClick,
  Reply,
  RefreshCw,
  Calendar,
  Users,
} from "lucide-react";

type AnalyticsData = {
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  start_date?: string;
  end_date?: string;
  daily_sent?: Array<{
    date: string;
    count: number;
  }>;
  top_campaigns?: Array<{ 
    campaign_id: string;
    campaign_name: string;
    total_sent: number;
    total_opened: number;
    total_clicked: number;
    total_replied: number;
    open_rate: number;
    click_rate: number;
    reply_rate: number;
  }>;
  by_tenant?: Array<{
    tenant_id: string;
    tenant_name?: string;
    total_sent: number;
    total_opened: number;
    total_clicked: number;
    total_replied: number;
    open_rate: number;
    click_rate: number;
    reply_rate: number;
  }>;
};

export default function AdminAnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const formatDate = (value: Date) => {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const fetchAnalytics = async (override?: { startDate?: string; endDate?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const start = override?.startDate ?? startDate;
      const end = override?.endDate ?? endDate;
      const params: Record<string, string> = {};
      if (start) params.start_date = start;
      if (end) params.end_date = end;

      const res = await adminApi.get<AnalyticsData>("/admin/analytics", { params });
      setAnalytics(res.data);
      if (!start && !end) {
        setStartDate(res.data.start_date || "");
        setEndDate(res.data.end_date || "");
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const now = new Date();
    const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const defaultEnd = formatDate(utcToday);
    const defaultStart = formatDate(new Date(utcToday.getTime() - 6 * 24 * 60 * 60 * 1000));
    setStartDate(defaultStart);
    setEndDate(defaultEnd);
    fetchAnalytics({ startDate: defaultStart, endDate: defaultEnd });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = [
    {
      title: "Total Sent",
      value: analytics?.total_sent?.toLocaleString() || "0",
      description: "Emails sent across all campaigns",
      icon: Mail,
      color: "blue",
    },
    {
      title: "Total Opened",
      value: analytics?.total_opened?.toLocaleString() || "0",
      description: "Emails opened by recipients",
      icon: Eye,
      color: "green",
    },
    {
      title: "Total Clicked",
      value: analytics?.total_clicked?.toLocaleString() || "0",
      description: "Links clicked in emails",
      icon: MousePointerClick,
      color: "purple",
    },
    {
      title: "Total Replied",
      value: analytics?.total_replied?.toLocaleString() || "0",
      description: "Email replies received",
      icon: Reply,
      color: "orange",
    },
    {
      title: "Open Rate",
      value: analytics ? `${analytics.open_rate.toFixed(2)}%` : "0%",
      description: "Percentage of opened emails",
      icon: TrendingUp,
      color: "indigo",
    },
    {
      title: "Click Rate",
      value: analytics ? `${analytics.click_rate.toFixed(2)}%` : "0%",
      description: "Percentage of clicked links",
      icon: MousePointerClick,
      color: "teal",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <BarChart3 className="mr-3 h-8 w-8 text-primary" />
            Analytics
          </h1>
          <p className="text-gray-600 mt-2">
            High-level engagement metrics across all tenants
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void fetchAnalytics()}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <input
              type="date"
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={endDate || undefined}
            />
            <span className="text-sm text-gray-500">to</span>
            <input
              type="date"
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
            />
            <Button
              onClick={() => fetchAnalytics()}
              disabled={loading || !startDate || !endDate}
            >
              Apply
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              const now = new Date();
              const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
              const defaultEnd = formatDate(utcToday);
              const defaultStart = formatDate(new Date(utcToday.getTime() - 6 * 24 * 60 * 60 * 1000));
              setStartDate(defaultStart);
              setEndDate(defaultEnd);
              fetchAnalytics({ startDate: defaultStart, endDate: defaultEnd });
            }}
            disabled={loading}
          >
            Last 7 days
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center text-red-800">
              <Reply className="h-5 w-5 mr-2" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stats.map((stat, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-5 w-5 text-${stat.color}-500`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold mb-1">{stat.value}</div>
              <p className="text-xs text-gray-500">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Sent Volume</CardTitle>
          <CardDescription>
            {analytics?.start_date && analytics?.end_date
              ? `UTC daily sent emails from ${analytics.start_date} to ${analytics.end_date}`
              : "UTC daily sent emails"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {analytics?.daily_sent && analytics.daily_sent.length > 0 ? (
              analytics.daily_sent.map((d) => (
                <div key={d.date} className="rounded-md border border-gray-200 p-3">
                  <div className="text-xs text-gray-500">{d.date}</div>
                  <div className="text-xl font-semibold text-gray-900">{d.count.toLocaleString()}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-500">No sent data for this range.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant Performance</CardTitle>
          <CardDescription>
            Engagement metrics broken down by tenant
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Tenant</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Sent</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Opened</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Clicked</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Replied</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Open Rate</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Click Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {analytics?.by_tenant && analytics.by_tenant.length > 0 ? (
                  analytics.by_tenant.map((tenant, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mr-3">
                            <Users className="h-4 w-4 text-primary" />
                          </div>
                          <div className="font-medium text-gray-900">
                            {tenant.tenant_name || tenant.tenant_id.substring(0, 8)}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {tenant.total_sent.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {tenant.total_opened.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {tenant.total_clicked.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {tenant.total_replied.toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline">
                          {tenant.open_rate.toFixed(2)}%
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline">
                          {tenant.click_rate.toFixed(2)}%
                        </Badge>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500">
                      <BarChart3 className="mx-auto h-12 w-12 text-gray-300 mb-2" />
                      <p>No analytics data available</p>
                      <p className="text-sm mt-1">Run campaigns to generate analytics</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="animate-spin h-6 w-6 text-primary mr-2" />
              <span className="text-gray-600">Loading analytics...</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Performing Campaigns</CardTitle>
          <CardDescription>
            Highest engagement across all tenants
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {analytics?.top_campaigns && analytics.top_campaigns.length > 0 ? (
              analytics.top_campaigns.map((campaign, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                  <div className="font-medium">{campaign.campaign_name}</div>
                  <div className="text-right">
                    <div className="font-medium">{campaign.open_rate}%</div>
                    <div className="text-xs text-gray-500">Open Rate</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-4 text-gray-500">
                No campaign data available
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}