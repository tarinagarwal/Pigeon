"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  formatSubscriptionDate,
  formatSubscriptionStatus,
  userSubscriptionBlocksOutbound,
  outboundSubscriptionBlockMessage,
} from "@/lib/outboundSubscriptionGate";
import { cn } from "@/lib/utils";

interface BillingSubscriptionStripProps {
  className?: string;
}

/**
 * Shows billing period From / To / Status; highlights when outbound is blocked (pending, outside window, etc.).
 */
export function BillingSubscriptionStrip({ className }: BillingSubscriptionStripProps) {
  const { user } = useAuth();
  if (!user || user.id === "demo-user") return null;

  const blocked = userSubscriptionBlocksOutbound(user);
  if (!blocked) return null;
  const message = outboundSubscriptionBlockMessage(user);
  const pending = (user.subscription_status || "").trim().toLowerCase() === "pending";

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        blocked
          ? "border-amber-500/40 bg-amber-500/10 dark:border-amber-400/30 dark:bg-amber-500/10"
          : "border-border bg-muted/30",
        className
      )}
      role="region"
      aria-label="Subscription billing"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm">
          {pending && (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Billing pending
            </span>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">From</span>{" "}
              {formatSubscriptionDate(user.subscription_start ?? null)}
            </span>
            <span>
              <span className="font-medium text-foreground">To</span>{" "}
              {formatSubscriptionDate(user.subscription_end ?? null)}
            </span>
            <span>
              <span className="font-medium text-foreground">Status</span>{" "}
              <span className={cn(pending && "font-medium text-amber-800 dark:text-amber-200")}>
                {formatSubscriptionStatus(user.subscription_status)}
              </span>
            </span>
          </div>
        </div>
        {blocked ? (
          <div className="flex flex-col gap-2 sm:items-end sm:text-right">
            {message ? (
              <p className="text-xs text-amber-950/90 dark:text-amber-50/95 max-w-md">{message}</p>
            ) : null}
            <Link
              href="/settings?tab=billing"
              className="inline-flex w-fit shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
            >
              Open billing
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
