"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type Inbox = {
  id: string;
  email: string;
  sender_type?: string;
  status?: string;
  user_id?: string;
  daily_limit?: number;
  warmup_progress?: number;
};

export default function AdminInboxesPage() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInboxes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ inboxes: Inbox[] }>("/admin/inboxes", {
        params: { limit: 50 },
      });
      setInboxes(res.data.inboxes ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load inboxes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInboxes();
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this inbox?")) return;
    try {
      await adminApi.delete(`/admin/inboxes/${id}`);
      await fetchInboxes();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Inboxes</h1>
        <button
          onClick={fetchInboxes}
          className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        Overview of all sending inboxes (Gmail and SMTP) and their warmup
        status.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Email
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Type
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                User ID
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Status
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Warmup
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Daily Limit
              </th>
              <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {inboxes.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={7}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No inboxes found.
                </td>
              </tr>
            )}
            {inboxes.map((inbox) => (
              <tr key={inbox.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">{inbox.email}</td>
                <td className="border-b px-2 py-2">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-700">
                    {inbox.sender_type ?? "unknown"}
                  </span>
                </td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {inbox.user_id ?? "—"}
                </td>
                <td className="border-b px-2 py-2">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-700">
                    {inbox.status ?? "unknown"}
                  </span>
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {typeof inbox.warmup_progress === "number"
                    ? `${inbox.warmup_progress}%`
                    : "—"}
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {inbox.daily_limit ?? "—"}
                </td>
                <td className="border-b px-2 py-2 text-right">
                  <button
                    onClick={() => handleDelete(inbox.id)}
                    className="rounded bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="text-xs text-zinc-500">Loading inboxes...</p>}
    </div>
  );
}

