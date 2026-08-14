"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Clock, Gift, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

interface RYNTransaction {
  id: string;
  user_id: string;
  listing_id?: string;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

const TX_TYPES = ["", "earn", "earn_held", "earn_expired", "spend", "bonus", "refund", "withdraw"];

const TX_COLORS: Record<string, string> = {
  earn: "text-emerald-600 dark:text-emerald-400",
  earn_held: "text-amber-600 dark:text-amber-400",
  earn_expired: "text-zinc-400",
  spend: "text-primary dark:text-primary",
  bonus: "text-primary dark:text-primary",
  refund: "text-primary dark:text-primary",
  withdraw: "text-primary dark:text-primary",
};

const TX_BADGE: Record<string, string> = {
  earn: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  earn_held: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  earn_expired: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
  spend: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  bonus: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  refund: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
  withdraw: "bg-primary/10 text-primary dark:bg-primary dark:text-primary",
};

export default function AdminRYNTransactionsPage() {
  const [transactions, setTransactions] = useState<RYNTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterType, setFilterType] = useState("");
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const LIMIT = 50;

  const [grantUserId, setGrantUserId] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [granting, setGranting] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setBanner(null);
      try {
        const params = new URLSearchParams({ skip: String(skip), limit: String(LIMIT) });
        if (filterUserId) params.set("user_id", filterUserId.trim());
        if (filterType) params.set("type", filterType);
        const { data } = await adminApi.get<{ transactions: RYNTransaction[]; total: number }>(`/admin/ryn/transactions?${params}`);
        setTransactions(data.transactions);
        setTotal(data.total);
      } catch (e) {
        setBanner({ type: "error", text: getErrorMessage(e) });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filterUserId, filterType, skip]
  );

  useEffect(() => {
    setSkip(0);
  }, [filterUserId, filterType]);
  useEffect(() => {
    load();
  }, [load]);

  async function handleGrant() {
    const amount = parseInt(grantAmount, 10);
    if (!grantUserId.trim()) {
      setBanner({ type: "error", text: "Enter a user ID" });
      return;
    }
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
      await adminApi.post("/admin/ryn/transactions/grant", {
        user_id: grantUserId.trim(),
        amount,
        reason: grantReason.trim(),
      });
      setBanner({ type: "success", text: `${amount > 0 ? "Granted" : "Deducted"} ${Math.abs(amount)} credits` });
      setGrantUserId("");
      setGrantAmount("");
      setGrantReason("");
      load(true);
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RYN Transactions</h1>
          <p className="text-muted-foreground text-sm mt-1">{total.toLocaleString()} total transactions</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5 shrink-0">
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {banner && (
        <p
          className={cn(
            "text-sm rounded-lg border px-3 py-2",
            banner.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
          )}
        >
          {banner.text}
        </p>
      )}

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Grant / deduct credits</CardTitle>
          <CardDescription>Adjust a user&apos;s balance using their RYN user ID from the Users list.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5 sm:col-span-1">
              <Label className="text-xs">User ID</Label>
              <Input
                placeholder="ryn user id"
                value={grantUserId}
                onChange={(e) => setGrantUserId(e.target.value)}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (negative to deduct)</Label>
              <Input
                type="number"
                placeholder="e.g. 10 or -5"
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason</Label>
              <Input
                placeholder="e.g. promotional bonus"
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground flex items-start gap-1.5 max-w-xl">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              Positive = grant, negative = deduct (cannot exceed current balance).
            </p>
            <Button size="sm" onClick={handleGrant} disabled={granting} className="gap-1.5">
              {granting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Gift className="w-3.5 h-3.5" />}
              {granting ? "Processing…" : "Apply"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Filter by user ID…"
            value={filterUserId}
            onChange={(e) => setFilterUserId(e.target.value)}
            className="h-9 text-sm font-mono w-full sm:w-64"
          />
          <div className="flex gap-1.5 flex-wrap">
            {TX_TYPES.map((t) => (
              <button
                key={t || "all"}
                type="button"
                onClick={() => setFilterType(t)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-full font-medium border transition-colors",
                  filterType === t
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary hover:text-primary"
                )}
              >
                {t || "All"}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <Card className="border-border/80 border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">No transactions found.</CardContent>
        </Card>
      ) : (
        <Card className="border-border/80 shadow-sm overflow-hidden py-0 divide-y divide-border/80">
          {transactions.map((tx) => (
            <div key={tx.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{tx.description}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(tx.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", TX_BADGE[tx.type] ?? "bg-muted text-muted-foreground")}>
                    {tx.type}
                  </span>
                  <code className="text-[10px] text-muted-foreground font-mono">{tx.user_id.slice(0, 8)}…</code>
                </div>
              </div>
              <span className={cn("text-sm font-bold tabular-nums shrink-0", TX_COLORS[tx.type] ?? "")}>
                {tx.amount > 0 ? "+" : ""}
                {tx.amount}
              </span>
            </div>
          ))}
        </Card>
      )}

      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {skip + 1}–{Math.min(skip + LIMIT, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - LIMIT))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={skip + LIMIT >= total} onClick={() => setSkip(skip + LIMIT)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
