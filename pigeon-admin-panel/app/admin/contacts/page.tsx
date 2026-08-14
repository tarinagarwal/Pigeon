"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type Contact = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  user_id?: string;
};

export default function AdminContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ contacts: Contact[] }>(
        "/admin/contacts",
        { params: { limit: 50 } },
      );
      setContacts(res.data.contacts ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this contact?")) return;
    try {
      await adminApi.delete(`/admin/contacts/${id}`);
      await fetchContacts();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Contacts</h1>
        <button
          onClick={fetchContacts}
          className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-zinc-600">
        Inspect and manage contacts across all users. This view bypasses normal
        user-level scoping.
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
                Name
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Company
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
            {contacts.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No contacts found.
                </td>
              </tr>
            )}
            {contacts.map((c) => (
              <tr key={c.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">{c.email}</td>
                <td className="border-b px-2 py-2">
                  {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="border-b px-2 py-2">{c.company ?? "—"}</td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {c.user_id ?? "—"}
                </td>
                <td className="border-b px-2 py-2 text-right">
                  <button
                    onClick={() => handleDelete(c.id)}
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
      {loading && <p className="text-xs text-zinc-500">Loading contacts...</p>}
    </div>
  );
}

