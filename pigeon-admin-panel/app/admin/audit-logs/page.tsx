"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type AuditLog = {
  id: string;
  admin_user_id: string;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  created_at?: string;
};

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ logs: AuditLog[] }>(
        "/admin/audit/logs",
        { params: { limit: 50 } },
      );
      setLogs(res.data.logs ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Audit Logs</h1>
        <button
          onClick={loadLogs}
          className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        Read-only history of admin actions performed via the admin panel and
        admin APIs.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded border bg-white text-xs">
        <table className="min-w-full border-collapse">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Time
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Admin User ID
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Action
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Resource
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Resource ID
              </th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No audit logs recorded yet.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2 text-[11px] text-zinc-500">
                  {log.created_at
                    ? new Date(log.created_at).toLocaleString()
                    : "—"}
                </td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {log.admin_user_id}
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {log.action}
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {log.resource_type}
                </td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {log.resource_id ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && (
        <p className="text-xs text-zinc-500">Loading audit logs...</p>
      )}
    </div>
  );
}

