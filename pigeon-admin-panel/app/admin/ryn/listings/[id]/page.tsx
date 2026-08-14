"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Mail,
  Eye,
  MessageSquare,
  Coins,
  Trash2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

interface RYNListing {
  id: string;
  owner_id: string;
  email: string;
  note?: string;
  credits_per_use: number;
  daily_receive_limit: number;
  mx_ok: boolean;
  mx_records: string[];
  provider: string | null;
  status: string;
  times_rented: number;
  credits_earned: number;
  created_at: string;
  updated_at: string;
}

interface Owner {
  id: string;
  email: string;
  full_name: string;
  status: string;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string;
  created_at: string;
}

interface WarmupActivity {
  id: string;
  receiver_email: string;
  sent_at: string;
  opened_at: string | null;
  replied_at: string | null;
  credit_status?: string;
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

const PROVIDER_SELECT_ORDER = [
  "gmail",
  "outlook",
  "yahoo",
  "icloud",
  "zoho",
  "protonmail",
  "fastmail",
  "aol",
  "gmx",
  "yandex",
  "mailru",
  "tutanota",
  "hey",
] as const;

const TX_COLOR: Record<string, string> = {
  earn: "text-emerald-600 dark:text-emerald-400",
  earn_held: "text-amber-600 dark:text-amber-400",
  earn_expired: "text-zinc-400",
  spend: "text-primary dark:text-primary",
  bonus: "text-primary dark:text-primary",
  refund: "text-primary dark:text-primary",
  withdraw: "text-primary dark:text-primary",
};

export default function AdminRYNListingDetailPage() {
  const params = useParams();
  const listingId = params.id as string;

  const [listing, setListing] = useState<RYNListing | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [warmupActivity, setWarmupActivity] = useState<WarmupActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [dailyLimit, setDailyLimit] = useState(10);
  const [editProvider, setEditProvider] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const { data } = await adminApi.get<{
        listing: RYNListing;
        owner: Owner;
        recent_transactions: Transaction[];
        warmup_activity: WarmupActivity[];
      }>(`/admin/ryn/listings/${listingId}`);
      setListing(data.listing);
      setOwner(data.owner);
      setTransactions(data.recent_transactions);
      setWarmupActivity(data.warmup_activity);
      setNote(data.listing.note ?? "");
      setDailyLimit(data.listing.daily_receive_limit);
      setEditProvider(data.listing.provider ?? "gmail");
    } catch (e) {
      setListing(null);
      setBanner({ type: "error", text: getErrorMessage(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [listingId]);

  async function handleSave() {
    setSaving(true);
    setBanner(null);
    try {
      const { data } = await adminApi.put<{ listing: RYNListing }>(`/admin/ryn/listings/${listingId}`, {
        note,
        daily_receive_limit: dailyLimit,
        provider: editProvider,
      });
      setListing(data.listing);
      setEditing(false);
      setBanner({ type: "success", text: "Listing updated." });
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(newStatus: string) {
    setBanner(null);
    try {
      const { data } = await adminApi.put<{ listing: RYNListing }>(`/admin/ryn/listings/${listingId}`, { status: newStatus });
      setListing(data.listing);
      setBanner({ type: "success", text: `Listing ${newStatus}.` });
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    }
  }

  async function handleRemove() {
    if (!confirm("Remove this listing? (sets status to removed)")) return;
    setBanner(null);
    try {
      await adminApi.delete(`/admin/ryn/listings/${listingId}`);
      setBanner({ type: "success", text: "Listing removed." });
      load();
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-40 rounded bg-muted animate-pulse" />
        <div className="h-44 rounded-xl bg-muted animate-pulse" />
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="space-y-2">
        {banner && <p className="text-sm text-red-600 dark:text-red-400">{banner.text}</p>}
        <p className="text-muted-foreground text-sm">Listing not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/admin/ryn/listings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to listings
      </Link>

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
        <CardHeader className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-xl break-all">{listing.email}</CardTitle>
              <span
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded font-medium",
                  listing.provider ? PROVIDER_COLORS[listing.provider] ?? "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {listing.provider ?? "—"}
              </span>
              <Badge
                variant="secondary"
                className={cn(
                  "text-[11px]",
                  listing.status === "active"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                    : listing.status === "paused"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                )}
              >
                {listing.status}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {listing.mx_ok ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" /> MX OK
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-rose-500">
                  <XCircle className="w-3 h-3" /> MX fail
                </span>
              )}
              {owner && (
                <Link href={`/admin/ryn/users/${owner.id}`} className="text-xs text-primary hover:underline break-all">
                  Owner: {owner.email}
                </Link>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap shrink-0">
            {listing.status === "active" && (
              <Button size="sm" variant="outline" className="gap-1 text-amber-600 border-amber-200 hover:bg-amber-50" onClick={() => handleStatus("paused")}>
                <PauseCircle className="w-3.5 h-3.5" />
                Pause
              </Button>
            )}
            {listing.status === "paused" && (
              <Button size="sm" variant="outline" className="gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => handleStatus("active")}>
                <PlayCircle className="w-3.5 h-3.5" />
                Activate
              </Button>
            )}
            {listing.status !== "removed" && (
              <Button size="sm" variant="outline" className="gap-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleRemove}>
                <Trash2 className="w-3.5 h-3.5" />
                Remove
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
              {editing ? "Cancel edit" : "Edit"}
            </Button>
          </div>
        </div>
        </CardHeader>
        <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs text-muted-foreground">Daily limit</p>
            <p className="text-lg font-semibold tabular-nums mt-1">{listing.daily_receive_limit}/day</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Mail className="w-3 h-3" /> Times used
            </p>
            <p className="text-lg font-semibold tabular-nums mt-1">{listing.times_rented}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Coins className="w-3 h-3" /> Credits earned
            </p>
            <p className="text-lg font-semibold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">{listing.credits_earned}</p>
          </div>
        </div>

        {listing.note && !editing && (
          <p className="text-xs text-muted-foreground italic pt-1">Note: {listing.note}</p>
        )}

        {editing && (
          <div className="space-y-3 pt-2 border-t border-border/80">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Note</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Daily limit (1–20)</Label>
                <Input type="number" min={1} max={20} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Provider</Label>
                <select
                  value={editProvider}
                  onChange={(e) => setEditProvider(e.target.value)}
                  className="w-full h-9 rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {PROVIDER_SELECT_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}

        {listing.mx_records?.length > 0 && (
          <div className="pt-2 border-t border-border/80">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">MX records</p>
            <div className="flex flex-wrap gap-1.5">
              {listing.mx_records.map((mx) => (
                <code key={mx} className="text-[11px] bg-muted px-2 py-0.5 rounded font-mono">
                  {mx}
                </code>
              ))}
            </div>
          </div>
        )}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm overflow-hidden py-0">
        <CardHeader className="p-4 pb-3 border-b border-border/80">
          <CardTitle className="text-base">Warmup activity ({warmupActivity.length})</CardTitle>
          <CardDescription>Recent sends using this listing</CardDescription>
        </CardHeader>
        {warmupActivity.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No warmup activity yet for this listing.</CardContent>
        ) : (
          <div className="divide-y divide-border/80">
            {warmupActivity.map((w) => (
              <div key={w.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors">
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                    w.replied_at
                      ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
                      : w.opened_at
                        ? "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
                        : "bg-primary/10 text-primary dark:bg-primary/40 dark:text-primary"
                  )}
                >
                  {w.replied_at ? <MessageSquare className="w-3 h-3" /> : w.opened_at ? <Eye className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{w.receiver_email}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(w.sent_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                  {w.opened_at && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 font-medium">opened</span>
                  )}
                  {w.replied_at && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 font-medium">replied</span>
                  )}
                  {w.credit_status && (
                    <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{w.credit_status}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="border-border/80 shadow-sm overflow-hidden py-0">
        <CardHeader className="p-4 pb-3 border-b border-border/80">
          <CardTitle className="text-base">Related transactions ({transactions.length})</CardTitle>
          <CardDescription>Credit movements for this listing</CardDescription>
        </CardHeader>
        {transactions.length === 0 ? (
          <CardContent className="py-8 text-center text-sm text-muted-foreground">No transactions for this listing yet.</CardContent>
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
                <span className={cn("text-sm font-bold tabular-nums", TX_COLOR[tx.type] ?? "")}>
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
