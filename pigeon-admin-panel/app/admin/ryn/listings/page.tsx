"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { rynDailyLimitLabel, rynProviderLabel } from "@/lib/rynAdminUi";
import { cn } from "@/lib/utils";

interface RYNListingWithOwner {
  id: string;
  email: string;
  status: string;
  provider: string | null;
  daily_receive_limit: number;
  times_rented: number;
  credits_earned: number;
  mx_ok: boolean;
  created_at: string;
  owner: { id: string; email: string; full_name: string };
}

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "removed", label: "Removed" },
];

const PROVIDER_OPTIONS = [
  "",
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
];

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

function listingStatusBadge(status: string) {
  const colors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    paused: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    removed: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
  };
  return (
    <Badge variant="secondary" className={cn("text-[11px]", colors[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </Badge>
  );
}

export default function AdminRYNListingsPage() {
  const [listings, setListings] = useState<RYNListingWithOwner[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const LIMIT = 25;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setBanner(null);
      try {
        const params = new URLSearchParams({ skip: String(skip), limit: String(LIMIT) });
        if (search) params.set("search", search);
        if (status) params.set("status", status);
        if (provider) params.set("provider", provider);
        const { data } = await adminApi.get<{ listings: RYNListingWithOwner[]; total: number }>(`/admin/ryn/listings?${params}`);
        setListings(data.listings);
        setTotal(data.total);
      } catch (e) {
        setBanner({ type: "error", text: getErrorMessage(e) });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, status, provider, skip]
  );

  useEffect(() => {
    setSkip(0);
  }, [search, status, provider]);
  useEffect(() => {
    load();
  }, [load]);

  async function handleRemove(id: string, email: string) {
    if (!confirm(`Remove listing ${email}?`)) return;
    setBanner(null);
    try {
      await adminApi.delete(`/admin/ryn/listings/${id}`);
      setBanner({ type: "success", text: "Listing removed." });
      load(true);
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RYN Listings</h1>
          <p className="text-muted-foreground text-sm mt-1">{total.toLocaleString()} total listings</p>
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
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[min(100%,14rem)] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap flex-1 min-w-0 justify-end sm:justify-start">
            {STATUS_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-full font-medium border transition-colors",
                  status === value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary hover:text-primary"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[10rem]"
          >
            <option value="">All providers</option>
            {PROVIDER_OPTIONS.filter(Boolean).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : listings.length === 0 ? (
        <Card className="border-border/80 border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">No listings found.</CardContent>
        </Card>
      ) : (
        <Card className="border-border/80 shadow-sm overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm table-fixed">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[20%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[7%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead className="bg-muted/50 border-b border-border/80">
                <tr>
                  <th className="text-left align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Email
                  </th>
                  <th className="text-left align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Owner
                  </th>
                  <th className="text-left align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Provider
                  </th>
                  <th className="text-left align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </th>
                  <th className="text-right align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Limit
                  </th>
                  <th className="text-right align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Used
                  </th>
                  <th className="text-right align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Earned
                  </th>
                  <th className="align-middle px-2 py-2.5 w-[5.5rem]" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {listings.map((l) => {
                  const pKey = rynProviderLabel(l.provider);
                  return (
                    <tr key={l.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 align-top min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-foreground break-all leading-snug">{l.email}</span>
                          {!l.mx_ok && (
                            <Badge
                              variant="outline"
                              className="shrink-0 h-5 px-1.5 text-[10px] font-normal border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                            >
                              MX fail
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top min-w-0">
                        <Link
                          href={`/admin/ryn/users/${l.owner?.id}`}
                          className="text-xs text-primary hover:underline break-all leading-snug inline-block"
                        >
                          {l.owner?.email ?? "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        {pKey ? (
                          <span
                            className={cn(
                              "inline-flex text-[10px] px-2 py-0.5 rounded-md font-medium leading-none",
                              PROVIDER_COLORS[pKey] ?? "bg-muted text-muted-foreground"
                            )}
                          >
                            {pKey}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top">{listingStatusBadge(l.status)}</td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums text-muted-foreground text-xs">
                        {rynDailyLimitLabel(l.daily_receive_limit)}
                      </td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums">{l.times_rented}</td>
                      <td className="px-3 py-2.5 text-right align-top tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                        {l.credits_earned}
                      </td>
                      <td className="px-2 py-2.5 align-top">
                        <div className="flex items-start justify-end gap-0.5">
                          {l.status !== "removed" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                              onClick={() => handleRemove(l.id, l.email)}
                              title="Remove listing"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                            <Link href={`/admin/ryn/listings/${l.id}`} aria-label="Open listing">
                              <ChevronRight className="w-4 h-4" />
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
