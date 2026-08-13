"use client";

import Link from "next/link";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { SetupStep } from "@/hooks/useActivationProgress";
import { trackEvent } from "@/lib/analytics-events";

interface SetupProgressCardProps {
  percent: number;
  completedCount: number;
  totalSteps: number;
  steps: SetupStep[];
}

export function SetupProgressCard({
  percent,
  completedCount,
  totalSteps,
  steps,
}: SetupProgressCardProps) {
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Setup progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {completedCount} of {totalSteps} completed
            </span>
            <span className="font-medium">{percent}%</span>
          </div>
          <Progress value={percent} className="h-2.5" />
        </div>
        <ul className="space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                {step.completed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={step.completed ? "text-foreground" : "text-muted-foreground"}>
                  {step.label}
                </span>
              </div>
              {!step.completed ? (
                <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                  <Link
                    href={step.href}
                    onClick={() =>
                      trackEvent("setup_step_viewed", {
                        stepId: step.id,
                        destination: step.href,
                      })
                    }
                  >
                    Open
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

