"use client";

import Link from "next/link";
import { ChevronDown, Flame, Mail, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useInboxes } from "@/hooks/useInboxes";
import { useDomains } from "@/hooks/useDomains";
import { useAnalytics } from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";

type Health = "good" | "warning" | "bad";

function getHealthColor(health: Health) {
  switch (health) {
    case "good":
      // Bright green to match reference design
      return "bg-[#00C853]";
    case "warning":
      return "bg-warning";
    case "bad":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}

export function SystemStatusDropdown() {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;

  const { data: inboxes = [] } = useInboxes(userId);
  const { data: domains = [] } = useDomains();
  const { data: analytics } = useAnalytics(userId, undefined, 7);

  const warmupScore =
    inboxes.length === 0
      ? 100
      : Math.round(
          inboxes.reduce((sum, i) => sum + (i.warmup_progress ?? 0), 0) / inboxes.length
        );
  const warmupHealth: Health =
    warmupScore >= 80 ? "good" : warmupScore >= 50 ? "warning" : "bad";

  const domainHealthScore =
    domains.length === 0
      ? 100
      : Math.round(
          domains.reduce((sum, d) => sum + d.health_score, 0) / domains.length
        );
  const inboxHealth: Health =
    domainHealthScore >= 80 ? "good" : domainHealthScore >= 50 ? "warning" : "bad";

  const deliverabilityScore = analytics?.deliverability_rate ?? 0;
  const deliverabilityHealth: Health =
    deliverabilityScore >= 80 ? "good" : deliverabilityScore >= 50 ? "warning" : "bad";

  const overallHealth: Health =
    warmupHealth === "bad" || inboxHealth === "bad" || deliverabilityHealth === "bad"
      ? "bad"
      : warmupHealth === "warning" || inboxHealth === "warning" || deliverabilityHealth === "warning"
        ? "warning"
        : "good";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="relative flex items-center gap-2 min-w-0 h-9 rounded-full px-4 bg-secondary/70 text-foreground hover:bg-secondary border border-border/70 shadow-[0_1px_2px_rgba(15,23,42,0.10)]"
          aria-label="System status"
        >
          <span
            className={cn(
              "relative h-2.5 w-2.5 shrink-0 rounded-full ring-[1.5px] ring-background",
              getHealthColor(overallHealth)
            )}
            aria-hidden
          />
          <span className="relative text-xs font-medium tracking-[0.02em]">
            Status
          </span>
          <ChevronDown className="relative h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="px-2 py-2 text-xs font-medium text-muted-foreground">
          Based on your domains and recent sending
        </div>
        <DropdownMenuItem asChild>
          <Link href="/warmup" className="flex items-center gap-3 cursor-pointer">
            <Flame className="h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Warmup health</div>
              <div className="text-xs text-muted-foreground">
                {inboxes.length === 0 ? "No inboxes" : `${warmupScore}% avg progress`}
              </div>
            </div>
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                getHealthColor(warmupHealth)
              )}
            />
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/domains" className="flex items-center gap-3 cursor-pointer">
            <Mail className="h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Inbox health</div>
              <div className="text-xs text-muted-foreground">
                {domains.length === 0 ? "No domains" : `${domainHealthScore}% avg`}
              </div>
            </div>
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                getHealthColor(inboxHealth)
              )}
            />
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/analytics" className="flex items-center gap-3 cursor-pointer">
            <TrendingUp className="h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <div className="font-medium">Deliverability score</div>
              <div className="text-xs text-muted-foreground">
                {deliverabilityScore.toFixed(1)}% (last 7 days)
              </div>
            </div>
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                getHealthColor(deliverabilityHealth)
              )}
            />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
