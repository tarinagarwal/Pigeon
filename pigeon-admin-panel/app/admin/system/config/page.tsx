"use client";

import { FormEvent, useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type Config = {
  key: string;
  value: unknown;
  description?: string;
};

export default function AdminSystemConfigPage() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const loadConfigs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ configs: Config[] }>(
        "/admin/system/config",
      );
      setConfigs(res.data.configs ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load system config");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  const handleUpsert = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        value: valueInput,
        description: descriptionInput || undefined,
      };

      await adminApi.put(
        `/admin/system/config/${encodeURIComponent(keyInput)}`,
        payload,
      );
      setEditingKey(null);
      setKeyInput("");
      setValueInput("");
      setDescriptionInput("");
      await loadConfigs();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (cfg: Config) => {
    setEditingKey(cfg.key);
    setKeyInput(cfg.key);
    setValueInput(
      typeof cfg.value === "string" ? cfg.value : JSON.stringify(cfg.value),
    );
    setDescriptionInput(cfg.description ?? "");
  };

  const handleDelete = async (key: string) => {
    setError(null);
    const ok = window.confirm(`Delete system config "${key}"?`);
    if (!ok) return;
    setDeletingKey(key);
    try {
      await adminApi.delete(`/admin/system/config/${encodeURIComponent(key)}`);
      if (editingKey === key) {
        setEditingKey(null);
        setKeyInput("");
        setValueInput("");
        setDescriptionInput("");
      }
      await loadConfigs();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete config");
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">System Config</h1>
        <button
          onClick={loadConfigs}
          className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        Key-value configuration for global system behaviour (limits, thresholds,
        etc.). Values are stored as raw JSON-serializable data.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <form
        onSubmit={handleUpsert}
        className="space-y-2 rounded border bg-white px-4 py-3 text-xs"
      >
        {editingKey ? (
          <p className="rounded border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] text-primary">
            Editing: <span className="font-mono">{editingKey}</span>
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-[1.5fr,2fr]">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-700">
              Key
            </label>
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              required
              placeholder="max_daily_sends_per_tenant"
              className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-700">
              Value
            </label>
            <input
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              required
              placeholder="e.g. 500 or production"
              className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-[11px] font-medium text-zinc-700">
            Description (optional)
          </label>
          <input
            value={descriptionInput}
            onChange={(e) => setDescriptionInput(e.target.value)}
            placeholder="What this config controls"
            className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
          />
        </div>
        <div className="flex justify-end pt-1">
          {editingKey ? (
            <button
              type="button"
              onClick={() => {
                setEditingKey(null);
                setKeyInput("");
                setValueInput("");
                setDescriptionInput("");
              }}
              className="mr-2 rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
            >
              Cancel edit
            </button>
          ) : null}
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800"
          >
            {saving ? "Saving..." : editingKey ? "Update" : "Save"}
          </button>
        </div>
      </form>

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
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {configs.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={4}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No config values set yet.
                </td>
              </tr>
            )}
            {configs.map((cfg) => (
              <tr key={cfg.key} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {cfg.key}
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  {JSON.stringify(cfg.value)}
                </td>
                <td className="border-b px-2 py-2 text-[11px] text-zinc-500">
                  {cfg.description ?? "—"}
                </td>
                <td className="border-b px-2 py-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(cfg)}
                      className="rounded border px-2 py-0.5 hover:bg-zinc-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(cfg.key)}
                      disabled={deletingKey === cfg.key}
                      className="rounded border border-red-300 px-2 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      {deletingKey === cfg.key ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && (
        <p className="text-xs text-zinc-500">Loading system config...</p>
      )}
    </div>
  );
}

