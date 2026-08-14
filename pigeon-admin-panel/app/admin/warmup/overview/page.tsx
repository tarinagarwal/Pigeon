"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";

type DashboardInbox = {
  inbox_id: string;
  inbox_email?: string;
  sender_type?: string;
  user_id?: string;
  user_email?: string;
  auto_warmup: boolean;
  warmup_progress?: number;
  status?: string;
  sent_today?: number;
  daily_limit?: number;
  warmup_target_open_rate?: number | null;
  warmup_target_reply_rate?: number | null;
  warmup_sent_7d: number;
  warmup_opened_7d: number;
  warmup_replied_7d: number;
  warmup_open_rate_7d: number | null;
  warmup_reply_rate_7d: number | null;
  warmup_sent_30d: number;
};

type DashboardSummary = {
  warming_inbox_count: number;
  auto_warmup_eligible_count: number;
  warmup_sent_7d_platform: number;
  warmup_opened_7d_platform: number;
  warmup_replied_7d_platform: number;
  warmup_open_rate_7d_platform: number | null;
  warmup_reply_rate_7d_platform: number | null;
};

type HistoryItem = {
  id: string;
  inbox_id?: string;
  inbox_email?: string;
  user_id?: string;
  user_email?: string;
  receiver_email?: string;
  subject?: string;
  sent_at?: string;
  opened_at?: string | null;
  replied_at?: string | null;
  reply_generation_source?: string | null;
  reply_quality_score?: number | null;
};

