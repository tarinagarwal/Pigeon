"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

export function PaymentFailedBanner() {
  const { user } = useAuth();
  if (!user || user.id === "demo-user") return null;
  const failedAt = user.billing_payment_failed_at;
  if (failedAt == null || String(failedAt).trim() === "") return null;

  return (
    <div
      role="alert"
      className={cn(
        "shrink-0 border-b border-amber-500/35 bg-amber-500/15 px-4 py-2.5 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-50"
      )}
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-2 text-center sm:justify-between sm:text-left">
        <span className="inline-flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          Your last subscription payment did not go through. Update your payment method to avoid losing access.
        </span>
        <Link
          href="/settings?tab=billing"
          className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
        >
          Fix billing
        </Link>
      </div>
    </div>
  );
}
