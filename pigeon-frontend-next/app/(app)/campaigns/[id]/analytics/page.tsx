 "use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampaignAbAnalyticsTab } from "@/components/CampaignAbAnalyticsTab";

export default function CampaignAbAnalyticsPage() {
  const params = useParams();
  const campaignId = typeof params.id === "string" ? params.id : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/campaigns">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Campaign A/B Analytics</h1>
          <p className="text-muted-foreground">
            Detailed performance for this campaign&apos;s templates and sequence.
          </p>
        </div>
      </div>

      <CampaignAbAnalyticsTab campaignId={campaignId} />
    </div>
  );
}

