"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { PlanResourceKey, PlanGateResult } from "@/hooks/usePlanGate";

interface UpgradeModalProps {
  featureKey?: PlanResourceKey;
  gate?: PlanGateResult;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpgradeModal({
  featureKey,
  gate: gateProp,
  open,
  onOpenChange,
}: UpgradeModalProps) {
  const router = useRouter();
  const gate = gateProp;

  const label = gate?.label ?? "features";
  const planName = gate?.planName;

  const handleUpgradeClick = () => {
    onOpenChange(false);
    router.push("/features");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <Sparkles className="h-4 w-4" />
            </span>
            Upgrade to unlock more {label}
          </DialogTitle>
          <DialogDescription>
            {gate?.reason && <span className="block mb-1.5">{gate.reason}</span>}
            {!gate?.reason && (
              <span className="block mb-1.5">
                You&apos;re hitting the limits of your current plan. Upgrade to keep scaling your outreach.
              </span>
            )}
            {gate?.upgradeLine && (
              <span className="block text-muted-foreground text-sm">{gate.upgradeLine}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        {gate && gate.limit != null && (
          <div className="mt-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Current plan{planName ? `: ${planName}` : ""}</span>
              <span>
                {gate.usage ?? 0} / {gate.limit} {label}
              </span>
            </div>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button onClick={handleUpgradeClick}>{gate?.ctaLabel ?? "Upgrade Plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
