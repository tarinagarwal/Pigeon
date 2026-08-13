"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SetupStep } from "@/hooks/useActivationProgress";
import { trackEvent } from "@/lib/analytics-events";

interface NextBestActionCardProps {
  nextStep: SetupStep | null;
}

export function NextBestActionCard({ nextStep }: NextBestActionCardProps) {
  if (!nextStep) return null;

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-background">
      <CardContent className="py-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Next best action</p>
            <p className="text-sm text-muted-foreground">{nextStep.hint}</p>
          </div>
        </div>
        <Button asChild className="gradient-primary sm:shrink-0">
          <Link
            href={nextStep.href}
            onClick={() =>
              trackEvent("setup_continue_clicked", {
                stepId: nextStep.id,
                destination: nextStep.href,
              })
            }
          >
            {nextStep.label}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

