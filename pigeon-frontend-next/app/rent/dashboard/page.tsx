"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Coins,
  TrendingUp,
  TrendingDown,
  Mail,
  ArrowRight,
  Plus,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRYN, rynFetch, type RYNTransaction } from "@/contexts/RYNContext";
import RYNShell from "../RYNShell";
import { cn } from "@/lib/utils";

interface CreditsData {
  credits_balance: number;
  credits_total_earned: number;
  credits_total_spent: number;
  transactions: RYNTransaction[];
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className="rounded-3xl border-[3px] border-foreground bg-card p-5 space-y-3 shadow-[5px_5px_0_0_hsl(var(--foreground))]">
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", accent)}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function RYNDashboard() {
  const { user, isLoading } = useRYN();
  const [credits, setCredits] = useState<CreditsData | null>(null);
  const [activeListingCount, setActiveListingCount] = useState(0);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      rynFetch("/ryn/credits"),
      rynFetch("/ryn/emails"),
    ])
      .then(([c, e]) => {
        setCredits(c);
        setActiveListingCount((e.listings ?? []).filter((l: { status: string }) => l.status === "active").length);
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [user]);

  if (isLoading || fetching) {
    return (
      <RYNShell>
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          Loading…
        </div>
      </RYNShell>
    );
  }


  return (
    <RYNShell>
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        {/* Welcome */}
        <div>
          <h1 className="text-xl font-semibold">
            Welcome back, {user?.full_name?.split(" ")[0]}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Here&apos;s an overview of your Rent Your Network account.
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Credits balance"
            value={credits?.credits_balance ?? 0}
            icon={Coins}
            accent="bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
          />
          <StatCard
            label="Total earned"
            value={credits?.credits_total_earned ?? 0}
            icon={TrendingUp}
            accent="bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
          />
          <StatCard
            label="Active listings"
            value={activeListingCount}
            icon={Mail}
            accent="bg-primary/10 text-primary dark:bg-primary dark:text-primary"
          />
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/rent/emails">
              <Plus className="w-4 h-4 mr-1.5" />
              Add email listing
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/rent/activity">
              View activity
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Link>
          </Button>
        </div>

        {/* Recent transactions */}
        <div>
          <h2 className="text-base font-semibold mb-3">Recent transactions</h2>
          {credits?.transactions.length === 0 ? (
            <div className="rounded-3xl border-[3px] border-foreground bg-card p-8 text-center text-sm text-muted-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))]">
              No transactions yet. List an email to start earning credits.
            </div>
          ) : (
            <div className="rounded-3xl border-[3px] border-foreground bg-card divide-y overflow-hidden shadow-[5px_5px_0_0_hsl(var(--foreground))]">
              {credits?.transactions.slice(0, 8).map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/30 transition-colors"
                >
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                      tx.amount > 0
                        ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
                        : "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
                    )}
                  >
                    {tx.amount > 0 ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tx.description}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {new Date(tx.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      tx.amount > 0 ? "text-emerald-600" : "text-red-500"
                    )}
                  >
                    {tx.amount > 0 ? "+" : ""}
                    {tx.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </RYNShell>
  );
}
