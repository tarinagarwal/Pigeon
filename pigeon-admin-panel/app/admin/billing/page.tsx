"use client";

import { useEffect, useState, useMemo } from "react";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type BillingUser = {
  id: string;
  email: string;
  plan_id?: string;
  subscription_status?: string;
  subscription_start?: string | null;
  subscription_end?: string | null;
  razorpay_subscription_id?: string | null;
  lemon_squeezy_subscription_id?: string | null;
  created_at?: string;
};

type UserListResponse = {
  users: BillingUser[];
  total: number;
};

type UserStats = {
  total: number;
  on_trial: number;
  new_this_week: number;
  paid_active: number;
  free: number;
};

function inferBillingCycle(u: BillingUser): "monthly" | "annual" | "unknown" {
  if (!u.subscription_start || !u.subscription_end) return "unknown";
  try {
    const start = new Date(u.subscription_start + "T00:00:00Z");
    const end = new Date(u.subscription_end + "T00:00:00Z");
    const deltaDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (deltaDays >= 20 && deltaDays <= 45) return "monthly";
    if (deltaDays >= 330 && deltaDays <= 400) return "annual";
  } catch {
    return "unknown";
  }
  return "unknown";
}

function getProvider(u: BillingUser): "razorpay" | "lemon_squeezy" | "none" {
  if (u.razorpay_subscription_id) return "razorpay";
  if (u.lemon_squeezy_subscription_id) return "lemon_squeezy";
  return "none";
}

export default function AdminBillingPage() {
  const [users, setUsers] = useState<BillingUser[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [statsRes, usersRes] = await Promise.all([
          adminApi.get<UserStats>("/admin/users/stats/summary"),
          adminApi.get<UserListResponse>("/admin/users", {
            params: { limit: 500 },
          }),
        ]);
        setStats(statsRes.data);
        setUsers(usersRes.data.users ?? []);
      } catch (err: unknown) {
        setError(getErrorMessage(err) || "Failed to load billing data");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const billingUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          u.plan_id &&
          u.plan_id !== "free" &&
          (u.subscription_status || u.subscription_start || u.subscription_end)
      ),
    [users]
  );

  const summary = useMemo(() => {
    const paidActive = billingUsers.filter((u) => u.subscription_status === "active").length;
    const onTrial = billingUsers.filter((u) => u.subscription_status === "trial").length;
    const cancelled = billingUsers.filter((u) => u.subscription_status === "cancelled").length;
    const monthly = billingUsers.filter((u) => inferBillingCycle(u) === "monthly").length;
    const annual = billingUsers.filter((u) => inferBillingCycle(u) === "annual").length;
    return { paidActive, onTrial, cancelled, monthly, annual };
  }, [billingUsers]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Billing overview</h1>
        <p className="text-gray-600 mt-2">
          High-level view of paid users, billing cycles, and subscription periods across Razorpay and Lemon Squeezy.
        </p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-red-800">{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Paid active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary.paidActive}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">On trial (paid plans)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary.onTrial}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Cancelled (kept access)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary.cancelled}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Monthly cycles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary.monthly}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Annual cycles</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {summary.annual}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paid users and billing periods</CardTitle>
          <CardDescription>
            List of users on non-free plans, including provider, billing cycle, and subscription window used for email limits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && (
            <p className="text-sm text-gray-600">Loading billing data...</p>
          )}
          {!loading && billingUsers.length === 0 && (
            <p className="text-sm text-gray-500">No paid users found.</p>
          )}
          {!loading && billingUsers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Plan</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Provider</th>
                    <th className="py-2 pr-3">Cycle</th>
                    <th className="py-2 pr-3">Subscribed from</th>
                    <th className="py-2 pr-3">Subscribed to</th>
                    <th className="py-2 pr-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {billingUsers.map((u) => {
                    const cycle = inferBillingCycle(u);
                    const provider = getProvider(u);
                    return (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="py-2 pr-3 text-gray-900">{u.email}</td>
                        <td className="py-2 pr-3 capitalize text-gray-800">{u.plan_id}</td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline">
                            {(u.subscription_status || "—").toLowerCase()}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {provider === "razorpay" && "Razorpay"}
                          {provider === "lemon_squeezy" && "Lemon Squeezy"}
                          {provider === "none" && "App / manual"}
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {cycle === "monthly" && "Monthly"}
                          {cycle === "annual" && "Annual"}
                          {cycle === "unknown" && "Unknown"}
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {u.subscription_start
                            ? new Date(u.subscription_start + "T00:00:00").toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {u.subscription_end
                            ? new Date(u.subscription_end + "T00:00:00").toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {u.created_at
                            ? new Date(u.created_at).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

