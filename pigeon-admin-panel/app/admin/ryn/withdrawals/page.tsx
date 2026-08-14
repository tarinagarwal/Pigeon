"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Clock, Building2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

interface RYNWithdrawal {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  credits_requested: number;
  platform_fee_percent: number;
  credits_fee: number;
  credits_net: number;
  payment_method: string;
  bank_account_holder?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc?: string | null;
  upi_id?: string | null;
  upi_name?: string | null;
  status: string;
  admin_notes?: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400",
  processing: "bg-primary/10 text-primary dark:bg-primary/50 dark:text-primary",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-400",
};

const STATUSES = ["pending", "processing", "completed", "rejected"] as const;

export default function AdminRYNWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<RYNWithdrawal[]>([]);
  const [total, setTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const LIMIT = 50;

  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<RYNWithdrawal | null>(null);
  const [newStatus, setNewStatus] = useState<string>("pending");
  const [adminNotes, setAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setBanner(null);
      try {
        const params = new URLSearchParams({ skip: String(skip), limit: String(LIMIT) });
        if (filterStatus) params.set("status", filterStatus);
        const { data } = await adminApi.get<{ withdrawals: RYNWithdrawal[]; total: number }>(
          `/admin/ryn/withdrawals?${params}`
        );
        setWithdrawals(data.withdrawals);
        setTotal(data.total);
      } catch (err) {
        setBanner({ type: "error", text: getErrorMessage(err) });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filterStatus, skip]
  );

  useEffect(() => {
    setSkip(0);
  }, [filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit(w: RYNWithdrawal) {
    setSelected(w);
    setNewStatus(w.status);
    setAdminNotes(w.admin_notes ?? "");
    setEditOpen(true);
  }

  async function saveStatus() {
    if (!selected) return;
    setSaving(true);
    setBanner(null);
    try {
      await adminApi.patch(`/admin/ryn/withdrawals/${selected.id}`, {
        status: newStatus,
        admin_notes: adminNotes.trim() || undefined,
      });
      setBanner({ type: "success", text: "Withdrawal updated." });
      setEditOpen(false);
      setSelected(null);
      load(true);
    } catch (err) {
      setBanner({ type: "error", text: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RYN Withdrawals</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total.toLocaleString()} total request{total === 1 ? "" : "s"} · Bank or UPI cash-outs
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={() => load(true)}
          disabled={refreshing || loading}
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
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
        <CardContent className="p-4 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5 min-w-[12rem]">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={filterStatus || "__all"} onValueChange={(v) => setFilterStatus(v === "__all" ? "" : v)}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card className="border-border/80 h-64 animate-pulse bg-muted/30" />
      ) : withdrawals.length === 0 ? (
        <Card className="border-border/80 border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No withdrawal requests match this filter.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/80 shadow-sm overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm table-fixed">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[26%]" />
                <col className="w-[22%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border/80 bg-muted/50 text-left">
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground align-middle">
                    Created
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground align-middle">
                    User
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground align-middle">
                    Amount
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground align-middle">
                    Method
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground align-middle">
                    Status
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground align-middle w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {withdrawals.map((w) => (
                  <tr key={w.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 align-top whitespace-nowrap text-muted-foreground text-xs">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(w.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top min-w-0">
                      <p className="font-medium text-sm break-words leading-snug">{w.user_name}</p>
                      <p className="text-xs text-muted-foreground break-all mt-0.5 leading-snug">{w.user_email}</p>
                    </td>
                    <td className="px-3 py-2.5 align-top tabular-nums text-sm">
                      <span className="font-semibold">{w.credits_requested}</span>
                      <span className="text-muted-foreground text-xs ml-1">
                        (fee {w.credits_fee} → net {w.credits_net})
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className="inline-flex items-center gap-1">
                        {w.payment_method === "bank" ? (
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                        {w.payment_method.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span
                        className={cn(
                          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                          STATUS_STYLES[w.status] ?? "bg-muted text-muted-foreground"
                        )}
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Button variant="outline" size="sm" onClick={() => openEdit(w)}>
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground">
            Showing {skip + 1}–{Math.min(skip + LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={skip === 0}
              onClick={() => setSkip((s) => Math.max(0, s - LIMIT))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={skip + LIMIT >= total}
              onClick={() => setSkip((s) => s + LIMIT)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Withdrawal request</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                <p>
                  <span className="text-muted-foreground">User:</span> {selected.user_name} ({selected.user_email})
                </p>
                <p>
                  <span className="text-muted-foreground">Credits:</span> {selected.credits_requested} gross · fee{" "}
                  {selected.credits_fee} ({selected.platform_fee_percent}%) · net {selected.credits_net}
                </p>
                <p className="flex items-center gap-1">
                  <span className="text-muted-foreground">Method:</span> {selected.payment_method.toUpperCase()}
                </p>
                {selected.payment_method === "bank" ? (
                  <div className="pt-2 border-t mt-2 space-y-0.5 font-mono text-xs">
                    <p>{selected.bank_account_holder}</p>
                    <p>{selected.bank_name}</p>
                    <p>{selected.bank_account_number}</p>
                    <p>{selected.bank_ifsc}</p>
                  </div>
                ) : (
                  <div className="pt-2 border-t mt-2 space-y-0.5 font-mono text-xs">
                    <p>UPI: {selected.upi_id}</p>
                    <p>Name: {selected.upi_name}</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Admin notes (optional)</Label>
                <Textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Internal note visible on this request…"
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveStatus} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
