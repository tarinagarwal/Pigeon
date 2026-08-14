"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, RefreshCw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type {
  CampaignDeliverabilityRun,
  DeliverabilityClassification,
  DeliverabilityTestResultPayload,
} from "@/types/api";

function formatReceiverProvider(provider: string | undefined): string {
  const p = (provider || "").trim().toLowerCase();
  if (!p) return "—";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function placementLabel(c: DeliverabilityClassification): string {
  switch (c) {
    case "inbox":
      return "Inbox";
    case "spam":
      return "Spam";
    case "unknown":
      return "Could not determine";
    case "error":
      return "Error";
    default:
      return c;
  }
}

function PlacementBadge({ classification }: { classification: DeliverabilityClassification }) {
  const label = placementLabel(classification);
  const className =
    classification === "inbox"
      ? "border-green-600/40 bg-green-500/10 text-green-800 dark:text-green-300"
      : classification === "spam"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : classification === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-muted-foreground/30 bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

type GroupedDomainRow = {
  root_label: string;
  providers: Map<string, DeliverabilityClassification>;
};

/** One row per sending domain; Gmail / Outlook (and other providers) merged for readability. */
function groupResultsByDomain(result: DeliverabilityTestResultPayload | null | undefined): GroupedDomainRow[] {
  if (!result?.results?.length) return [];
  const byDomain = new Map<string, Map<string, DeliverabilityClassification>>();
  for (const row of result.results) {
    const domain = (row.root_label || "").trim() || "—";
    const p = (row.receiver_provider || "").trim().toLowerCase() || "other";
    if (!byDomain.has(domain)) {
      byDomain.set(domain, new Map());
    }
    byDomain.get(domain)!.set(p, row.classification);
  }
  return Array.from(byDomain.entries())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([root_label, providers]) => ({ root_label, providers }));
}

function PlacementCell({ classification }: { classification: DeliverabilityClassification | undefined }) {
  if (classification === undefined) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  return <PlacementBadge classification={classification} />;
}

function otherProvidersList(providers: Map<string, DeliverabilityClassification>) {
  const others = [...providers.entries()].filter(([k]) => k !== "gmail" && k !== "outlook");
  if (others.length === 0) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  return (
    <div className="flex flex-col gap-1.5 items-start">
      {others.map(([key, cls]) => (
        <div key={key} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{formatReceiverProvider(key)}</span>
          <PlacementBadge classification={cls} />
        </div>
      ))}
    </div>
  );
}

function runStatusBadge(status: CampaignDeliverabilityRun["status"]) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-success text-success-foreground border-success hover:bg-success">Completed</Badge>
      );
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "running":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Running
        </Badge>
      );
    case "queued":
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Queued
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatWhen(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

type CampaignPlacementTabProps = {
  campaignId: string;
  campaignName?: string;
};

export function CampaignPlacementTab({ campaignId, campaignName }: CampaignPlacementTabProps) {
  const queryClient = useQueryClient();
  const [detailRun, setDetailRun] = useState<CampaignDeliverabilityRun | null>(null);

  const runsQuery = useQuery({
    queryKey: ["deliverability-runs", campaignId],
    queryFn: () => api.campaigns.listDeliverabilityRuns(campaignId),
    enabled: !!campaignId,
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      const active = runs.some((r) => r.status === "queued" || r.status === "running");
      return active ? 2500 : false;
    },
  });

  const startMutation = useMutation({
    mutationFn: () => api.campaigns.startDeliverabilityTest(campaignId),
    onSuccess: () => {
      toast.success("Placement test started. Results will appear in the table when ready.");
      void queryClient.invalidateQueries({ queryKey: ["deliverability-runs", campaignId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not start placement test");
    },
  });

  const runs = runsQuery.data?.runs ?? [];
  const hasActive = useMemo(
    () => runs.some((r) => r.status === "queued" || r.status === "running"),
    [runs],
  );

  const groupedPlacementRows = useMemo(
    () => groupResultsByDomain(detailRun?.result ?? null),
    [detailRun?.result],
  );
  const showPlacementOtherColumn = useMemo(
    () =>
      groupedPlacementRows.some((g) =>
        [...g.providers.keys()].some((k) => k !== "gmail" && k !== "outlook"),
      ),
    [groupedPlacementRows],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 max-w-2xl">
          <p className="text-sm text-muted-foreground">
            {campaignName ? (
              <>
                Probe how messages from <span className="text-foreground font-medium">{campaignName}</span> land in
                our test inboxes (Gmail / Outlook). Tests run in the background; this tab refreshes while a run is
                active.
              </>
            ) : (
              "Probe inbox vs spam placement using internal test accounts. Tests run in the background."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runsQuery.refetch()}
            disabled={runsQuery.isFetching}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${runsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            className="gradient-primary"
            onClick={() => startMutation.mutate()}
            disabled={!campaignId || startMutation.isPending || hasActive}
          >
            {startMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 mr-2" />
                Run placement test
              </>
            )}
          </Button>
        </div>
      </div>

      {hasActive && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
          A test is in progress. Updating automatically every few seconds.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>
            Indicative only — not a guarantee of placement for every recipient.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : runsQuery.isError ? (
            <p className="text-sm text-destructive">Failed to load history. Use Refresh to try again.</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No tests yet. Click &quot;Run placement test&quot; to queue one.
            </p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Summary</TableHead>
                    <TableHead className="text-right w-[100px]">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const s = run.result?.summary;
                    const summaryText =
                      run.status === "completed" && s
                        ? `Inbox ${s.inbox} · Spam ${s.spam} · ? ${s.unknown}`
                        : run.status === "failed"
                          ? (run.error || "Failed")
                          : "—";
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="whitespace-nowrap text-sm">{formatWhen(run.created_at)}</TableCell>
                        <TableCell>{runStatusBadge(run.status)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground max-w-[280px] truncate">
                          {summaryText}
                        </TableCell>
                        <TableCell className="text-right">
                          {run.status === "completed" && run.result ? (
                            <Button type="button" variant="ghost" size="sm" onClick={() => setDetailRun(run)}>
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailRun} onOpenChange={(open) => !open && setDetailRun(null)}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Placement details</DialogTitle>
            <DialogDescription>
              {detailRun && formatWhen(detailRun.completed_at || detailRun.created_at)}
            </DialogDescription>
          </DialogHeader>
          {detailRun?.result && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary" className="tabular-nums">
                  Tests: {detailRun.result.summary.checked}
                </Badge>
                <Badge
                  variant="outline"
                  className="tabular-nums border-green-600/40 text-green-800 dark:text-green-300"
                >
                  Inbox: {detailRun.result.summary.inbox}
                </Badge>
                <Badge variant="outline" className="tabular-nums border-destructive/40 text-destructive">
                  Spam: {detailRun.result.summary.spam}
                </Badge>
                <Badge variant="outline" className="tabular-nums text-muted-foreground">
                  Unknown: {detailRun.result.summary.unknown}
                </Badge>
                <Badge variant="outline" className="tabular-nums text-destructive">
                  Error: {detailRun.result.summary.error}
                </Badge>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[180px]">From (domain)</TableHead>
                      <TableHead className="text-center w-[130px]">Gmail</TableHead>
                      <TableHead className="text-center w-[130px]">Outlook</TableHead>
                      {showPlacementOtherColumn ? (
                        <TableHead className="min-w-[140px]">Other</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedPlacementRows.map((row) => (
                      <TableRow key={row.root_label}>
                        <TableCell className="font-medium align-top">{row.root_label}</TableCell>
                        <TableCell className="text-center align-middle">
                          <div className="flex justify-center">
                            <PlacementCell classification={row.providers.get("gmail")} />
                          </div>
                        </TableCell>
                        <TableCell className="text-center align-middle">
                          <div className="flex justify-center">
                            <PlacementCell classification={row.providers.get("outlook")} />
                          </div>
                        </TableCell>
                        {showPlacementOtherColumn ? (
                          <TableCell className="align-top text-left">{otherProvidersList(row.providers)}</TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDetailRun(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
