"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";

type Alert = {
  id: string;
  type: string;
  title: string;
  message: string;
  user_id?: string;
  created_at?: string;
};

export default function AdminAlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  
  // Form state
  const [userId, setUserId] = useState("");
  const [sendToAll, setSendToAll] = useState(false);
  const [alertType, setAlertType] = useState("info");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [actionable, setActionable] = useState(false);
  const [actionLink, setActionLink] = useState("");

  const fetchAlerts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ alerts: Alert[] }>("/admin/alerts", {
        params: { limit: 50 },
      });
      setAlerts(res.data.alerts ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this alert?")) return;
    try {
      await adminApi.delete(`/admin/alerts/${id}`);
      await fetchAlerts();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  };

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!sendToAll && !userId.trim()) {
      setError("User ID is required when not sending to all users");
      return;
    }
    
    if (!title.trim() || !message.trim()) {
      setError("Title and message are required");
      return;
    }
    
    try {
      const payload: any = {
        type: alertType,
        title: title,
        message: message,
        actionable: actionable,
        send_to_all: sendToAll,
      };
      
      if (!sendToAll) {
        payload.user_id = userId;
      }
      
      if (actionable && actionLink.trim()) {
        payload.action_link = actionLink.trim();
      }
      
      await adminApi.post("/admin/alerts", payload);
      
      // Reset form
      setUserId("");
      setSendToAll(false);
      setAlertType("info");
      setTitle("");
      setMessage("");
      setActionable(false);
      setActionLink("");
      setShowCreateForm(false);
      
      await fetchAlerts();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to create alert");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900">Alerts</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
          >
            {showCreateForm ? "Cancel" : "Create Alert"}
          </button>
          <button
            onClick={fetchAlerts}
            className="rounded border px-3 py-1 text-xs font-medium hover:bg-zinc-100"
          >
            Refresh
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-600">
        System and tenant alerts. Use this to inspect important warnings and
        clean up noisy ones.
      </p>
      
      {/* Create Alert Form */}
      {showCreateForm && (
        <div className="rounded border bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900 mb-3">Create New Alert</h2>
          <form onSubmit={handleCreateAlert} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700">
                  User ID {!sendToAll && "*"}
                </label>
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full rounded border px-2 py-1.5 text-xs outline-none ring-zinc-900 focus:ring-1"
                  placeholder={sendToAll ? "Not required (sending to all)" : "Enter user ID"}
                  disabled={sendToAll}
                  required={!sendToAll}
                />
              </div>
              
              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700">
                  Alert Type *
                </label>
                <select
                  value={alertType}
                  onChange={(e) => setAlertType(e.target.value)}
                  className="w-full rounded border px-2 py-1.5 text-xs outline-none ring-zinc-900 focus:ring-1"
                >
                  <option value="info">Info</option>
                  <option value="success">Success</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                </select>
              </div>
            </div>
            
            <div className="flex items-center gap-2 p-3 bg-primary/10 rounded border border-primary/20">
              <input
                type="checkbox"
                id="sendToAll"
                checked={sendToAll}
                onChange={(e) => {
                  setSendToAll(e.target.checked);
                  if (e.target.checked) {
                    setUserId("");
                  }
                }}
                className="rounded"
              />
              <label htmlFor="sendToAll" className="text-xs font-medium text-primary">
                📢 Send to ALL users (broadcast)
              </label>
            </div>
            
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-700">
                Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs outline-none ring-zinc-900 focus:ring-1"
                placeholder="Enter alert title"
                required
              />
            </div>
            
            <div className="space-y-1">
              <label className="block text-xs font-medium text-zinc-700">
                Message *
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs outline-none ring-zinc-900 focus:ring-1 min-h-[80px]"
                placeholder="Enter alert message"
                required
              />
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="actionable"
                checked={actionable}
                onChange={(e) => setActionable(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="actionable" className="text-xs text-zinc-700">
                Actionable (requires user action)
              </label>
            </div>
            
            {actionable && (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700">
                  Action Link (optional)
                </label>
                <input
                  type="url"
                  value={actionLink}
                  onChange={(e) => setActionLink(e.target.value)}
                  className="w-full rounded border px-2 py-1.5 text-xs outline-none ring-zinc-900 focus:ring-1"
                  placeholder="https://example.com/take-action or /dashboard"
                />
                <p className="text-xs text-zinc-500">
                  Provide a URL for the "Take Action" button. Can be external (https://...) or internal (/page)
                </p>
              </div>
            )}
            
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary"
              >
                Create Alert
              </button>
            </div>
          </form>
        </div>
      )}
      
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full border-collapse text-xs">
          <thead className="bg-zinc-50">
            <tr>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Type
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Title
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Message
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                User ID
              </th>
              <th className="border-b px-2 py-2 text-left font-medium text-zinc-700">
                Created At
              </th>
              <th className="border-b px-2 py-2 text-right font-medium text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 && !loading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-2 py-4 text-center text-xs text-zinc-500"
                >
                  No alerts found.
                </td>
              </tr>
            )}
            {alerts.map((alert) => (
              <tr key={alert.id} className="hover:bg-zinc-50">
                <td className="border-b px-2 py-2">
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-700">
                    {alert.type}
                  </span>
                </td>
                <td className="border-b px-2 py-2">{alert.title}</td>
                <td className="border-b px-2 py-2">
                  {alert.message.length > 100
                    ? `${alert.message.slice(0, 100)}…`
                    : alert.message}
                </td>
                <td className="border-b px-2 py-2 font-mono text-[11px]">
                  {alert.user_id ?? "—"}
                </td>
                <td className="border-b px-2 py-2 text-[11px] text-zinc-500">
                  {alert.created_at
                    ? new Date(alert.created_at).toLocaleString()
                    : "—"}
                </td>
                <td className="border-b px-2 py-2 text-right">
                  <button
                    onClick={() => handleDelete(alert.id)}
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
      {loading && <p className="text-xs text-zinc-500">Loading alerts...</p>}
    </div>
  );
}

