"use client";

import { FormEvent, useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type Template = {
  id: string;
  name: string;
  subject: string;
  user_id?: string;
};

export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newUserId, setNewUserId] = useState("");

  const fetchTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ templates: Template[] }>(
        "/admin/templates",
        { params: { limit: 50 } },
      );
      setTemplates(res.data.templates ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this template?")) return;
    try {
      await adminApi.delete(`/admin/templates/${id}`);
      await fetchTemplates();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        name: newName,
        subject: newSubject,
        body: "",
        user_id: newUserId || undefined,
      };
      await adminApi.post("/admin/templates", payload);
      setNewName("");
      setNewSubject("");
      setNewUserId("");
      setCreateOpen(false);
      await fetchTemplates();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to create");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Templates</h1>
        <div className="flex gap-2">
          <button
            onClick={fetchTemplates}
            className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
          >
            Refresh
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800"
          >
            New Template
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-600">
        Manage email templates across tenants. Use this to quickly create test
        templates or edit problematic ones.
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
                Subject
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                User ID
              </th>
              <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={4}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No templates found.
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">{t.name}</td>
                <td className="border-b px-2 py-2">{t.subject}</td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {t.user_id ?? "—"}
                </td>
                <td className="border-b px-2 py-2 text-right">
                  <button
                    onClick={() => handleDelete(t.id)}
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
      {loading && <p className="text-xs text-zinc-500">Loading templates...</p>}

      {createOpen && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-sm rounded-lg border bg-white px-4 py-4 text-xs shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">
              New Template
            </h2>
            <form className="space-y-3" onSubmit={handleCreate}>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-700">
                  Name
                </label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-700">
                  Subject
                </label>
                <input
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  required
                  className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-700">
                  User ID (optional)
                </label>
                <input
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                  className="w-full rounded border px-2 py-1 text-xs outline-none ring-zinc-900 focus:ring-1"
                />
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

