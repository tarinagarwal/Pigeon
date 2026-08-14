"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Coins,
  Lock,
  TrendingUp,
  TrendingDown,
  Clock,
  UserX,
  UserCheck,
  Trash2,
  ChevronRight,
  Gift,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

interface RYNUser {
  id: string;
  email: string;
  full_name: string;
  bio?: string;
  status: string;
  credits_balance: number;
  credits_held: number;
  credits_total_earned: number;
  credits_total_spent: number;
  created_at: string;
  updated_at: string;
}

interface RYNListing {
  id: string;
  email: string;
  status: string;
  provider: string | null;
  daily_receive_limit: number;
  times_rented: number;
  credits_earned: number;
  created_at: string;
}

interface RYNTransaction {
  id: string;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  gmail: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
  outlook: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  yahoo: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  icloud: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  zoho: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
  protonmail: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  fastmail: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  aol: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  gmx: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  yandex: "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200",
  mailru: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  tutanota: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  hey: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
};

export default function AdminRYNUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;

  const [user, setUser] = useState<RYNUser | null>(null);
  const [listings, setListings] = useState<RYNListing[]>([]);
  const [transactions, setTransactions] = useState<RYNTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [granting, setGranting] = useState(false);

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const { data } = await adminApi.get<{ user: RYNUser; listings: RYNListing[]; recent_transactions: RYNTransaction[] }>(
        `/admin/ryn/users/${userId}`
      );
      setUser(data.user);
      setListings(data.listings);
      setTransactions(data.recent_transactions);
      setFullName(data.user.full_name ?? "");
    } catch (e) {
      setUser(null);
      setBanner({ type: "error", text: getErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [userId]);

  async function handleSave() {
    setSaving(true);
    setBanner(null);
    try {
      const { data } = await adminApi.put<{ user: RYNUser }>(`/admin/ryn/users/${userId}`, { full_name: fullName });
      setUser(data.user);
      setEditing(false);
      setBanner({ type: "success", text: "User updated." });
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  async function handleSuspend(suspend: boolean) {
    setBanner(null);
    try {
      await adminApi.post(`/admin/ryn/users/${userId}/${suspend ? "suspend" : "unsuspend"}`);
      setBanner({ type: "success", text: `User ${suspend ? "suspended" : "unsuspended"}.` });
      load();
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    }
  }

  async function handleDelete() {
    if (!confirm(`Permanently delete user ${user?.email} and remove all their listings?`)) return;
    setBanner(null);
    try {
      await adminApi.delete(`/admin/ryn/users/${userId}`);
      router.push("/admin/ryn/users");
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    }
  }

  async function handleGrant() {
    const amount = parseInt(grantAmount, 10);
    if (!amount || Number.isNaN(amount)) {
      setBanner({ type: "error", text: "Enter a valid amount" });
      return;
    }
    if (!grantReason.trim()) {
      setBanner({ type: "error", text: "Enter a reason" });
      return;
    }
    setGranting(true);
    setBanner(null);
    try {
      await adminApi.post("/admin/ryn/transactions/grant", { user_id: userId, amount, reason: grantReason.trim() });
      setBanner({ type: "success", text: `${amount > 0 ? "Granted" : "Deducted"} ${Math.abs(amount)} credits` });
      setGrantAmount("");
      setGrantReason("");
      load();
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    } finally {
      setGranting(false);
    }
  }

  const txTypeColor: Record<string, string> = {
    earn: "text-emerald-600 dark:text-emerald-400",
    earn_held: "text-amber-600 dark:text-amber-400",
    earn_expired: "text-zinc-400",
    spend: "text-primary dark:text-primary",
    bonus: "text-primary dark:text-primary",
    refund: "text-primary dark:text-primary",
    withdraw: "text-primary dark:text-primary",
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-40 rounded bg-muted animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-2">
        {banner && <p className="text-sm text-red-600 dark:text-red-400">{banner.text}</p>}
        <p className="text-muted-foreground text-sm">User not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link
        href="/admin/ryn/users"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to users
      </Link>

      {banner && banner.type === "success" && (
        <p className="text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          {banner.text}
        </p>
      )}
      {banner && banner.type === "error" && (
        <p className="text-sm rounded-lg border border-red-200 bg-red-50 text-red-900 px-3 py-2 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {banner.text}
        </p>
      )}

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1 min-w-0">
              {editing ? (
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="text-lg font-semibold h-9 max-w-md" />
              ) : (
                <CardTitle className="text-xl">{user.full_name || "(no name)"}</CardTitle>
              )}
              <CardDescription className="break-all">{user.email}</CardDescription>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[11px]",
                    user.status === "active"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                      : "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
                  )}
                >
                  {user.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Joined {new Date(user.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
            {editing ? (
              <>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                    setFullName(user.full_name ?? "");
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit name
              </Button>
            )}
            {user.status === "active" ? (
              <Button size="sm" variant="outline" className="text-rose-600 border-rose-200 hover:bg-rose-50 gap-1" onClick={() => handleSuspend(true)}>
                <UserX className="w-3.5 h-3.5" />
                Suspend
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 gap-1" onClick={() => handleSuspend(false)}>
                <UserCheck className="w-3.5 h-3.5" />
                Unsuspend
              </Button>
            )}
            <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 gap-1" onClick={handleDelete}>
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </Button>
          </div>
        </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Balance", value: user.credits_balance ?? 0, icon: Coins },
              { label: "On hold", value: user.credits_held ?? 0, icon: Lock },
              { label: "Total earned", value: user.credits_total_earned ?? 0, icon: TrendingUp },
              { label: "Total spent", value: user.credits_total_spent ?? 0, icon: TrendingDown },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Icon className="w-3 h-3" />
                  {label}
                </p>
                <p className="text-lg font-semibold tabular-nums mt-1">
                  {(typeof value === "number" && Number.isFinite(value) ? value : 0).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Grant / deduct credits</CardTitle>
          <CardDescription>Adjust this user&apos;s available balance</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (negative to deduct)</Label>
              <Input
                type="number"
                placeholder="e.g. 10 or -5"
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                className="h-9 w-36 text-sm"
              />
            </div>
            <div className="space-y-1.5 flex-1 min-w-40">
              <Label className="text-xs">Reason</Label>
              <Input placeholder="e.g. promotional bonus" value={grantReason} onChange={(e) => setGrantReason(e.target.value)} className="h-9 text-sm" />
            </div>
            <Button size="sm" onClick={handleGrant} disabled={granting} className="gap-1.5">
              {granting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5" />}
              {granting ? "Processing…" : "Apply"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Positive adds to balance; negative deducts (cannot exceed balance).
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm overflow-hidden py-0">
        <CardHeader className="p-4 pb-3 border-b border-border/80">
          <CardTitle className="text-base">Listings ({listings.length})</CardTitle>
          <CardDescription>Email addresses listed for rent</CardDescription>
        </CardHeader>
        {listings.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No listings.</CardContent>
        ) : (
          <div className="divide-y divide-border/80">
            {listings.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium truncate">{l.email}</p>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium",
                        l.provider ? PROVIDER_COLORS[l.provider] ?? "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {l.provider ?? "—"}
                    </span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px]",
                        l.status === "active"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : l.status === "paused"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                      )}
                    >
                      {l.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Limit: {l.daily_receive_limit}/day · Used {l.times_rented}× · Earned {l.credits_earned} cr
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" asChild>
                  <Link href={`/admin/ryn/listings/${l.id}`}>
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="border-border/80 shadow-sm overflow-hidden py-0">
        <CardHeader className="p-4 pb-3 border-b border-border/80">
          <CardTitle className="text-base">Recent transactions</CardTitle>
          <CardDescription>Latest credit movements</CardDescription>
        </CardHeader>
        {transactions.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</CardContent>
        ) : (
          <div className="divide-y divide-border/80">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tx.description}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(tx.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium">{tx.type}</span>
                  </p>
                </div>
                <span className={cn("text-sm font-bold tabular-nums", txTypeColor[tx.type] ?? "")}>
                  {tx.amount > 0 ? "+" : ""}
                  {tx.amount}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
