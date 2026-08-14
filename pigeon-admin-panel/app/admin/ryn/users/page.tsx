"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, UserCheck, UserX, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { adminApi, getErrorMessage } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

interface RYNUser {
  id: string;
  email: string;
  full_name: string;
  status: string;
  credits_balance: number;
  credits_held: number;
  credits_total_earned: number;
  credits_total_spent: number;
  created_at: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

function statusBadge(status: string) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "text-[11px] font-medium",
        status === "active"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
          : "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
      )}
    >
      {status}
    </Badge>
  );
}

export default function AdminRYNUsersPage() {
  const [users, setUsers] = useState<RYNUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
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
        const { data } = await adminApi.get<{ users: RYNUser[]; total: number }>(`/admin/ryn/users?${params}`);
        setUsers(data.users);
        setTotal(data.total);
      } catch (e) {
        setBanner({ type: "error", text: getErrorMessage(e) });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, status, skip]
  );

  useEffect(() => {
    setSkip(0);
  }, [search, status]);
  useEffect(() => {
    load();
  }, [load]);

  async function handleSuspend(id: string, suspend: boolean) {
    setBanner(null);
    try {
      await adminApi.post(`/admin/ryn/users/${id}/${suspend ? "suspend" : "unsuspend"}`);
      setBanner({ type: "success", text: `User ${suspend ? "suspended" : "unsuspended"}.` });
      load(true);
    } catch (e) {
      setBanner({ type: "error", text: getErrorMessage(e) });
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RYN Users</h1>
          <p className="text-muted-foreground text-sm mt-1">{total.toLocaleString()} total users</p>
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
              placeholder="Search email or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={cn(
                  "text-xs px-3.5 py-1.5 rounded-full font-medium border transition-colors",
                  status === value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary hover:text-primary"
                )}
              >
                {label}
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
      ) : users.length === 0 ? (
        <Card className="border-border/80 border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">No users found.</CardContent>
        </Card>
      ) : (
        <Card className="border-border/80 shadow-sm overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm table-fixed">
              <colgroup>
                <col className="min-w-[14rem] w-[36%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="bg-muted/50 border-b border-border/80">
                <tr>
                  <th className="text-left align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    User
                  </th>
                  <th className="text-left align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </th>
                  <th className="text-right align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Balance
                  </th>
                  <th className="text-right align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Total earned
                  </th>
                  <th className="text-left align-middle px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Joined
                  </th>
                  <th className="align-middle px-2 py-2.5 w-[7.5rem]" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/80">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5 align-top min-w-0">
                      <p className="font-medium text-foreground break-words leading-snug">{u.full_name || "—"}</p>
                      <p className="text-xs text-muted-foreground break-all mt-0.5 leading-snug">{u.email}</p>
                    </td>
                    <td className="px-3 py-2.5 align-top">{statusBadge(u.status)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">
                      <span className="font-semibold">{u.credits_balance}</span>
                      {u.credits_held > 0 && <span className="text-xs text-amber-600 dark:text-amber-400 ml-1 block sm:inline">+{u.credits_held} held</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                      {u.credits_total_earned}
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(u.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-1 justify-end">
                        {u.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 gap-1 px-2"
                            onClick={() => handleSuspend(u.id, true)}
                          >
                            <UserX className="w-3 h-3 shrink-0" />
                            Suspend
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 gap-1 px-2"
                            onClick={() => handleSuspend(u.id, false)}
                          >
                            <UserCheck className="w-3 h-3 shrink-0" />
                            Unsuspend
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" asChild>
                          <Link href={`/admin/ryn/users/${u.id}`} aria-label="Open user">
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
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
