"use client";

import { useEffect, useState } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  RefreshCw,
  Plus,
  Search,
  UserCheck,
  UserX,
  KeyRound,
  Trash2,
} from "lucide-react";

type AdminUser = {
  id: string;
  email: string;
  is_super_admin: boolean;
  status: string;
  created_at: string;
  updated_at: string;
};

export default function AdminAdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createSuperAdmin, setCreateSuperAdmin] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editPasswordAdmin, setEditPasswordAdmin] = useState<AdminUser | null>(null);
  const [editPasswordValue, setEditPasswordValue] = useState("");
  const [editPasswordSaving, setEditPasswordSaving] = useState(false);

  const fetchAdmins = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.get<{ admins: AdminUser[] }>("/admin/admins");
      setAdmins(res.data.admins ?? []);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load admins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdmins();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createEmail.trim() || !createPassword.trim()) {
      setError("Email and password are required");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await adminApi.post("/admin/admins", {
        email: createEmail.trim(),
        password: createPassword,
        is_super_admin: createSuperAdmin,
      });
      setShowCreateModal(false);
      setCreateEmail("");
      setCreatePassword("");
      setCreateSuperAdmin(false);
      await fetchAdmins();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to create admin");
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (adminId: string, status: "active" | "disabled") => {
    try {
      await adminApi.patch(`/admin/admins/${adminId}/status`, { status });
      await fetchAdmins();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update status");
    }
  };

  const handleDelete = async (admin: AdminUser) => {
    if (!window.confirm(`Delete admin ${admin.email}? This cannot be undone.`)) return;
    try {
      await adminApi.delete(`/admin/admins/${admin.id}`);
      await fetchAdmins();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete admin");
    }
  };

  const handleEditPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPasswordAdmin || !editPasswordValue.trim() || editPasswordValue.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setEditPasswordSaving(true);
    setError(null);
    try {
      await adminApi.patch(`/admin/admins/${editPasswordAdmin.id}/password`, {
        new_password: editPasswordValue,
      });
      setEditPasswordAdmin(null);
      setEditPasswordValue("");
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update password");
    } finally {
      setEditPasswordSaving(false);
    }
  };

  const filteredAdmins = admins.filter(
    (admin) =>
      admin.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      admin.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <ShieldCheck className="mr-3 h-8 w-8 text-primary" />
            Admin management
          </h1>
          <p className="text-gray-600 mt-2">
            Manage admin users who can access the admin panel (super admin only)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchAdmins} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add admin
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center text-red-800">
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Admin users</CardTitle>
              <CardDescription>
                List of admins. Only super admins can view and manage this list.
              </CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Search by email or ID..."
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary focus:border-primary"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Email</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Role</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Created</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAdmins.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      <ShieldCheck className="mx-auto h-12 w-12 text-gray-300 mb-2" />
                      <p>No admins found</p>
                      <p className="text-sm mt-1">Try adjusting your search or add a new admin</p>
                    </td>
                  </tr>
                )}
                {filteredAdmins.map((admin) => (
                  <tr key={admin.id} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 font-medium text-gray-900">{admin.email}</td>
                    <td className="py-3 px-4">
                      {admin.is_super_admin ? (
                        <Badge variant="default">Super admin</Badge>
                      ) : (
                        <Badge variant="secondary">Admin</Badge>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={admin.status === "active" ? "default" : "secondary"}>
                        {admin.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-sm">
                      {admin.created_at
                        ? new Date(admin.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditPasswordAdmin(admin);
                            setEditPasswordValue("");
                            setError(null);
                          }}
                          title="Change password"
                        >
                          <KeyRound className="h-4 w-4 mr-1" />
                          Edit password
                        </Button>
                        {admin.status === "active" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (window.confirm(`Disable admin ${admin.email}? They will not be able to log in.`)) {
                                handleStatusChange(admin.id, "disabled");
                              }
                            }}
                          >
                            <UserX className="h-4 w-4 mr-1" />
                            Disable
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleStatusChange(admin.id, "active")}
                          >
                            <UserCheck className="h-4 w-4 mr-1" />
                            Enable
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(admin)}
                          title="Delete admin"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="animate-spin h-6 w-6 text-primary mr-2" />
              <span className="text-gray-600">Loading admins...</span>
            </div>
          )}

          {!loading && filteredAdmins.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-600">
              Showing {filteredAdmins.length} of {admins.length} admins
              {searchTerm && " (filtered)"}
            </div>
          )}
        </CardContent>
      </Card>

      {editPasswordAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Edit password — {editPasswordAdmin.email}</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditPasswordAdmin(null);
                  setEditPasswordValue("");
                  setError(null);
                }}
              >
                ×
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEditPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                  <input
                    type="password"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary"
                    value={editPasswordValue}
                    onChange={(e) => setEditPasswordValue(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Min 6 characters"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={editPasswordSaving}>
                    {editPasswordSaving ? "Saving…" : "Update password"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditPasswordAdmin(null);
                      setEditPasswordValue("");
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Add admin</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateEmail("");
                  setCreatePassword("");
                  setError(null);
                }}
              >
                ×
              </Button>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary"
                    value={createEmail}
                    onChange={(e) => setCreateEmail(e.target.value)}
                    required
                    placeholder="admin@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Min 6 characters"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="super_admin"
                    checked={createSuperAdmin}
                    onChange={(e) => setCreateSuperAdmin(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="super_admin" className="text-sm text-gray-700">
                    Super admin (full access including admin management)
                  </label>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="submit" disabled={creating}>
                    {creating ? "Creating…" : "Create admin"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreateEmail("");
                      setCreatePassword("");
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
