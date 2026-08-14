"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";

type LogItem = {
  id: string;
  inbox_id?: string;
  inbox_email?: string;
  user_id?: string;
  user_email?: string;
  receiver_email?: string;
  engagement_mode?: string;
  subject?: string;
  sent_at?: string;
  opened_at?: string | null;
  replied_at?: string | null;
  reply_generation_source?: string | null;
  reply_quality_score?: number | null;
  close_network_mode?: string | null;
  close_network_risk_score?: number | null;
  close_network_reasons?: string[] | null;
};

function fmtDt(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

const PAGE_SIZE = 50;

export default function AdminWarmupLogsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<LogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  const [filterInboxId, setFilterInboxId] = useState("");
  const [filterUserEmail, setFilterUserEmail] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const buildParams = useCallback(
    (off: number) => {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: off };
      if (filterInboxId.trim()) params.inbox_id = filterInboxId.trim();
      if (filterUserEmail.trim()) params.user_email = filterUserEmail.trim();
      if (filterFrom.trim()) params.sent_after = filterFrom.trim();
      if (filterTo.trim()) params.sent_before = filterTo.trim();
      return params;
    },
    [filterInboxId, filterUserEmail, filterFrom, filterTo]
  );

  const loadLogs = useCallback(
    async (off: number, append: boolean) => {
      const res = await adminApi.get<{ total: number; items: LogItem[] }>(
        "/admin/warmup/sent-history",
        { params: buildParams(off) }
      );
      setTotal(res.data?.total ?? 0);
      const rows = res.data?.items ?? [];
      if (append) {
        setItems((prev) => [...prev, ...rows]);
      } else {
        setItems(rows);
      }
      setOffset(off);
    },
    [buildParams]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadLogs(0, false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, [loadLogs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminApi.get<{ total: number; items: LogItem[] }>(
          "/admin/warmup/sent-history",
          { params: { limit: PAGE_SIZE, offset: 0 } }
        );
        if (cancelled) return;
        setTotal(res.data?.total ?? 0);
        setItems(res.data?.items ?? []);
        setOffset(0);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err) || "Failed to load logs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyFilter = async () => {
    setLoading(true);
    setError(null);
    try {
      await loadLogs(0, false);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = async () => {
    setFilterInboxId("");
    setFilterUserEmail("");
    setFilterFrom("");
    setFilterTo("");
  };

  const loadMore = async () => {
    if (items.length >= total) return;
    setLoading(true);
    setError(null);
    try {
      await loadLogs(offset + PAGE_SIZE, true);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load more");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-zinc-900">Warmup sent logs</h1>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          Refresh
        </Button>
      </div>

      <p className="text-xs text-zinc-600 max-w-3xl">
        Per-message log of warmup sends. Close-network columns (mode / risk) appear for network and shared_pool sends
        after the close-network rollout. See also{" "}
        <Link href="/admin/warmup/close-network" className="text-primary underline underline-offset-2">
          Close network metrics
        </Link>{" "}
        for roll-up judgments.
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-800">Filters</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Inbox ID</label>
            <input
              type="text"
              placeholder="e.g. abc123"
              value={filterInboxId}
              onChange={(e) => setFilterInboxId(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs font-mono w-44"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">User email</label>
            <input
              type="text"
              placeholder="user@example.com"
              value={filterUserEmail}
              onChange={(e) => setFilterUserEmail(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs w-44"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Sent after</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs w-36"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Sent before</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="rounded border border-zinc-300 px-2 py-1 text-xs w-36"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={applyFilter} disabled={loading}>
              Apply
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={clearFilters} disabled={loading}>
              Clear
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="overflow-x-auto rounded border bg-white">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-zinc-50">
              <tr>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700 whitespace-nowrap">Sent at</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">From inbox</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">User</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700 whitespace-nowrap">Mode</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">To receiver</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">Subject</th>
                <th className="border-b px-2 py-2 text-center font-medium text-zinc-700 whitespace-nowrap">CN mode</th>
                <th className="border-b px-2 py-2 text-center font-medium text-zinc-700 whitespace-nowrap">CN risk</th>
                <th className="border-b px-2 py-2 text-center font-medium text-zinc-700">Opened</th>
                <th className="border-b px-2 py-2 text-center font-medium text-zinc-700">Replied</th>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700 whitespace-nowrap">Reply src / score</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} className="px-2 py-4 text-center text-zinc-500">
                    No warmup log entries found.
                  </td>
                </tr>
              )}
              {items.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50">
                  <td className="border-b px-2 py-2 whitespace-nowrap">{fmtDt(row.sent_at)}</td>
                  <td className="border-b px-2 py-2 max-w-[180px] truncate" title={row.inbox_email}>
                    <span className="font-medium text-zinc-900">{row.inbox_email ?? "—"}</span>
                    {row.inbox_id && (
                      <div className="font-mono text-[10px] text-zinc-400">{row.inbox_id.slice(0, 8)}…</div>
                    )}
                  </td>
                  <td className="border-b px-2 py-2 max-w-[160px] truncate" title={row.user_email}>
                    <div>{row.user_email ?? "—"}</div>
                    {row.user_id && (
                      <div className="font-mono text-[10px] text-zinc-400">{row.user_id.slice(0, 8)}…</div>
                    )}
                  </td>
                  <td className="border-b px-2 py-2 font-mono text-[10px] text-zinc-600 whitespace-nowrap">
                    {row.engagement_mode ?? "—"}
                  </td>
                  <td className="border-b px-2 py-2 max-w-[160px] truncate">{row.receiver_email ?? "—"}</td>
                  <td className="border-b px-2 py-2 max-w-[220px] truncate" title={row.subject}>
                    {row.subject ?? "—"}
                  </td>
                  <td className="border-b px-2 py-2 text-center font-mono text-[10px]">
                    {row.close_network_mode ?? "—"}
                  </td>
                  <td
                    className="border-b px-2 py-2 text-center tabular-nums text-[10px]"
                    title={(row.close_network_reasons ?? []).join(", ") || undefined}
                  >
                    {row.close_network_risk_score != null ? Number(row.close_network_risk_score).toFixed(2) : "—"}
                  </td>
                  <td className="border-b px-2 py-2 text-center">
                    {row.opened_at ? (
                      <span className="text-green-700">Yes</span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                    {row.opened_at && (
                      <div className="text-[10px] text-zinc-400 whitespace-nowrap">{fmtDt(row.opened_at)}</div>
                    )}
                  </td>
                  <td className="border-b px-2 py-2 text-center">
                    {row.replied_at ? (
                      <span className="text-green-700">Yes</span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                    {row.replied_at && (
                      <div className="text-[10px] text-zinc-400 whitespace-nowrap">{fmtDt(row.replied_at)}</div>
                    )}
                  </td>
                  <td className="border-b px-2 py-2 text-zinc-600">
                    {row.reply_generation_source ?? "—"}
                    {row.reply_quality_score != null && (
                      <span className="text-zinc-400"> ({Number(row.reply_quality_score).toFixed(2)})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            Showing {items.length} of {total}
          </span>
          {items.length < total && (
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
