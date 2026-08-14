"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Button } from "@/components/ui/button";

type CloseNetworkMetrics = {
  period_days: number;
  cutoff_utc: string;
  generated_at_utc: string;
  config: Record<string, unknown>;
  warmup_sent: {
    total_network_and_shared_pool: number;
    with_close_network_score: number;
    would_block_if_full_mode: number;
    projected_full_block_rate_among_scored: number | null;
    projected_full_block_rate_among_all_network_pool: number | null;
    by_engagement_mode: { engagement_mode: string; count: number }[];
    by_logged_close_network_mode: { close_network_mode: string; count: number }[];
    close_network_reason_counts: { reason: string; count: number }[];
  };
  events: {
    total: number;
    by_action: { action: string; count: number }[];
    blocked_reason_counts: { reason: string; count: number }[];
    recent: {
      id?: string;
      inbox_id?: string;
      user_id?: string;
      receiver_email?: string;
      mode?: string;
      action?: string;
      risk_score?: number;
      reasons?: string[];
      created_at?: string;
    }[];
  };
  guidance: string[];
};

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDt(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function AdminWarmupCloseNetworkPage() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CloseNetworkMetrics | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<CloseNetworkMetrics>("/admin/warmup/close-network/metrics", {
        params: { days },
      });
      setData(res.data ?? null);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load metrics");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const cfg = data?.config as {
    WARMUP_CLOSE_NETWORK_MODE_env?: string | null;
    WARMUP_CLOSE_NETWORK_MODE_effective?: string;
    WARMUP_CLOSE_NETWORK_RISK_THRESHOLD?: number;
    WARMUP_CLOSE_NETWORK_ALERT_REJECTION_RATE?: number;
    note?: string;
  } | undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Warmup close-network metrics</h1>
          <p className="mt-1 text-xs text-zinc-600 max-w-3xl">
            Use these aggregates to decide when to change{" "}
            <code className="rounded bg-zinc-100 px-1">WARMUP_CLOSE_NETWORK_MODE</code> (off / shadow / high_confidence /
            full). Restart the backend after changing env.{" "}
            <Link href="/admin/warmup/logs" className="text-primary underline underline-offset-2">
              Send logs
            </Link>{" "}
            now include close-network fields per row.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-zinc-600">
            <span className="font-medium">Window</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs"
            >
              {[7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {data && (
        <>
          <section className="rounded border bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-zinc-800">Effective config</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs">
              <div className="rounded bg-zinc-50 px-3 py-2">
                <p className="font-semibold text-zinc-500 uppercase tracking-wide">Mode (process)</p>
                <p className="font-mono text-sm text-zinc-900">{cfg?.WARMUP_CLOSE_NETWORK_MODE_effective ?? "—"}</p>
              </div>
              <div className="rounded bg-zinc-50 px-3 py-2">
                <p className="font-semibold text-zinc-500 uppercase tracking-wide">Mode (env raw)</p>
                <p className="font-mono text-sm text-zinc-900">
                  {cfg?.WARMUP_CLOSE_NETWORK_MODE_env === null || cfg?.WARMUP_CLOSE_NETWORK_MODE_env === undefined
                    ? "(unset → default shadow)"
                    : String(cfg.WARMUP_CLOSE_NETWORK_MODE_env)}
                </p>
              </div>
              <div className="rounded bg-zinc-50 px-3 py-2">
                <p className="font-semibold text-zinc-500 uppercase tracking-wide">Full-mode risk threshold</p>
                <p className="font-mono text-sm text-zinc-900">{cfg?.WARMUP_CLOSE_NETWORK_RISK_THRESHOLD ?? "—"}</p>
              </div>
              <div className="rounded bg-zinc-50 px-3 py-2">
                <p className="font-semibold text-zinc-500 uppercase tracking-wide">Alert rejection rate</p>
                <p className="font-mono text-sm text-zinc-900">{cfg?.WARMUP_CLOSE_NETWORK_ALERT_REJECTION_RATE ?? "—"}</p>
              </div>
            </div>
            {cfg?.note && <p className="text-[11px] text-zinc-500">{cfg.note}</p>}
            <details className="text-xs">
              <summary className="cursor-pointer font-medium text-zinc-700">All env-backed constants</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-900 p-3 text-[10px] text-zinc-100">
                {JSON.stringify(data.config, null, 2)}
              </pre>
            </details>
          </section>

          <section className="rounded border bg-amber-50/80 p-4 shadow-sm space-y-2">
            <h2 className="text-sm font-semibold text-amber-950">Guidance</h2>
            <ul className="list-disc pl-5 text-xs text-amber-950/90 space-y-1">
              {(data.guidance ?? []).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>

          <section className="rounded border bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-zinc-800">
              warmup_sent ({data.period_days}d, network + shared_pool)
            </h2>
            <p className="text-[11px] text-zinc-500">
              Cutoff {fmtDt(data.cutoff_utc)} · Generated {fmtDt(data.generated_at_utc)}
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Total sends", String(data.warmup_sent.total_network_and_shared_pool)],
                ["With risk score", String(data.warmup_sent.with_close_network_score)],
                ["Would block (full)", String(data.warmup_sent.would_block_if_full_mode)],
                [
                  "Projected full rate (scored)",
                  fmtPct(data.warmup_sent.projected_full_block_rate_among_scored),
                ],
              ].map(([label, value]) => (
                <div key={label} className="rounded bg-zinc-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
                  <p className="text-sm font-semibold text-zinc-900 tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">
              Projected full rate (all sends in window):{" "}
              {fmtPct(data.warmup_sent.projected_full_block_rate_among_all_network_pool)} — includes legacy rows without
              scores in the denominator.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold text-zinc-700 mb-1">By engagement mode</h3>
                <ul className="text-xs space-y-0.5">
                  {data.warmup_sent.by_engagement_mode.map((r) => (
                    <li key={r.engagement_mode} className="flex justify-between gap-2">
                      <span className="font-mono text-zinc-600">{r.engagement_mode}</span>
                      <span className="tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-zinc-700 mb-1">By logged close_network_mode</h3>
                <ul className="text-xs space-y-0.5">
                  {data.warmup_sent.by_logged_close_network_mode.length === 0 && (
                    <li className="text-zinc-400">No rows yet</li>
                  )}
                  {data.warmup_sent.by_logged_close_network_mode.map((r) => (
                    <li key={r.close_network_mode} className="flex justify-between gap-2">
                      <span className="font-mono text-zinc-600">{r.close_network_mode}</span>
                      <span className="tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-700 mb-1">Reason tags on sends (top)</h3>
              <div className="overflow-x-auto rounded border">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="border-b px-2 py-1.5 text-left">Reason</th>
                      <th className="border-b px-2 py-1.5 text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.warmup_sent.close_network_reason_counts.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-2 py-3 text-center text-zinc-400">
                          No reason arrays on sends in this window
                        </td>
                      </tr>
                    )}
                    {data.warmup_sent.close_network_reason_counts.map((r) => (
                      <tr key={r.reason} className="hover:bg-zinc-50">
                        <td className="border-b px-2 py-1 font-mono">{r.reason}</td>
                        <td className="border-b px-2 py-1 text-right tabular-nums">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rounded border bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-zinc-800">warmup_close_network_events</h2>
            <p className="text-xs text-zinc-500">
              Rows appear when a candidate is hard-blocked (not in shadow). Total in window:{" "}
              <span className="font-semibold tabular-nums">{data.events.total}</span>
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold text-zinc-700 mb-1">By action</h3>
                <ul className="text-xs space-y-0.5">
                  {data.events.by_action.length === 0 && <li className="text-zinc-400">None</li>}
                  {data.events.by_action.map((r) => (
                    <li key={r.action} className="flex justify-between gap-2">
                      <span className="font-mono text-zinc-600">{r.action}</span>
                      <span className="tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-zinc-700 mb-1">Blocked — reasons</h3>
                <ul className="text-xs space-y-0.5">
                  {data.events.blocked_reason_counts.length === 0 && <li className="text-zinc-400">None</li>}
                  {data.events.blocked_reason_counts.map((r) => (
                    <li key={r.reason} className="flex justify-between gap-2">
                      <span className="font-mono text-zinc-600">{r.reason}</span>
                      <span className="tabular-nums">{r.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-700 mb-2">Recent events</h3>
              <div className="overflow-x-auto rounded border max-h-80 overflow-y-auto">
                <table className="min-w-full border-collapse text-[11px]">
                  <thead className="sticky top-0 bg-zinc-50">
                    <tr>
                      <th className="border-b px-2 py-1.5 text-left">At</th>
                      <th className="border-b px-2 py-1.5 text-left">Action</th>
                      <th className="border-b px-2 py-1.5 text-left">Receiver</th>
                      <th className="border-b px-2 py-1.5 text-right">Score</th>
                      <th className="border-b px-2 py-1.5 text-left">Reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.events.recent.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-2 py-3 text-center text-zinc-400">
                          No events in window (expected while mode=shadow)
                        </td>
                      </tr>
                    )}
                    {data.events.recent.map((ev) => (
                      <tr key={ev.id ?? `${ev.created_at}-${ev.receiver_email}`} className="hover:bg-zinc-50">
                        <td className="border-b px-2 py-1 whitespace-nowrap">{fmtDt(ev.created_at)}</td>
                        <td className="border-b px-2 py-1 font-mono">{ev.action ?? "—"}</td>
                        <td className="border-b px-2 py-1 max-w-[160px] truncate" title={ev.receiver_email}>
                          {ev.receiver_email ?? "—"}
                        </td>
                        <td className="border-b px-2 py-1 text-right tabular-nums">{ev.risk_score ?? "—"}</td>
                        <td className="border-b px-2 py-1 font-mono text-[10px]">
                          {(ev.reasons ?? []).join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
