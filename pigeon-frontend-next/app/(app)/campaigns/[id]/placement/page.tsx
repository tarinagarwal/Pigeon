"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Old URL: redirects to campaign dashboard Placement tab. */
export default function CampaignPlacementRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";

  useEffect(() => {
    if (id) {
      router.replace(`/campaigns/${id}?tab=placement`);
    }
  }, [id, router]);

  return (
    <div className="flex justify-center py-16 text-muted-foreground">
      <Loader2 className="w-8 h-8 animate-spin" aria-hidden />
    </div>
  );
}
