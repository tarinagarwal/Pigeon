"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  Filter,
  Eye,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface WebhookLogRow {
  id: string;
  provider: string;
  received_at: string;
  signature_valid: boolean;
  event_name?: string | null;
  user_id?: string | null;
  external_id?: string | null;
  outcome: string;
  body_length: number;
}

interface WebhookLogDetail extends WebhookLogRow {
  payload?: Record<string, unknown> | null;
}

export default function BillingWebhooksPage() {
  const [logs, setLogs] = useState<WebhookLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WebhookLogDetail | null>(null);
  const [provider, setProvider] = useState("");
  const [eventContains, setEventContains] = useState("");
  const [outcomeContains, setOutcomeContains] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [sigFilter, setSigFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const limit = 50;

  useEffect(() => {
    void fetchLogs();
  }, [page, provider, eventContains, outcomeContains, userIdFilter, sigFilter]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        skip: ((page - 1) * limit).toString(),
        limit: limit.toString(),
      });
      if (provider) params.append("provider", provider);
      if (eventContains.trim()) params.append("event_contains", eventContains.trim());
      if (outcomeContains.trim()) params.append("outcome_contains", outcomeContains.trim());
      if (userIdFilter.trim()) params.append("user_id", userIdFilter.trim());
      if (sigFilter === "valid") params.append("signature_valid", "true");
      if (sigFilter === "invalid") params.append("signature_valid", "false");

      const res = await adminApi.get<{ logs: WebhookLogRow[]; total: number }>(
        `/admin/billing-webhooks/logs?${params.toString()}`
      );
      setLogs(res.data.logs);
      setTotal(res.data.total);
    } catch (err) {
      console.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const res = await adminApi.get<WebhookLogDetail>(`/admin/billing-webhooks/logs/${id}`);
      setSelected(res.data);
    } catch (err) {
      alert(getErrorMessage(err));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Billing webhooks</h1>
        <p className="text-gray-600">
          Incoming Razorpay and Lemon Squeezy webhooks (payloads stored for debugging)
        </p>
      </div>

      <Card className="bg-white border border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-900">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Provider</label>
              <select
                className="w-full border border-gray-300 rounded-md p-2 text-gray-900 bg-white"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All</option>
                <option value="razorpay">Razorpay</option>
                <option value="lemonsqueezy">Lemon Squeezy</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Event contains</label>
              <Input
                placeholder="e.g. subscription.charged"
                value={eventContains}
                onChange={(e) => {
                  setEventContains(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Outcome contains</label>
              <Input
                placeholder="e.g. processed"
                value={outcomeContains}
                onChange={(e) => {
                  setOutcomeContains(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">User ID</label>
              <Input
                placeholder="Exact match"
                value={userIdFilter}
                onChange={(e) => {
                  setUserIdFilter(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Signature</label>
              <select
                className="w-full border border-gray-300 rounded-md p-2 text-gray-900 bg-white"
                value={sigFilter}
                onChange={(e) => {
                  setSigFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="valid">Valid only</option>
                <option value="invalid">Invalid only</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={fetchLogs}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setProvider("");
                setEventContains("");
                setOutcomeContains("");
                setUserIdFilter("");
                setSigFilter("all");
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white border border-border">
        <CardHeader>
          <CardTitle className="text-gray-900">Webhook log ({total})</CardTitle>
          <CardDescription>Newest first</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-gray-600 py-8 text-center">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="text-gray-600 py-8 text-center">No webhook events yet</p>
          ) : (
            <>
              <div className="space-y-2">
                {logs.map((row) => (
                  <div
                    key={row.id}
                    className="border border-gray-200 rounded-lg p-4 flex flex-wrap items-start justify-between gap-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => void openDetail(row.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge variant="outline" className="capitalize">
                          {row.provider}
                        </Badge>
                        {row.signature_valid ? (
                          <Badge className="bg-emerald-100 text-emerald-900 border-0">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Signed
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-900 border-0">
                            <XCircle className="w-3 h-3 mr-1" />
                            Bad signature
                          </Badge>
                        )}
                        <Badge variant="secondary">{row.outcome}</Badge>
                      </div>
                      <p className="font-mono text-sm text-gray-800 truncate">
                        {row.event_name || "(no event)"}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(row.received_at).toLocaleString()}
                        {row.body_length != null ? ` · ${row.body_length} bytes` : ""}
                        {row.external_id ? ` · ref ${row.external_id}` : ""}
                        {row.user_id ? ` · user ${row.user_id.slice(0, 12)}…` : ""}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={(e) => (e.stopPropagation(), void openDetail(row.id))}>
                      <Eye className="w-4 h-4 mr-1" />
                      Payload
                    </Button>
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-gray-600">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      <ChevronLeft className="w-4 h-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
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

      {selected && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto shadow-xl border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200 flex justify-between items-start gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Webhook payload</h2>
                <p className="text-sm text-gray-600 font-mono mt-1">{selected.id}</p>
              </div>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
            <div className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-gray-500">Provider</span>
                  <p className="font-medium capitalize">{selected.provider}</p>
                </div>
                <div>
                  <span className="text-gray-500">Received</span>
                  <p className="font-medium">{new Date(selected.received_at).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-gray-500">Event</span>
                  <p className="font-mono break-all">{selected.event_name || "—"}</p>
                </div>
                <div>
                  <span className="text-gray-500">Outcome</span>
                  <p className="font-medium">{selected.outcome}</p>
                </div>
                <div>
                  <span className="text-gray-500">Signature valid</span>
                  <p className="font-medium">{selected.signature_valid ? "Yes" : "No"}</p>
                </div>
                <div>
                  <span className="text-gray-500">External ID</span>
                  <p className="font-mono break-all">{selected.external_id || "—"}</p>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">User ID</span>
                  <p className="font-mono break-all text-xs">{selected.user_id || "—"}</p>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-2">JSON payload</h3>
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-auto max-h-[50vh] text-gray-900">
                  {JSON.stringify(selected.payload ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
