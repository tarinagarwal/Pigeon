"use client";

import { FormEvent, useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type AutomationRule = {
  id: string;
  name: string;
  description?: string;
  trigger_type: string;
  action_type: string;
  is_active: boolean;
};

export default function AdminAutomationRulesPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("CRON");
  const [actionType, setActionType] = useState("START_CAMPAIGN");

  const loadRules = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ rules: AutomationRule[] }>(
        "/admin/automation/rules",
      );
      setRules(res.data.rules ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load automation rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleToggle = async (rule: AutomationRule) => {
    try {
      await adminApi.put(`/admin/automation/rules/${rule.id}`, {
        is_active: !rule.is_active,
      });
      await loadRules();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update rule");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this automation rule?")) return;
    try {
      await adminApi.delete(`/admin/automation/rules/${id}`);
      await loadRules();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete rule");
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        name,
        description: description || undefined,
        trigger_type: triggerType,
        trigger_config: {},
        action_type: actionType,
        action_config: {},
        is_active: true,
      };
      await adminApi.post("/admin/automation/rules", payload);
      setName("");
      setDescription("");
      setTriggerType("CRON");
      setActionType("START_CAMPAIGN");
      setCreateOpen(false);
      await loadRules();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to create rule");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">
          Automation Rules
        </h1>
        <div className="flex gap-2">
          <button
            onClick={loadRules}
            className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
          >
            Refresh
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800"
          >
            New Rule
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-600">
        Define automation rules that can schedule and execute background jobs.
        This UI starts with basic metadata; you can extend the trigger and
        action configs over time.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Name
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Trigger
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Action
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Active
              </th>
              <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No automation rules found.
                </td>
              </tr>
            )}
            {rules.map((rule) => (
              <tr key={rule.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">
                  <div className="font-medium">{rule.name}</div>
                  {rule.description && (
                    <div className="text-[11px] text-zinc-500">
                      {rule.description}
                    </div>
                  )}
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {rule.trigger_type}
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {rule.action_type}
                </td>
                <td className="border-b px-2 py-2">
                  <button
                    onClick={() => handleToggle(rule)}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                      rule.is_active
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-zinc-100 text-zinc-700"
                    }`}
                  >
                    {rule.is_active ? "Active" : "Inactive"}
                  </button>
                </td>
                <td className="border-b px-2 py-2 text-right">
                  <button
                    onClick={() => handleDelete(rule.id)}
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
      {loading && (
        <p className="text-xs text-zinc-500">Loading automation rules...</p>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-lg border bg-white px-4 py-4 text-xs shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">
              New Automation Rule
            </h2>
            <form className="space-y-3" onSubmit={handleCreate}>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-700">
                  Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-700">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-zinc-700">
                    Trigger Type
                  </label>
                  <select
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value)}
                    className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
                  >
                    <option value="CRON">CRON</option>
                    <option value="ON_EVENT">ON_EVENT</option>
                    <option value="THRESHOLD">THRESHOLD</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-medium text-zinc-700">
                    Action Type
                  </label>
                  <select
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value)}
                    className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
                  >
                    <option value="START_CAMPAIGN">START_CAMPAIGN</option>
                    <option value="PAUSE_WARMUP">PAUSE_WARMUP</option>
                    <option value="SEND_ALERT">SEND_ALERT</option>
                    <option value="RUN_LLM_ANALYSIS">RUN_LLM_ANALYSIS</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

