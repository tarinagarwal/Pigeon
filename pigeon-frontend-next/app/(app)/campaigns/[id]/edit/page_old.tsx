"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCampaign, useUpdateCampaign } from "@/hooks/useCampaigns";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: campaign, isLoading } = useCampaign(id);
  const updateCampaign = useUpdateCampaign();
  const [name, setName] = useState("");
  const [dailyLimit, setDailyLimit] = useState(30);

  useEffect(() => {
    if (campaign) {
      setName(campaign.name);
      setDailyLimit(campaign.daily_limit);
    }
  }, [campaign]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaign || !name.trim()) return;
    updateCampaign.mutate(
      {
        campaignId: id,
        data: { ...campaign, name: name.trim(), daily_limit: dailyLimit },
      },
      {
        onSuccess: () => {
          router.push(`/campaigns/${id}`);
        },
      }
    );
  };

  if (!id) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Invalid campaign ID.</p>
        <Link href="/campaigns">
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to campaigns
          </Button>
        </Link>
      </div>
    );
  }

  if (isLoading || !campaign) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/campaigns/${id}`}>
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Edit campaign</h1>
          <p className="text-muted-foreground mt-1">
            Update campaign name and daily sending limit.
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Campaign settings</CardTitle>
          <CardDescription>
            Change the name or daily limit. For audience, templates, and
            schedule, use the full campaign editor when available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Campaign name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q1 Outreach"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dailyLimit">Daily sending limit</Label>
              <Input
                id="dailyLimit"
                type="number"
                min={1}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(parseInt(e.target.value, 10) || 30)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={updateCampaign.isPending || !name.trim()}
                className="gradient-primary"
              >
                {updateCampaign.isPending ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href={`/campaigns/${id}`}>Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
