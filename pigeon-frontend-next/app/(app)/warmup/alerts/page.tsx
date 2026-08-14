"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  AlertTriangle,
  Coins,
  TrendingDown,
  RefreshCw,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useWarmupSharedPoolState } from "@/hooks/useWarmup";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";
import type { CreditTransaction } from "@/types/api";

function fmtDt(iso: string | undefined | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function fmtRelative(iso: string | undefined | null) {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function reasonLabel(reason: string) {
  switch (reason) {
    case "shared_pool_rental_income":
      return "Earned — email engaged";
    case "shared_pool_send":
      return "Sent (awaiting response)";
    case "shared_pool_send_refund":
      return "Refunded — no engagement";
    case "credits_topup":
      return "Credits purchased";
    default:
      return reason.replaceAll("_", " ");
  }
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg,
  iconColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-lg border bg-card">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
      >
        <Icon className={`h-[18px] w-[18px] ${iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-tight tabular-nums">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && (
          <p className="text-[10px] text-muted-foreground/60 leading-tight">
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

export default function WarmupPoolActivityPage() {
  const warmupGate = usePlanGate("warmup");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const { data: poolState, isLoading, refetch } =
    useWarmupSharedPoolState(!warmupGate.atLimit);

  const handleRefresh = () => refetch();

  // Pool rental transactions = emails your inbox received from being in the pool
  const allTransactions: CreditTransaction[] = poolState?.transactions ?? [];
  const rentalTransactions = allTransactions.filter(
    (t) => t.reason === "shared_pool_rental_income"
  );
  const creditsEarned = poolState?.credits.total_earned ?? 0;
  const isContributor = poolState?.contributor.enabled ?? false;

  if (warmupGate.atLimit) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/warmup">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Pool Activity</h1>
        </div>
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mx-auto">
              <Bell className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="font-medium">This feature requires a paid plan</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Upgrade to monitor warmup health and track pool activity.
            </p>
            <Button onClick={() => setUpgradeOpen(true)} className="mt-2">
              Upgrade Plan
            </Button>
          </CardContent>
        </Card>
        <UpgradeModal
          featureKey="warmup"
          gate={warmupGate}
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UpgradeModal
        featureKey="warmup"
        gate={warmupGate}
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/warmup">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Pool Activity</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Track warmup emails your inbox received from the shared pool and credits earned.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      {!isLoading && (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Coins}
            label="Pool emails received"
            value={rentalTransactions.length}
            sub="From renting your inbox"
            iconBg="bg-emerald-50 dark:bg-emerald-950/30"
            iconColor="text-emerald-600 dark:text-emerald-400"
          />
          <StatCard
            icon={TrendingDown}
            label="Credits earned"
            value={creditsEarned}
            sub="By hosting warmup emails"
            iconBg="bg-primary/10 dark:bg-primary/30"
            iconColor="text-primary dark:text-primary"
          />
        </div>
      )}

      {/* Pool Activity — Received from Renting */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-2 justify-between flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Coins className="h-4 w-4" />
                Pool activity — emails your inbox received
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                When your inbox is enrolled in the shared pool, other users&apos;
                warmup emails land in your inbox. You earn{" "}
                <strong>1 credit per email received</strong>. Use those credits
                to send your own warmup emails.
              </p>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground shrink-0 cursor-default mt-0.5" />
                </TooltipTrigger>
                <TooltipContent
                  side="left"
                  className="text-xs max-w-[240px] space-y-1.5 p-3"
                >
                  <p className="font-semibold">How pool renting works:</p>
                  <p>
                    You enroll your inbox in the shared pool from the Network
                    page. Other users&apos; warmup systems then send emails to
                    your inbox, and you earn credits for hosting them.
                  </p>
                  <p>
                    Those credits let you send warmup emails to other people in
                    the pool — building your inbox reputation with real
                    engagement.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {!isContributor && !isLoading && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Your inbox is not enrolled in the pool yet.{" "}
                <Link
                  href="/warmup/network"
                  className="underline underline-offset-2 font-medium"
                >
                  Enable it on the Network page
                </Link>{" "}
                to start earning credits.
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-1.5 p-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : allTransactions.length === 0 ? (
            <div className="py-12 text-center px-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mx-auto mb-3">
                <Coins className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="font-medium text-sm">No pool activity yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                {isContributor
                  ? "Your inbox is enrolled but hasn't received any pool emails yet. This usually starts within 24 hours."
                  : "Enroll your inbox in the shared pool to start receiving warmup emails and earning credits."}
              </p>
              {!isContributor && (
                <Button variant="outline" size="sm" asChild className="mt-3">
                  <Link href="/warmup/network">Go to Network</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {allTransactions.map((tx) => {
                const isRental = tx.reason === "shared_pool_rental_income";
                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          isRental
                            ? "bg-emerald-100 dark:bg-emerald-900/30"
                            : "bg-muted"
                        }`}
                      >
                        <Coins
                          className={`h-3.5 w-3.5 ${
                            isRental
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {reasonLabel(tx.reason)}
                        </p>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger className="text-left">
                              <p className="text-xs text-muted-foreground cursor-default">
                                {fmtRelative(tx.created_at)}
                              </p>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="text-xs">
                              {fmtDt(tx.created_at)}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          tx.delta > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-500"
                        }`}
                      >
                        {tx.delta > 0 ? "+" : ""}
                        {tx.delta} cr
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
