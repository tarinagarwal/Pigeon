"use client";

import { useState, useEffect } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  Info, 
  RefreshCw, 
  Trash2, 
  Filter,
  Eye,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

interface ErrorLog {
  id: string;
  service: string;
  error_type: string;
  error_code?: string;
  error_message: string;
  stack_trace?: string;
  user_id?: string;
  resource_type?: string;
  resource_id?: string;
  metadata?: Record<string, any>;
  severity: string;
  resolved: boolean;
  resolved_at?: string;
  created_at: string;
}

interface ErrorStats {
  total: number;
  resolved: number;
  unresolved: number;
  by_service: Array<{ service: string; count: number }>;
  by_severity: Array<{ severity: string; count: number }>;
  by_type: Array<{ type: string; count: number }>;
}

export default function ErrorLogsPage() {
  const [logs, setLogs] = useState<ErrorLog[]>([]);
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<ErrorLog | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  
  // Filters
  const [serviceFilter, setServiceFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [errorTypeFilter, setErrorTypeFilter] = useState("");
  const [resolvedFilter, setResolvedFilter] = useState<string>("all");
  
  // Pagination
  const [page, setPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);
  const logsPerPage = 50;

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [page, serviceFilter, severityFilter, errorTypeFilter, resolvedFilter]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        skip: ((page - 1) * logsPerPage).toString(),
        limit: logsPerPage.toString(),
      });
      
      if (serviceFilter) params.append("service", serviceFilter);
      if (severityFilter) params.append("severity", severityFilter);
      if (errorTypeFilter) params.append("error_type", errorTypeFilter);
      if (resolvedFilter !== "all") params.append("resolved", resolvedFilter);
      
      const res = await adminApi.get<{ logs: ErrorLog[]; total: number }>(
        `/admin/error-logs?${params.toString()}`
      );
      setLogs(res.data.logs);
      setTotalLogs(res.data.total);
    } catch (err) {
      console.error("Failed to fetch error logs:", getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await adminApi.get<ErrorStats>("/admin/error-logs/stats");
      setStats(res.data);
    } catch (err) {
      console.error("Failed to fetch error stats:", getErrorMessage(err));
    }
  };

  const handleResolve = async (logId: string) => {
    try {
      await adminApi.post(`/admin/error-logs/${logId}/resolve`);
      fetchLogs();
      fetchStats();
      if (selectedLog?.id === logId) {
        setSelectedLog({ ...selectedLog, resolved: true });
      }
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const handleDelete = async (logId: string) => {
    if (!confirm("Are you sure you want to delete this error log?")) return;
    
    try {
      await adminApi.delete(`/admin/error-logs/${logId}`);
      fetchLogs();
      fetchStats();
      if (selectedLog?.id === logId) {
        setSelectedLog(null);
      }
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const handleBulkDelete = async () => {
    const scopeLabel =
      serviceFilter || severityFilter || errorTypeFilter || resolvedFilter !== "all"
        ? "all logs matching current filters"
        : "ALL error logs";
    if (!confirm(`Are you sure you want to delete ${scopeLabel}? This cannot be undone.`)) return;

    try {
      setBulkDeleting(true);
      const params = new URLSearchParams();
      if (serviceFilter) params.append("service", serviceFilter);
      if (severityFilter) params.append("severity", severityFilter);
      if (errorTypeFilter) params.append("error_type", errorTypeFilter);
      if (resolvedFilter !== "all") params.append("resolved", resolvedFilter);
      const qs = params.toString();
      const endpoint = qs
        ? `/admin/error-logs/bulk-delete-all?${qs}`
        : "/admin/error-logs/bulk-delete-all";
      await adminApi.delete(endpoint);
      await fetchLogs();
      await fetchStats();
      setSelectedLog(null);
    } catch (err) {
      alert(getErrorMessage(err));
    } finally {
      setBulkDeleting(false);
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "critical":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "error":
        return <AlertTriangle className="w-4 h-4 text-orange-500" />;
      case "warning":
        return <Info className="w-4 h-4 text-yellow-500" />;
      case "info":
        return <Info className="w-4 h-4 text-primary" />;
      default:
        return <Info className="w-4 h-4" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-100 text-red-900";
      case "error":
        return "bg-orange-100 text-orange-900";
      case "warning":
        return "bg-yellow-100 text-yellow-900";
      case "info":
        return "bg-primary/10 text-primary";
      default:
        return "bg-gray-100 text-gray-900";
    }
  };

  const isRecent = (createdAt: string) => {
    const errorTime = new Date(createdAt).getTime();
    const now = new Date().getTime();
    const hoursDiff = (now - errorTime) / (1000 * 60 * 60);
    return hoursDiff <= 24;
  };

  const totalPages = Math.ceil(totalLogs / logsPerPage);

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Error Logs</h1>
        <p className="text-gray-600">Monitor and troubleshoot third-party integration errors</p>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700">Total Errors</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700">Unresolved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{stats.unresolved}</div>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700">Resolved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.resolved}</div>
            </CardContent>
          </Card>
          
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-700">Top Service</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-semibold text-gray-900">
                {stats.by_service[0]?.service || "N/A"}
              </div>
              <div className="text-sm text-gray-600">
                {stats.by_service[0]?.count || 0} errors
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-900">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block text-gray-700">Service</label>
              <select
                className="w-full border border-gray-300 rounded-md p-2 text-gray-900 bg-white focus:border-primary focus:ring-1 focus:ring-primary"
                value={serviceFilter}
                onChange={(e) => {
                  setServiceFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All Services</option>
                <option value="sendgrid">SendGrid</option>
                <option value="gmail">Gmail</option>
                <option value="smtp">SMTP</option>
                <option value="llm">LLM</option>
                <option value="system">System</option>
              </select>
            </div>
            
            <div>
              <label className="text-sm font-medium mb-1 block text-gray-700">Severity</label>
              <select
                className="w-full border border-gray-300 rounded-md p-2 text-gray-900 bg-white focus:border-primary focus:ring-1 focus:ring-primary"
                value={severityFilter}
                onChange={(e) => {
                  setSeverityFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All Severities</option>
                <option value="critical">Critical</option>
                <option value="error">Error</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>
            
            <div>
              <label className="text-sm font-medium mb-1 block text-gray-700">Error Type</label>
              <select
                className="w-full border border-gray-300 rounded-md p-2 text-gray-900 bg-white focus:border-primary focus:ring-1 focus:ring-primary"
                value={errorTypeFilter}
                onChange={(e) => {
                  setErrorTypeFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All Types</option>
                <option value="api_error">API Error</option>
                <option value="auth_error">Auth Error</option>
                <option value="network_error">Network Error</option>
                <option value="validation_error">Validation Error</option>
                <option value="rate_limit">Rate Limit</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            
            <div>
              <label className="text-sm font-medium mb-1 block text-gray-700">Status</label>
              <select
                className="w-full border border-gray-300 rounded-md p-2 text-gray-900 bg-white focus:border-primary focus:ring-1 focus:ring-primary"
                value={resolvedFilter}
                onChange={(e) => {
                  setResolvedFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="false">Unresolved</option>
                <option value="true">Resolved</option>
              </select>
            </div>
          </div>
          
          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setServiceFilter("");
                setSeverityFilter("");
                setErrorTypeFilter("");
                setResolvedFilter("all");
                setPage(1);
              }}
            >
              Clear Filters
            </Button>
            <Button onClick={fetchLogs}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {bulkDeleting ? "Deleting..." : "Bulk Delete"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error Logs Table */}
      <Card className="bg-white">
        <CardHeader>
          <CardTitle className="text-gray-900">Error Logs ({totalLogs})</CardTitle>
          <CardDescription className="text-gray-600">
            Recent errors from third-party integrations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-600">Loading...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              No error logs found
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {logs.map((log) => {
                  const isRecentError = isRecent(log.created_at);
                  return (
                  <div
                    key={log.id}
                    className={`border rounded-lg p-4 cursor-pointer transition ${
                      isRecentError && !log.resolved
                        ? "bg-red-50 border-red-300 shadow-md"
                        : "bg-white border-gray-200"
                    }`}
                    onClick={() => setSelectedLog(log)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getSeverityIcon(log.severity)}
                          {isRecentError && !log.resolved && (
                            <Badge className="bg-red-600 text-white animate-pulse">
                              NEW - Last 24h
                            </Badge>
                          )}
                          <Badge className={getSeverityColor(log.severity)}>
                            {log.severity}
                          </Badge>
                          <Badge variant="outline">{log.service}</Badge>
                          <Badge variant="secondary">{log.error_type}</Badge>
                          {log.resolved && (
                            <Badge className="bg-green-100 text-green-900">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Resolved
                            </Badge>
                          )}
                        </div>
                        <p className="font-medium text-gray-900">{log.error_message}</p>
                        <div className="text-sm text-gray-600 mt-1">
                          {new Date(log.created_at).toLocaleString()}
                          {log.error_code && ` • Code: ${log.error_code}`}
                          {log.user_id && ` • User: ${log.user_id.slice(0, 8)}`}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {!log.resolved && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleResolve(log.id);
                            }}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Resolve
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(log.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-gray-600">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 bg-white/95 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold mb-2 text-gray-900">Error Details</h2>
                  <div className="flex items-center gap-2">
                    {getSeverityIcon(selectedLog.severity)}
                    <Badge className={getSeverityColor(selectedLog.severity)}>
                      {selectedLog.severity}
                    </Badge>
                    <Badge variant="outline">{selectedLog.service}</Badge>
                    <Badge variant="secondary">{selectedLog.error_type}</Badge>
                  </div>
                </div>
                <Button variant="ghost" onClick={() => setSelectedLog(null)}>
                  ✕
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-1 text-gray-900">Error Message</h3>
                  <p className="text-sm bg-red-50 text-red-900 p-3 rounded border border-red-200">
                    {selectedLog.error_message}
                  </p>
                </div>

                {selectedLog.error_code && (
                  <div>
                    <h3 className="font-semibold mb-1 text-gray-900">Error Code</h3>
                    <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded border border-gray-200">
                      {selectedLog.error_code}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold mb-1 text-gray-900">Created At</h3>
                    <p className="text-sm text-gray-700">
                      {new Date(selectedLog.created_at).toLocaleString()}
                    </p>
                  </div>
                  
                  {selectedLog.user_id && (
                    <div>
                      <h3 className="font-semibold mb-1 text-gray-900">User ID</h3>
                      <p className="text-sm font-mono text-gray-700 bg-gray-50 p-2 rounded border border-gray-200">
                        {selectedLog.user_id}
                      </p>
                    </div>
                  )}
                  
                  {selectedLog.resource_type && (
                    <div>
                      <h3 className="font-semibold mb-1 text-gray-900">Resource Type</h3>
                      <p className="text-sm text-gray-700">{selectedLog.resource_type}</p>
                    </div>
                  )}
                  
                  {selectedLog.resource_id && (
                    <div>
                      <h3 className="font-semibold mb-1 text-gray-900">Resource ID</h3>
                      <p className="text-sm font-mono text-gray-700 bg-gray-50 p-2 rounded border border-gray-200">
                        {selectedLog.resource_id}
                      </p>
                    </div>
                  )}
                </div>

                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-1 text-gray-900">Metadata</h3>
                    <pre className="text-xs bg-gray-50 text-gray-900 p-3 rounded overflow-auto border border-gray-200">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {selectedLog.stack_trace && (
                  <div>
                    <h3 className="font-semibold mb-1 text-gray-900">Stack Trace</h3>
                    <pre className="text-xs bg-gray-50 text-gray-900 p-3 rounded overflow-auto max-h-64 border border-gray-200">
                      {selectedLog.stack_trace}
                    </pre>
                  </div>
                )}

                <div className="flex gap-2 pt-4 border-t border-gray-200">
                  {!selectedLog.resolved && (
                    <Button onClick={() => handleResolve(selectedLog.id)}>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Mark as Resolved
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => handleDelete(selectedLog.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                  <Button variant="outline" onClick={() => setSelectedLog(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}