"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Users,
  ArrowLeft,
  Search,
  Mail,
  MousePointerClick,
  MessageSquare,
  AlertCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCampaignContacts, useCampaign } from "@/hooks/useCampaigns";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { EmailHtmlViewer } from "@/components/EmailHtmlViewer";

function getSequenceProgress(
  events: { type: string; timestamp?: string; metadata?: Record<string, any> }[] | undefined,
  totalSequenceSteps: number,
) {
  if (!totalSequenceSteps || !events?.length) {
    return { stepsCompleted: 0, progressPercent: 0 };
  }

  const sentEvents = events.filter((e) => e.type === "sent");
  if (!sentEvents.length) {
    return { stepsCompleted: 0, progressPercent: 0 };
  }

  const uniqueKeys = new Set<string | number>();

  for (const event of sentEvents) {
    const meta = event.metadata || {};
    const sequenceStep = typeof meta.sequence_step === "number" ? meta.sequence_step : undefined;
    if (sequenceStep && Number.isFinite(sequenceStep) && sequenceStep > 0) {
      uniqueKeys.add(sequenceStep);
      continue;
    }

    if (meta.template_id && typeof meta.template_id === "string") {
      uniqueKeys.add(`tpl:${meta.template_id}`);
      continue;
    }

    if (event.timestamp) {
      try {
        const key = new Date(event.timestamp).toISOString().slice(0, 16);
        uniqueKeys.add(key);
        continue;
      } catch {
        // ignore parse error and fall through
      }
    }

    // Fallback: ensure at least one key so we count progress
    uniqueKeys.add("fallback");
  }

  const stepsCompleted = Math.min(uniqueKeys.size || 0, totalSequenceSteps);
  const progressPercent =
    totalSequenceSteps > 0 ? (stepsCompleted / totalSequenceSteps) * 100 : 0;

  return { stepsCompleted, progressPercent };
}

function getSequenceStepLabel(stepIndex: number): string {
  if (stepIndex <= 1) return "Initial email";
  return `Follow-up ${stepIndex - 1}`;
}

