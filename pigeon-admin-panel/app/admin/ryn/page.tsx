"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  Mail,
  ArrowLeftRight,
  Coins,
  Lock,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Banknote,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { rynGet } from "@/lib/rynAdminApi";
import { getErrorMessage } from "@/lib/adminApi";
import { cn } from "@/lib/utils";

interface RYNStats {
  users: { total: number; active: number; suspended: number };
  listings: { total: number; active: number; paused: number };
  transactions: { total: number };
  credits: {
    total_balance: number;
    total_held: number;
    total_earned: number;
    total_spent: number;
  };
}

export default function AdminRYNOverviewPage() {
  const [stats, setStats] = useState<RYNStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await rynGet<RYNStats>("/admin/ryn/stats");
      setStats(data);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="h-8 w-56 rounded-md bg-muted animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 rounded-xl border bg-muted/50 animate-pulse" />
          ))}
        </div>
        <div className="h-40 rounded-xl border bg-muted/50 animate-pulse" />
      </div>
    );
  }

  const u = stats?.users ?? { total: 0, active: 0, suspended: 0 };
  const l = stats?.listings ?? { total: 0, active: 0, paused: 0 };
  const tx = stats?.transactions.total ?? 0;
  const c = stats?.credits ?? { total_balance: 0, total_held: 0, total_earned: 0, total_spent: 0 };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">RYN Overview</h1>
          <p className="text-muted-foreground text-sm mt-1">Rent Your Network — platform stats</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing} className="gap-1.5 shrink-0">
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <p className="text-sm rounded-lg border border-red-200 bg-red-50 text-red-900 px-3 py-2 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{u.total.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {u.active.toLocaleString()} active · {u.suspended.toLocaleString()} suspended
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total listings</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{l.total.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {l.active.toLocaleString()} active · {l.paused.toLocaleString()} paused
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm md:col-span-2 lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Transactions</CardTitle>
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{tx.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">All-time credit movements</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Credits</CardTitle>
          <CardDescription>Balances and lifetime totals across RYN users</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Available balance", value: c.total_balance, icon: Coins },
              { label: "On hold (48h)", value: c.total_held, icon: Lock },
              { label: "Total ever earned", value: c.total_earned, icon: TrendingUp },
              { label: "Total ever spent", value: c.total_spent, icon: TrendingDown },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 flex flex-row items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground leading-tight">{label}</p>
                  <p className="text-xl font-semibold tabular-nums mt-1">{value.toLocaleString()}</p>
                </div>
                <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Quick actions</CardTitle>
          <CardDescription>Open a Rent Your Network admin page</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link href="/admin/ryn/users">
              <Users className="mr-2 h-4 w-4 text-muted-foreground" />
              Users
            </Link>
          </Button>
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link href="/admin/ryn/listings">
              <Mail className="mr-2 h-4 w-4 text-muted-foreground" />
              Listings
            </Link>
          </Button>
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link href="/admin/ryn/transactions">
              <ArrowLeftRight className="mr-2 h-4 w-4 text-muted-foreground" />
              Transactions
            </Link>
          </Button>
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link href="/admin/ryn/withdrawals">
              <Banknote className="mr-2 h-4 w-4 text-muted-foreground" />
              Withdrawals
            </Link>
          </Button>
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link href="/admin/ryn/otps">
              <KeyRound className="mr-2 h-4 w-4 text-muted-foreground" />
              Pending OTPs
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
