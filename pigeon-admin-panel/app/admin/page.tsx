"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  TrendingUp,
  Users,
  Mail,
  Server,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

interface AuditLog {
  id: string;
  admin_user_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  created_at: string;
  metadata?: Record<string, any>;
}

interface ErrorStats {
  total: number;
  unresolved: number;
  recent_24h: number;
  by_severity: Array<{ severity: string; count: number }>;
}

type Health = {
  status?: string;
};

type Stats = {
  total_campaigns?: number;
  total_contacts?: number;
  total_domains?: number;
  total_inboxes?: number;
  active_alerts?: number;
};

export default function AdminDashboardPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [errorStats, setErrorStats] = useState<ErrorStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch health status
      const healthRes = await adminApi.get<Health>("/health");
      setHealth(healthRes.data);
        
      // Fetch system stats from the dedicated admin endpoint
      const statsRes = await adminApi.get<{ total_campaigns: number, total_contacts: number, total_domains: number, total_inboxes: number, active_alerts: number }>("/admin/stats");
        
      setStats({
        total_campaigns: statsRes.data.total_campaigns || 0,
        total_contacts: statsRes.data.total_contacts || 0,
        total_domains: statsRes.data.total_domains || 0,
        total_inboxes: statsRes.data.total_inboxes || 0,
        active_alerts: statsRes.data.active_alerts || 0,
      });

      // Fetch error stats
      try {
        const errorRes = await adminApi.get<ErrorStats>("/admin/error-logs/stats");
        // Calculate recent errors (last 24h)
        const recentErrorsRes = await adminApi.get<{ logs: any[], total: number }>("/admin/error-logs", {
          params: { limit: 500, skip: 0 }
        });
        const now = Date.now();
        const recent_24h = recentErrorsRes.data.logs.filter((log: any) => {
          const logTime = new Date(log.created_at).getTime();
          const hoursDiff = (now - logTime) / (1000 * 60 * 60);
          return hoursDiff <= 24 && !log.resolved;
        }).length;
        
        setErrorStats({
          ...errorRes.data,
          recent_24h
        });
      } catch (err) {
        console.error("Failed to fetch error stats", err);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setAuditLogsLoading(true);
    try {
      const res = await adminApi.get<{ logs: AuditLog[] }>(
        "/admin/audit/logs",
        { params: { limit: 5 } },
      );
      setAuditLogs(res.data.logs ?? []);
    } catch (err: unknown) {
      console.error("Failed to load audit logs", err);
    } finally {
      setAuditLogsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    fetchAuditLogs();
  }, []);

  const getStatusColor = (status: string | undefined) => {
    if (!status) return "gray";
    const s = status.toLowerCase();
    if (s === "healthy" || s === "ok" || s === "success") return "green";
    if (s === "warning" || s === "degraded") return "yellow";
    if (s === "error" || s === "failed") return "red";
    return "gray";
  };

  const statCards = [
    {
      title: "Total Campaigns",
      value: stats?.total_campaigns?.toLocaleString() ?? "—",
      description: "Active email campaigns",
      icon: Mail,
      color: "blue",
    },
    {
      title: "Total Contacts",
      value: stats?.total_contacts?.toLocaleString() ?? "—",
      description: "Managed email contacts",
      icon: Users,
      color: "green",
    },
    {
      title: "Active Domains",
      value: stats?.total_domains?.toLocaleString() ?? "—",
      description: "Verified sending domains",
      icon: Server,
      color: "purple",
    },
    {
      title: "Connected Inboxes",
      value: stats?.total_inboxes?.toLocaleString() ?? "—",
      description: "Integrated email accounts",
      icon: Mail,
      color: "orange",
    },
    {
      title: "Active Alerts",
      value: stats?.active_alerts?.toLocaleString() ?? "—",
      description: "System notifications",
      icon: AlertTriangle,
      color: "red",
    },
    {
      title: "API Health",
      value: health?.status ? (
        <Badge variant={getStatusColor(health.status) as any}>
          {health.status.toUpperCase()}
        </Badge>
      ) : "—",
      description: "Backend service status",
      icon: Activity,
      color: "gray",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Overview of your Pigeon admin system
          </p>
        </div>
        <Button onClick={fetchDashboardData} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh Data
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center text-red-800">
              <AlertTriangle className="h-5 w-5 mr-2" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Status Alert - Only show if recent errors exist */}
      {errorStats && errorStats.recent_24h > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-6 w-6 text-red-600 animate-pulse" />
                <div>
                  <h3 className="text-lg font-semibold text-red-900">
                    {errorStats.recent_24h} New Error{errorStats.recent_24h > 1 ? 's' : ''} in Last 24 Hours
                  </h3>
                  <p className="text-sm text-red-700 mt-1">
                    {errorStats.unresolved} total unresolved error{errorStats.unresolved > 1 ? 's' : ''} requiring attention
                  </p>
                  <div className="flex gap-2 mt-2">
                    {errorStats.by_severity.slice(0, 3).map((item) => (
                      <Badge
                        key={item.severity}
                        className={`${
                          item.severity === 'critical' ? 'bg-red-600 text-white' :
                          item.severity === 'error' ? 'bg-orange-500 text-white' :
                          'bg-yellow-500 text-white'
                        }`}
                      >
                        {item.severity}: {item.count}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <Button asChild>
                <a href="/admin/error-logs">
                  View All Errors
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {statCards.map((card, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {card.title}
              </CardTitle>
              <card.icon className={`h-5 w-5 text-${card.color}-500`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold mb-1">{card.value}</div>
              <p className="text-xs text-gray-500">{card.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <TrendingUp className="mr-2 h-5 w-5" />
              Quick Actions
            </CardTitle>
            <CardDescription>
              Common administrative tasks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" className="w-full justify-start" asChild>
              <a href="/admin/campaigns/new">
                <Mail className="mr-2 h-4 w-4" />
                Create New Campaign
              </a>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <a href="/admin/contacts">
                <Users className="mr-2 h-4 w-4" />
                Import Contacts
              </a>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <a href="/admin/domains">
                <Server className="mr-2 h-4 w-4" />
                Add New Domain
              </a>
            </Button>
            <Button variant="outline" className="w-full justify-start" asChild>
              <a href="/admin/audit-logs">
                <Activity className="mr-2 h-4 w-4" />
                View System Logs
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              Latest system events and updates
            </CardDescription>
          </CardHeader>
          <CardContent>
            {auditLogsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-3 rounded-lg bg-gray-50">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-sm">No recent activity</div>
            ) : (
              <div className="space-y-4">
                {auditLogs.map((log) => {
                  // Format the action description based on the action type
                  let actionText = `${log.action.replace(/_/g, ' ')} ${log.resource_type}`;
                  if (log.metadata && log.metadata.payload && log.metadata.payload.name) {
                    actionText = `${log.action.replace(/_/g, ' ')} ${log.resource_type}: ${log.metadata.payload.name}`;
                  } else if (log.metadata && log.metadata.changes) {
                    actionText = `${log.action.replace(/_/g, ' ')} ${log.resource_type}`;
                  }
                  
                  // Convert timestamp to readable format
                  const timeAgo = new Date(log.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });
                  
                  // Determine color based on resource type
                  const getColorClass = () => {
                    switch(log.resource_type) {
                      case 'campaign': return 'bg-primary';
                      case 'contact': return 'bg-green-500';
                      case 'domain': return 'bg-primary';
                      case 'user': return 'bg-orange-500';
                      case 'inbox': return 'bg-primary';
                      default: return 'bg-gray-500';
                    }
                  };
                  
                  return (
                    <div key={log.id} className="flex items-start space-x-3">
                      <div className={`w-2 h-2 rounded-full ${getColorClass()} mt-2`}></div>
                      <div>
                        <p className="text-sm font-medium">{actionText}</p>
                        <p className="text-xs text-gray-500">{timeAgo}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


