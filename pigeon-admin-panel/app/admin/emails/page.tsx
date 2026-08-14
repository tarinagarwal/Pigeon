"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type EmailLog = {
  id: string;
  to?: string;
  subject?: string;
  status?: string;
  campaign_id?: string;
  user_id?: string;
  sent_at?: string;
};

export default function AdminEmailsPage() {
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ email_logs: EmailLog[] }>(
        "/admin/emails/logs",
        { params: { limit: 50 } },
      );
      setLogs(res.data.email_logs ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load email logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Email Logs</h1>
        <button
          onClick={fetchLogs}
          className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        Read-only overview of recently sent emails across campaigns and users.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                To
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Subject
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Status
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Campaign
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                User ID
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Sent At
              </th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No email logs found.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">{log.to ?? "—"}</td>
                <td className="border-b px-2 py-2">
                  {log.subject ? log.subject.slice(0, 80) : "—"}
                </td>
                <td className="border-b px-2 py-2">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-700">
                    {log.status ?? "unknown"}
                  </span>
                </td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {log.campaign_id ?? "—"}
                </td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {log.user_id ?? "—"}
                </td>
                <td className="border-b px-2 py-2 text-[11px] text-zinc-500">
                  {log.sent_at ? new Date(log.sent_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && (
        <p className="text-xs text-zinc-500">Loading email logs...</p>
      )}
    </div>
  );
}