export default function CampaignContactsPage() {
  const params = useParams();
  const campaignId = typeof params.id === "string" ? params.id : "";
  const { data: campaign, isLoading: campaignLoading } = useCampaign(campaignId);
  const { data: contacts = [], isLoading } = useCampaignContacts(campaignId);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [replyPreview, setReplyPreview] = useState<string | null>(null);

  const totalSequenceSteps = useMemo(() => {
    if (!campaign) return 0;
    if (campaign.email_sequence && campaign.email_sequence.length > 0) {
      const byDelay = new Set<number>();
      for (const step of campaign.email_sequence) {
        const delay = step.delay_days ?? 0;
        byDelay.add(delay);
      }
      return byDelay.size || 0;
    }
    if (campaign.template_ids && campaign.template_ids.length > 0) {
      // Fallback: templates without explicit sequence means a single-step campaign
      return 1;
    }
    return 0;
  }, [campaign]);

  const filteredContacts = useMemo(() => {
    const filtered = contacts.filter((cc) => {
      const matchesSearch =
        cc.contact_details?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cc.contact_details?.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cc.contact_details?.last_name?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || cc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
    return [...filtered].sort((a, b) => {
      const aTime = a.last_activity ? new Date(a.last_activity).getTime() : 0;
      const bTime = b.last_activity ? new Date(b.last_activity).getTime() : 0;
      return bTime - aTime;
    });
  }, [contacts, searchQuery, statusFilter]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return <Badge className="bg-primary hover:bg-primary">Sent</Badge>;
      case "opened":
        return <Badge className="bg-success hover:bg-success">Opened</Badge>;
      case "clicked":
        return <Badge className="bg-primary hover:bg-primary">Clicked</Badge>;
      case "replied":
        return <Badge className="bg-primary hover:bg-primary">Replied</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case "sent":
        return <Mail className="w-4 h-4 text-primary" />;
      case "opened":
        return <MousePointerClick className="w-4 h-4 text-green-500" />;
      case "clicked":
        return <ExternalLink className="w-4 h-4 text-primary" />;
      case "replied":
        return <MessageSquare className="w-4 h-4 text-primary" />;
      case "failed":
        return <AlertCircle className="w-4 h-4 text-destructive" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/campaigns">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Campaign Contacts</h1>
            <div className="text-muted-foreground">
              {campaignLoading ? (
                <Skeleton className="h-4 w-64 mt-1" />
              ) : (
                <p>
                  {campaign?.name
                    ? `Tracking engagement for "${campaign.name}"`
                    : "Campaign engagement tracking"}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search contacts..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={statusFilter === "all" ? "default" : "outline"}
                onClick={() => setStatusFilter("all")}
                size="sm"
              >
                All
              </Button>
              <Button
                variant={statusFilter === "sent" ? "default" : "outline"}
                onClick={() => setStatusFilter("sent")}
                size="sm"
              >
                Sent
              </Button>
              <Button
                variant={statusFilter === "opened" ? "default" : "outline"}
                onClick={() => setStatusFilter("opened")}
                size="sm"
              >
                Opened
              </Button>
              <Button
                variant={statusFilter === "clicked" ? "default" : "outline"}
                onClick={() => setStatusFilter("clicked")}
                size="sm"
              >
                Clicked
              </Button>
              <Button
                variant={statusFilter === "replied" ? "default" : "outline"}
                onClick={() => setStatusFilter("replied")}
                size="sm"
              >
                Replied
              </Button>
              <Button
                variant={statusFilter === "failed" ? "default" : "outline"}
                onClick={() => setStatusFilter("failed")}
                size="sm"
              >
                Failed
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <Users className="w-5 h-5" />
            Contacts ({filteredContacts.length})
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Sequence:{" "}
            {totalSequenceSteps > 0
              ? `${totalSequenceSteps} step${totalSequenceSteps === 1 ? "" : "s"} per contact`
              : "no sequence configured for this campaign"}
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Sequence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Clicks</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="text-right">Timeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-5 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-24 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredContacts.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No contacts found matching your criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredContacts.map((cc) => (
                  <TableRow key={cc.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {cc.contact_details?.first_name}{" "}
                          {cc.contact_details?.last_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {cc.contact_details?.email}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {cc.contact_details?.company ?? "N/A"}
                    </TableCell>
                    <TableCell>
                      {totalSequenceSteps > 0 ? (
                        <div className="space-y-1 min-w-[140px]">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                              Step{" "}
                              {
                                getSequenceProgress(
                                  cc.events as any,
                                  totalSequenceSteps,
                                ).stepsCompleted
                              }
                              {" of "}
                              {totalSequenceSteps}
                            </span>
                          </div>
                          <Progress
                            value={
                              getSequenceProgress(
                                cc.events as any,
                                totalSequenceSteps,
                              ).progressPercent
                            }
                            className="w-full h-1.5"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(cc.status)}</TableCell>
                    <TableCell className="text-center">
                      <span
                        className="inline-flex items-center justify-center rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums"
                        title="Link clicks in this campaign"
                      >
                        {cc.click_count ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {cc.last_activity
                        ? new Date(cc.last_activity).toLocaleString()
                        : "No activity"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            View History
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-md">
                          <DialogHeader>
                            <DialogTitle>Engagement History</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 mt-4">
                            {cc.events && cc.events.length > 0 ? (
                              cc.events
                                .sort(
                                  (a, b) =>
                                    new Date(b.timestamp).getTime() -
                                    new Date(a.timestamp).getTime()
                                )
                                .map((event, idx) => (
                                  <div
                                    key={idx}
                                    className="flex gap-3 items-start border-l-2 border-muted pl-4 relative"
                                  >
                                    <div className="absolute -left-[9px] top-1 bg-background p-0.5 rounded-full border border-muted">
                                      {getEventIcon(event.type)}
                                    </div>
                                    <div className="flex-1">
                                      <p className="text-sm font-medium capitalize">
                                        {event.type}
                                      </p>
                                      {event.metadata?.sequence_step != null &&
                                        typeof event.metadata.sequence_step === "number" && (
                                          <p className="text-xs text-muted-foreground">
                                            {getSequenceStepLabel(event.metadata.sequence_step)}
                                          </p>
                                        )}
                                      <p className="text-xs text-muted-foreground">
                                        {new Date(
                                          event.timestamp
                                        ).toLocaleString()}
                                      </p>
                                      {event.metadata?.url && (
                                        <p className="text-xs text-primary mt-1 truncate max-w-[250px]">
                                          {String(event.metadata.url)}
                                        </p>
                                      )}
                                      {event.metadata?.reply_body && (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="mt-2 h-7 px-2 text-xs"
                                          onClick={() =>
                                            setReplyPreview(String(event.metadata?.reply_body))
                                          }
                                        >
                                          View reply
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ))
                            ) : (
                              <p className="text-center py-4 text-muted-foreground">
                                No history available
                              </p>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Note: Contact tracking is real-time and separate for each campaign.
      </p>

      <Dialog
        open={!!replyPreview}
        onOpenChange={(open) => {
          if (!open) {
            setReplyPreview(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Reply preview</DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            {replyPreview && <EmailHtmlViewer html={replyPreview} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
