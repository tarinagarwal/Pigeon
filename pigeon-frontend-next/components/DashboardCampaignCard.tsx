"use client";

import Link from "next/link";
import { Play, Pause, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useCampaignStats } from "@/hooks/useCampaigns";
import { HealthScoreTooltip } from "@/components/HealthScoreTooltip";
import type { Campaign } from "@/types/api";

interface DashboardCampaignCardProps {
  campaign: Campaign;
  onToggle: (campaignId: string, currentStatus: string) => void;
  pausePending?: boolean;
  startPending?: boolean;
}

export function DashboardCampaignCard({
  campaign,
  onToggle,
  pausePending,
  startPending,
}: DashboardCampaignCardProps) {
  const { data: stats, isLoading: statsLoading } = useCampaignStats(campaign.id);

  const sent = stats?.sent ?? 0;
  const opened = stats?.opened ?? 0;
  const replied = stats?.replied ?? 0;
  const health = stats?.health ?? 95;

  return (
    <div className="group flex items-center gap-4 p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/campaigns/${campaign.id}`} className="font-medium truncate hover:text-primary">
            {campaign.name}
          </Link>
          <Badge
            variant={campaign.status === "active" ? "default" : "secondary"}
            className={campaign.status === "active" ? "bg-green-600" : ""}
          >
            {campaign.status}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          <span>{sent} sent</span>
          <span>{opened} opened</span>
          <span>{replied} replied</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {!statsLoading && (
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{health}%</span>
            <HealthScoreTooltip />
            <Progress value={health} className="w-20 h-2" />
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={campaign.status === "active" ? "Pause" : "Start"}
          onClick={(e) => {
            e.preventDefault();
            onToggle(campaign.id, campaign.status);
          }}
          disabled={startPending || pausePending}
        >
          {startPending || pausePending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : campaign.status === "active" ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
