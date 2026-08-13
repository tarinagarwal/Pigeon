"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Activity, Clock, Loader2, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCampaign } from "@/hooks/useCampaigns";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

function formatDateLocal(s: string | undefined): string {
  if (!s) return "—";
  try {
    let iso = s.trim();
    if (iso && !/Z$|[+-]\d{2}:?\d{2}$/.test(iso)) {
      iso = iso + "Z";
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "success":
      return <Badge className="bg-success text-success-foreground border-success hover:bg-success hover:text-success-foreground">Completed</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "running":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Running
        </Badge>
      );
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    case "cancelled":
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export default function CampaignActionsPage() {
  const params = useParams();
  const campaignId = typeof params.id === "string" ? params.id : "";
  const queryClient = useQueryClient();

  const { data: campaign, isLoading: campaignLoading } = useCampaign(campaignId);
  const { data, isLoading: jobsLoading } = useQuery({
    queryKey: ["campaign-jobs", campaignId],
    queryFn: () => api.campaigns.getJobs(campaignId),
    enabled: !!campaignId,
  });
  const stopJobMutation = useMutation({
    mutationFn: (jobId: string) => api.campaigns.stopJob(campaignId, jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaign-jobs", campaignId] });
    },
  });

  const jobs = data?.jobs ?? [];

  return (
    <div className="space-y-6 bg-background min-h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={campaignId ? "/campaigns" : "/campaigns"}>
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6" />
            Campaign Actions
          </h1>
          <div className="text-muted-foreground mt-1">
            {campaignLoading ? (
              <Skeleton className="h-5 w-48 inline-block" />
            ) : campaign ? (
              <>Batch jobs for: {campaign.name}</>
            ) : (
              "Batch jobs for this campaign"
            )}
          </div>
        </div>
      </div>

      <Card className="border border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Batch jobs
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Send-batch jobs run periodically to send emails for this campaign.
            Jobs are created when you start the campaign and every hour while it
            is active.
          </p>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : jobs.length === 0 ? (
            <p className="text-muted-foreground text-sm py-6 text-center">
              No batch jobs yet. Start the campaign to create the first job.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled (local time)</TableHead>
                  <TableHead>Started (local time)</TableHead>
                  <TableHead>Finished (local time)</TableHead>
                  <TableHead className="min-w-[140px] whitespace-nowrap">
                    Error / notes
                  </TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-sm">
                      {job.job_type || "send_campaign_batch"}
                    </TableCell>
                    <TableCell>{getStatusBadge(job.status)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDateLocal(job.scheduled_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDateLocal(job.started_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDateLocal(job.finished_at)}
                    </TableCell>
                    <TableCell
                      className="text-sm text-muted-foreground min-w-[140px] max-w-[320px] break-words align-top"
                      title={job.error_message}
                    >
                      {job.error_message || "—"}
                    </TableCell>
                    <TableCell>
                      {(job.status === "pending" || job.status === "running") && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => stopJobMutation.mutate(job.id)}
                          disabled={stopJobMutation.isPending}
                        >
                          <Square className="w-3.5 h-3.5" />
                          Stop
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