function fmtDt(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export default function AdminWarmupOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [inboxes, setInboxes] = useState<DashboardInbox[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [filterInboxId, setFilterInboxId] = useState<string>("");
  const historyLimit = 40;

  const loadDashboard = useCallback(async () => {
    const res = await adminApi.get<{
      note?: string;
      summary: DashboardSummary;
      inboxes: DashboardInbox[];
    }>("/admin/warmup/dashboard");
    setNote(res.data?.note ?? "");
    setSummary(res.data?.summary ?? null);
    setInboxes(res.data?.inboxes ?? []);
  }, []);

  const loadHistory = useCallback(
    async (offset: number, append: boolean) => {
      const params: Record<string, string | number> = {
        limit: historyLimit,
        offset,
      };
      if (filterInboxId.trim()) {
        params.inbox_id = filterInboxId.trim();
      }
      const res = await adminApi.get<{ total: number; items: HistoryItem[] }>(
        "/admin/warmup/sent-history",
        { params }
      );
      setHistoryTotal(res.data?.total ?? 0);
      const items = res.data?.items ?? [];
      if (append) {
        setHistoryItems((prev) => [...prev, ...items]);
      } else {
        setHistoryItems(items);
      }
      setHistoryOffset(offset);
    },
    [filterInboxId, historyLimit]
  );

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadDashboard();
      await loadHistory(0, false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load warmup data");
    } finally {
      setLoading(false);
    }
  }, [loadDashboard, loadHistory]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const dash = await adminApi.get<{
          note?: string;
          summary: DashboardSummary;
          inboxes: DashboardInbox[];
        }>("/admin/warmup/dashboard");
        if (cancelled) return;
        setNote(dash.data?.note ?? "");
        setSummary(dash.data?.summary ?? null);
        setInboxes(dash.data?.inboxes ?? []);

        const hist = await adminApi.get<{ total: number; items: HistoryItem[] }>(
          "/admin/warmup/sent-history",
          { params: { limit: historyLimit, offset: 0 } }
        );
        if (cancelled) return;
        setHistoryTotal(hist.data?.total ?? 0);
        setHistoryItems(hist.data?.items ?? []);
        setHistoryOffset(0);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err) || "Failed to load warmup data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyLimit]);

  const applyFilter = async () => {
    setLoading(true);
    setError(null);
    try {
      await loadHistory(0, false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (historyItems.length >= historyTotal) return;
    setLoading(true);
    setError(null);
    try {
      await loadHistory(historyOffset + historyLimit, true);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load more");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-zinc-900">Warmup overview &amp; history</h1>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
          Refresh
        </Button>
      </div>

      <p className="text-xs text-zinc-600 max-w-3xl">
        Sending accounts in <span className="font-medium">warming</span> status, platform-wide warmup mail stats, and
        recent per-message engagement. Replies are generated by the receiver pool (LLM or fallback).{" "}
        {note ? <span className="text-zinc-500">{note}</span> : null}
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Warming inboxes", String(summary.warming_inbox_count)],
            ["Auto-warmup on", String(summary.auto_warmup_eligible_count)],
            ["Sent (7d)", String(summary.warmup_sent_7d_platform)],
            ["Opened (7d)", String(summary.warmup_opened_7d_platform)],
            ["Replied (7d)", String(summary.warmup_replied_7d_platform)],
            ["Open / reply rate (7d)", `${fmtPct(summary.warmup_open_rate_7d_platform)} / ${fmtPct(summary.warmup_reply_rate_7d_platform)}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded border bg-white px-3 py-2 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
              <p className="text-sm font-semibold text-zinc-900 tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-800">Accounts in warmup</h2>
        <p className="text-xs text-zinc-500">
          Inboxes with status <code className="rounded bg-zinc-100 px-1">warming</code>. Sender jobs also require{" "}
          <code className="rounded bg-zinc-100 px-1">auto_warmup</code> and available daily capacity.
        </p>
        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-zinc-50">
              <tr>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Inbox</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">User</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Type</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Progress</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Auto</th>
                <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">Today</th>
                <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">7d sent / open / reply</th>
                <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">30d sent</th>
              </tr>
            </thead>
            <tbody>
              {inboxes.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-zinc-500">
                    No inboxes in warming status.
                  </td>
                </tr>
              )}
              {inboxes.map((row) => (
                <tr key={row.inbox_id} className="hover:bg-zinc-50">
                  <td className="border-b px-2 py-2">
                    <span className="font-medium text-zinc-900">{row.inbox_email ?? row.inbox_id}</span>
                    <span className="ml-1 font-mono text-[10px] text-zinc-400">{row.inbox_id.slice(0, 8)}…</span>
                  </td>
                  <td className="border-b px-2 py-2">
                    <div>{row.user_email ?? "—"}</div>
                    <div className="font-mono text-[10px] text-zinc-400">{row.user_id ?? ""}</div>
                  </td>
                  <td className="border-b px-2 py-2">{row.sender_type ?? "—"}</td>
                  <td className="border-b px-2 py-2 tabular-nums">{row.warmup_progress ?? 0}%</td>
                  <td className="border-b px-2 py-2">{row.auto_warmup ? "Yes" : "No"}</td>
                  <td className="border-b px-2 py-2 text-right tabular-nums">
                    {row.sent_today ?? 0} / {row.daily_limit ?? "—"}
                  </td>
                  <td className="border-b px-2 py-2 text-right tabular-nums">
                    {row.warmup_sent_7d} / {row.warmup_opened_7d} / {row.warmup_replied_7d}
                    <div className="text-[10px] text-zinc-500">
                      {fmtPct(row.warmup_open_rate_7d)} open · {fmtPct(row.warmup_reply_rate_7d)} reply
                    </div>
                  </td>
                  <td className="border-b px-2 py-2 text-right tabular-nums">{row.warmup_sent_30d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="text-sm font-semibold text-zinc-800 w-full sm:w-auto">Warmup mail history</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Filter by inbox id"
              value={filterInboxId}
              onChange={(e) => setFilterInboxId(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs font-mono w-56"
            />
            <Button type="button" size="sm" variant="outline" onClick={applyFilter} disabled={loading}>
              Apply filter
            </Button>
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          Each row is one outbound warmup message to the receiver pool. <span className="font-medium">Opened</span>{" "}
          means the receiver marked it read; <span className="font-medium">Replied</span> means the platform sent a
          reply back to the warming inbox.
        </p>
        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-zinc-50">
              <tr>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Sent</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">From inbox</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">User</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">To receiver</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Subject</th>
                <th className="border-b px-2 py-2 text-center font-medium text-zinc-700">Opened</th>
                <th className="border-b px-2 py-2 text-center font-medium text-zinc-700">Replied</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Reply src</th>
              </tr>
            </thead>
            <tbody>
              {historyItems.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-zinc-500">
                    No warmup messages found.
                  </td>
                </tr>
              )}
              {historyItems.map((h) => (
                <tr key={h.id} className="hover:bg-zinc-50">
                  <td className="border-b px-2 py-2 whitespace-nowrap">{fmtDt(h.sent_at)}</td>
                  <td className="border-b px-2 py-2 max-w-[180px] truncate" title={h.inbox_email}>
                    {h.inbox_email ?? h.inbox_id ?? "—"}
                  </td>
                  <td className="border-b px-2 py-2 max-w-[160px] truncate" title={h.user_email}>
                    {h.user_email ?? "—"}
                  </td>
                  <td className="border-b px-2 py-2 max-w-[160px] truncate">{h.receiver_email ?? "—"}</td>
                  <td className="border-b px-2 py-2 max-w-[220px] truncate" title={h.subject}>
                    {h.subject ?? "—"}
                  </td>
                  <td className="border-b px-2 py-2 text-center">
                    {h.opened_at ? (
                      <span className="text-green-700">Yes</span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="border-b px-2 py-2 text-center">
                    {h.replied_at ? (
                      <span className="text-green-700">Yes</span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="border-b px-2 py-2 text-zinc-600">
                    {h.reply_generation_source ?? "—"}
                    {h.reply_quality_score != null && (
                      <span className="text-zinc-400"> ({Number(h.reply_quality_score).toFixed(2)})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            Showing {historyItems.length} of {historyTotal}
          </span>
          {historyItems.length < historyTotal && (
            <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={loading}>
              Load more
            </Button>
          )}
        </div>
      </section>

      {loading && <p className="text-xs text-zinc-500">Loading…</p>}
    </div>
  );
}
