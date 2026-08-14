"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  User,
  RefreshCw,
  Plus,
  Edit,
  Trash2,
  Ban,
  Search,
  Users,
  Sparkles,
  CreditCard,
  UserPlus,
  LogIn,
} from "lucide-react";
import { EditUserDialog } from "@/components/EditUserDialog";
import { ImpersonateUserDialog } from "@/components/ImpersonateUserDialog";
import { SendAlertDialog } from "@/components/SendAlertDialog";
import { AddCreditsDialog } from "@/components/AddCreditsDialog";

type User = {
  id: string;
  email: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  status: string;
  plan_id?: string;
  subscription_start?: string;
  subscription_end?: string;
  subscription_status?: string;
  trial_ends_at?: string;
  trial_used_at?: string;
  razorpay_subscription_id?: string;
  created_at: string;
  last_login?: string;
  campaign_count?: number;
  contact_count?: number;
};

type UserStats = {
  total: number;
  on_trial: number;
  new_this_week: number;
  paid_active: number;
  free: number;
};

type FilterPreset = "all" | "new_7d" | "trial" | "paid" | "free";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchQuery, setSearchQuery] = useState(""); // sent to API (debounced / on submit)
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("all");
  const [planFilter, setPlanFilter] = useState<string>("");
  const [impersonateUser, setImpersonateUser] = useState<User | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await adminApi.get<UserStats>("/admin/users/stats/summary");
      setStats(res.data);
    } catch {
      setStats(null);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { limit: 100 };
      if (filterPreset === "new_7d") params.created_after = "7d";
      else if (filterPreset === "trial") params.subscription_status = "trial";
      if (planFilter) params.plan_id = planFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const res = await adminApi.get<{ users: User[]; total: number }>(
        "/admin/users",
        { params },
      );
      setUsers(res.data.users ?? []);
      setTotal(res.data.total ?? 0);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [filterPreset, planFilter, searchQuery]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this user? This cannot be undone.")) {
      return;
    }
    try {
      await adminApi.delete(`/admin/users/${id}`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await fetchUsers();
      fetchStats();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete");
    }
  };

  const toggleSelectUser = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBan = async (id: string) => {
    if (!window.confirm("Ban this user? This will deactivate their account.")) {
      return;
    }
    try {
      await adminApi.put(`/admin/users/${id}/ban`);
      await fetchUsers();
      fetchStats();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to ban user");
    }
  };

  const handleUnban = async (id: string) => {
    if (!window.confirm("Unban this user? This will reactivate their account.")) {
      return;
    }
    try {
      await adminApi.put(`/admin/users/${id}/unban`);
      await fetchUsers();
      fetchStats();
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to unban user");
    }
  };

  
  const handleSaveUser = async (updatedUserData: Partial<User>) => {
    try {
      await fetchUsers(); // Refresh the user list after saving
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to update user");
    }
  };

  const getStatusVariant = (status: string | undefined) => {
    if (!status) return "gray";
    const s = status.toLowerCase();
    if (s === "active" || s === "verified") return "green";
    if (s === "pending" || s === "unverified") return "yellow";
    if (s === "banned" || s === "inactive") return "red";
    return "gray";
  };

  const filteredUsers = users
    // Search filter (email, name, full name, company, id)
    .filter((user) => {
      const term = searchTerm.toLowerCase();
      if (!term) return true;
      const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").toLowerCase();
      return (
        user.email?.toLowerCase().includes(term) ||
        (user.name && user.name.toLowerCase().includes(term)) ||
        (fullName && fullName.includes(term)) ||
        (user.company && user.company.toLowerCase().includes(term)) ||
        user.id.toLowerCase().includes(term)
      );
    })
    // Quick filter: Free / Paid based purely on plan_id
    .filter((user) => {
      if (filterPreset === "paid") {
        return !!user.plan_id && user.plan_id !== "free";
      }
      if (filterPreset === "free") {
        return !user.plan_id || user.plan_id === "free";
      }
      return true;
    })
    // Extra safety: client-side plan dropdown filter
    .filter((user) => {
      if (!planFilter) return true;
      return user.plan_id === planFilter;
    });

  const visibleIds = filteredUsers.map((u) => u.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected =
    visibleIds.some((id) => selectedIds.has(id)) && !allVisibleSelected;

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (
      !window.confirm(
        `Delete ${ids.length} selected user${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }

    setBulkDeleting(true);
    setError(null);
    try {
      const res = await adminApi.post<{ deleted: number; requested: number }>(
        "/admin/users/bulk-delete",
        { user_ids: ids },
      );
      setSelectedIds(new Set());
      await fetchUsers();
      fetchStats();
      if (res.data.deleted < res.data.requested) {
        setError(
          `Deleted ${res.data.deleted} of ${res.data.requested} users. Some users may no longer exist.`,
        );
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || "Failed to delete selected users");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleRefresh = () => {
    fetchUsers();
    fetchStats();
  };

  const getSubStatusVariant = (subStatus: string | undefined) => {
    if (!subStatus) return "secondary";
    const s = subStatus.toLowerCase();
    if (s === "trial") return "default";
    if (s === "active") return "default";
    if (s === "cancelled") return "secondary";
    return "outline";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <User className="mr-3 h-8 w-8 text-primary" />
            Users
          </h1>
          <p className="text-gray-600 mt-2">
            Manage all registered users in the system
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={async () => {
            const email = prompt('Enter email for new user:');
            if (!email) return;
            
            try {
              await adminApi.post('/admin/users', { email });
              await fetchUsers();
              fetchStats();
            } catch (err: unknown) {
              setError(getErrorMessage(err) || "Failed to create user");
            }
          }}>  
            <Plus className="mr-2 h-4 w-4" />
            Create User
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center text-red-800">
              <Trash2 className="h-5 w-5 mr-2" />
              <span>{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-gray-600 text-sm"> <Users className="h-4 w-4" /> Total users </div>
              <p className="text-2xl font-bold mt-1">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-gray-600 text-sm"> <UserPlus className="h-4 w-4" /> New this week </div>
              <p className="text-2xl font-bold mt-1">{stats.new_this_week}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-gray-600 text-sm"> <Sparkles className="h-4 w-4" /> On trial </div>
              <p className="text-2xl font-bold mt-1">{stats.on_trial}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-gray-600 text-sm"> <CreditCard className="h-4 w-4" /> Paid active </div>
              <p className="text-2xl font-bold mt-1">{stats.paid_active}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-gray-600 text-sm"> <User className="h-4 w-4" /> Free plan </div>
              <p className="text-2xl font-bold mt-1">{stats.free}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4">
            <div>
              <CardTitle>User Management</CardTitle>
              <CardDescription>
                View and manage all users. Filter by subscription, plan, or new signups.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Quick filter:</span>
              {(["all", "new_7d", "trial", "paid", "free"] as const).map((preset) => (
                <Button
                  key={preset}
                  variant={filterPreset === preset ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterPreset(preset)}
                >
                  {preset === "all" && "All"}
                  {preset === "new_7d" && "New (7d)"}
                  {preset === "trial" && "On trial"}
                  {preset === "paid" && "Paid"}
                  {preset === "free" && "Free"}
                </Button>
              ))}
              <select
                className="border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
              >
                <option value="">All plans</option>
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="pro">Pro</option>
                <option value="scale">Scale</option>
              </select>
              <div className="flex gap-1 ml-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <input
                    type="text"
                    placeholder="Search email or name..."
                    className="pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm w-48 focus:ring-2 focus:ring-primary focus:border-primary"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setSearchQuery(searchTerm))}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => setSearchQuery(searchTerm)}>
                  Search
                </Button>
              </div>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-sm text-gray-600">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedIds(new Set())}
                    disabled={bulkDeleting}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {bulkDeleting ? "Deleting..." : "Delete selected"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleSelected;
                      }}
                      onChange={toggleSelectAll}
                      disabled={filteredUsers.length === 0 || bulkDeleting}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      aria-label="Select all visible users"
                    />
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Name</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Company</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Email</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Plan</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Sub status</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Trial ends</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Subscribed from</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Subscribed to</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Campaigns</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Contacts</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Created</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredUsers.length === 0 && !loading && (
                  <tr>
                    <td colSpan={14} className="py-8 text-center text-gray-500">
                      <User className="mx-auto h-12 w-12 text-gray-300 mb-2" />
                      <p>No users found</p>
                      <p className="text-sm mt-1">Try adjusting your search or filter criteria</p>
                    </td>
                  </tr>
                )}
                {filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    className={`hover:bg-gray-50 transition-colors ${selectedIds.has(user.id) ? "bg-primary/50" : ""}`}
                  >
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(user.id)}
                        onChange={() => toggleSelectUser(user.id)}
                        disabled={bulkDeleting}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        aria-label={`Select ${user.email}`}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">
                        {[
                          user.first_name,
                          user.last_name,
                        ]
                          .filter(Boolean)
                          .join(" ") || user.name || user.email.split("@")[0]}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {user.company || "—"}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {user.email}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm font-medium capitalize text-gray-700">
                        {user.plan_id || "free"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={getSubStatusVariant(user.subscription_status)}>
                        {(user.subscription_status || "—").toLowerCase()}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-sm">
                      {user.trial_ends_at
                        ? new Date(user.trial_ends_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-sm">
                      {user.subscription_start
                        ? new Date(user.subscription_start + "T00:00:00").toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-sm">
                      {user.subscription_end
                        ? new Date(user.subscription_end + "T00:00:00").toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={getStatusVariant(user.status)}>
                        {(user.status || "active").toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {user.campaign_count || 0}
                    </td>
                    <td className="py-3 px-4">
                      {user.contact_count || 0}
                    </td>
                    <td className="py-3 px-4 text-gray-600 text-sm">
                      {user.created_at
                        ? new Date(user.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setImpersonateUser(user)}
                          title="Login as this user"
                        >
                          <LogIn className="h-4 w-4" />
                        </Button>
                        <SendAlertDialog
                          user={user}
                          setError={setError}
                        />
                        <AddCreditsDialog
                          user={user}
                          setError={setError}
                        />
                        <EditUserDialog 
                          user={user}
                          onSave={handleSaveUser}
                          error={error}
                          setError={setError}
                        />
                        {user.status === 'banned' ? (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleUnban(user.id)}
                          >
                            <User className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleBan(user.id)}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(user.id)}
                        >
                          <Trash2 className="h-4 w-4" />
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
              <span className="text-gray-600">Loading users...</span>
            </div>
          )}
          
          {!loading && (filteredUsers.length > 0 || total > 0) && (
            <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-600">
              Showing {filteredUsers.length} of {total} users
              {(filterPreset !== "all" || planFilter || searchQuery) && " (filtered)"}
            </div>
          )}
        </CardContent>
      </Card>

      {impersonateUser && (
        <ImpersonateUserDialog
          user={impersonateUser}
          open={!!impersonateUser}
          onOpenChange={(open) => !open && setImpersonateUser(null)}
          setError={setError}
        />
      )}
    </div>
  );
}