"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type IpStat = {
  ip: string;
  sent: number;
  opened: number;
  replied: number;
};

export default function EmailIpTrackingPage() {
  const [rows, setRows] = useState<IpStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ ips: IpStat[] }>("/admin/emails/ip-stats", {
        params: { limit: 200 },
      });
      setRows(res.data.ips ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load IP stats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Email Infra IP Tracking</h1>
          <p className="text-xs text-zinc-600 mt-1">
            Per-sending-IP stats for Email Infra traffic (sent / opens / replies).
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="rounded border bg-white p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead className="bg-zinc-50">
              <tr>
                <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">IP</th>
                <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">Sent</th>
                <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">Opened</th>
                <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">Replied</th>
                <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">Open %</th>
                <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">Reply %</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-zinc-500">
                    No Email Infra IP activity yet.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const sent = row.sent || 0;
                const openRate = sent > 0 ? ((row.opened || 0) / sent) * 100 : 0;
                const replyRate = sent > 0 ? ((row.replied || 0) / sent) * 100 : 0;
                return (
                  <tr key={row.ip} className="hover:bg-zinc-50">
                    <td className="border-b px-2 py-2 font-mono text-[11px] break-all">
                      {row.ip}
                    </td>
                    <td className="border-b px-2 py-2 text-right font-medium text-zinc-900 tabular-nums">
                      {sent}
                    </td>
                    <td className="border-b px-2 py-2 text-right text-zinc-800 tabular-nums">
                      {row.opened ?? 0}
                    </td>
                    <td className="border-b px-2 py-2 text-right text-zinc-800 tabular-nums">
                      {row.replied ?? 0}
                    </td>
                    <td className="border-b px-2 py-2 text-right text-zinc-700 tabular-nums">
                      {sent > 0 ? `${openRate.toFixed(1)}%` : "—"}
                    </td>
                    <td className="border-b px-2 py-2 text-right text-zinc-700 tabular-nums">
                      {sent > 0 ? `${replyRate.toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

