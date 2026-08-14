"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type Flag = {
  key: string;
  value: boolean | string | number | null;
  description?: string;
};

export default function AdminFeatureFlagsPage() {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFlags = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ flags: Flag[] }>("/admin/system/flags");
      setFlags(res.data.flags ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load feature flags");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlags();
  }, []);

  const toggleFlag = async (flag: Flag) => {
    try {
      await adminApi.put(
        `/admin/system/flags/${encodeURIComponent(flag.key)}`,
        {
          value: !Boolean(flag.value),
          description: flag.description,
        },
      );
      await loadFlags();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update flag");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Feature Flags</h1>
        <button
          onClick={loadFlags}
          className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        Toggle feature flags controlling rollout of new functionality.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border bg-white text-xs">
        <table className="min-w-full border-collapse">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Key
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Value
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Description
              </th>
              <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {flags.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={4}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No feature flags defined yet.
                </td>
              </tr>
            )}
            {flags.map((flag) => (
              <tr key={flag.key} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {flag.key}
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {JSON.stringify(flag.value)}
                </td>
                <td className="border-b px-2 py-2 text-[11px] text-zinc-500">
                  {flag.description ?? "—"}
                </td>
                <td className="border-b px-2 py-2 text-right">
                  <button
                    onClick={() => toggleFlag(flag)}
                    className="rounded bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-zinc-800"
                  >
                    Toggle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && (
        <p className="text-xs text-zinc-500">Loading feature flags...</p>
      )}
    </div>
  );
}

