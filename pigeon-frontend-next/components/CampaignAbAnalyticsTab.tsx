 "use client";

import { useMemo } from "react";
import {
  Mail,
  BarChart3,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCampaign,
  useCampaignStats,
  useCampaignStatsByTemplate,
} from "@/hooks/useCampaigns";
import { useTemplates } from "@/hooks/useTemplates";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type SequenceStep = {
  stepIndex: number;
  label: string;
  delayDays: number;
  variants: {
    templateId: string;
    templateName: string;
    variantLabel: string;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
  }[];
};

const AB_REEVAL_HOURS = 24;

interface CampaignAbAnalyticsTabProps {
  campaignId: string;
}

export function CampaignAbAnalyticsTab({ campaignId }: CampaignAbAnalyticsTabProps) {
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;

  const {
    data: campaign,
    isLoading: campaignLoading,
    isError: campaignError,
  } = useCampaign(campaignId);
  const { data: summaryStats, isLoading: summaryLoading } = useCampaignStats(
    campaignId,
  );
  const {
    data: statsByTemplate,
    isLoading: statsByTemplateLoading,
  } = useCampaignStatsByTemplate(campaignId);
  const {
    data: templates = [],
    isLoading: templatesLoading,
  } = useTemplates(userId);

  const loading = campaignLoading || summaryLoading || templatesLoading;

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of templates) {
      map.set(t.id, t.name);
    }
    return map;
  }, [templates]);

  const sequenceSteps: SequenceStep[] = useMemo(() => {
    if (!campaign) return [];

    const rawSequence =
      (campaign.email_sequence && campaign.email_sequence.length > 0
        ? campaign.email_sequence
        : (campaign.template_ids || []).map((tid, index) => ({
            template_id: tid,
            delay_days: index === 0 ? 0 : index * 2,
          }))) || [];

    if (!rawSequence.length) return [];

    const byDelay = new Map<number, string[]>();
    for (const step of rawSequence) {
      const delay = step.delay_days ?? 0;
      if (!byDelay.has(delay)) byDelay.set(delay, []);
      byDelay.get(delay)!.push(step.template_id);
    }

    const delays = Array.from(byDelay.keys()).sort((a, b) => a - b);

    const statsMap = new Map<
      string,
      {
        sent: number;
        opened: number;
        clicked: number;
        replied: number;
        openRate: number;
        clickRate: number;
        replyRate: number;
        templateName: string;
      }
    >();

    for (const row of statsByTemplate?.byTemplate ?? []) {
      statsMap.set(row.templateId, {
        sent: row.sent,
        opened: row.opened,
        clicked: row.clicked,
        replied: row.replied,
        openRate: row.openRate,
        clickRate: row.clickRate,
        replyRate: row.replyRate,
        templateName: row.templateName,
      });
    }

    return delays.map((delay, index) => {
      const templateIds = byDelay.get(delay) ?? [];
      const variants = templateIds.map((tid, variantIndex) => {
        const stats = statsMap.get(tid);
        const templateName =
          stats?.templateName || templateNameMap.get(tid) || tid;

        return {
          templateId: tid,
          templateName,
          variantLabel: String.fromCharCode(65 + variantIndex),
          sent: stats?.sent ?? 0,
          opened: stats?.opened ?? 0,
          clicked: stats?.clicked ?? 0,
          replied: stats?.replied ?? 0,
          openRate: stats?.openRate ?? 0,
          clickRate: stats?.clickRate ?? 0,
          replyRate: stats?.replyRate ?? 0,
        };
      });

      const label = index === 0 ? "Initial email" : `Follow-up ${index}`;

      return {
        stepIndex: index,
        label,
        delayDays: delay,
        variants,
      };
    });
  }, [campaign, statsByTemplate, templateNameMap]);

  if (campaignError) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            There was an error loading this campaign.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !campaign) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-6 w-48 mb-4" />
            <Skeleton className="h-40 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const overallSent = summaryStats?.sent ?? 0;
  const overallOpenRate = summaryStats?.openRate ?? 0;
  const overallClickRate = summaryStats?.clickRate ?? 0;
  const overallReplyRate = summaryStats?.replyRate ?? 0;

  const winnerTemplateId = campaign.ab_winner_template_id || null;
  const winnerSetAt = campaign.ab_winner_set_at || null;

  const allVariants = sequenceSteps.flatMap((step) => step.variants);
  const winnerVariantFromSequence = winnerTemplateId
    ? allVariants.find((v) => v.templateId === winnerTemplateId) || null
    : null;

  const winnerTemplateFromList = winnerTemplateId
    ? templates.find((t) => t.id === winnerTemplateId) || null
    : null;

  const winnerTemplateName =
    winnerVariantFromSequence?.templateName ||
    winnerTemplateFromList?.name ||
    (winnerTemplateId || "");

  const winnerVariantLabel = winnerVariantFromSequence?.variantLabel || null;

  const totalRepliedGlobal =
    statsByTemplate?.byTemplate?.reduce(
      (sum, row) => sum + (row.replied ?? 0),
      0,
    ) ?? 0;
  const hasRepliesGlobal = totalRepliedGlobal > 0;
  const replyWeight = hasRepliesGlobal ? 0.4 : 0.0;
  const openWeight = hasRepliesGlobal ? 0.3 : 0.5;
  const clickWeight = hasRepliesGlobal ? 0.3 : 0.5;

  let abStatusMessage: string | null = null;
  if (winnerTemplateId && winnerTemplateName) {
    let hoursRemaining: number | null = null;
    if (winnerSetAt) {
      const setAtDate = new Date(winnerSetAt);
      const diffMs = Date.now() - setAtDate.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      hoursRemaining = Math.max(0, AB_REEVAL_HOURS - diffHours);
    }

    const nextText =
      hoursRemaining !== null && hoursRemaining > 0
        ? `Next re-evaluation in ~${Math.ceil(hoursRemaining)}h.`
        : "Eligible for re-evaluation now based on performance.";

    const variantPart = winnerVariantLabel
      ? `Variant ${winnerVariantLabel}`
      : "the winner template";

    abStatusMessage = `Algorithm is currently sending only ${variantPart} (“${winnerTemplateName}”) to remaining contacts, based on a weighted score that favors replies and then opens. ${nextText}`;
  } else if (allVariants.length > 1) {
    abStatusMessage =
      "Algorithm is still testing all variants evenly. It will automatically pick a winner after enough sends per variant and about 24 hours of data.";
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Campaign A/B Analytics</h2>
        <p className="text-sm text-muted-foreground">
          Performance for &quot;{campaign.name}&quot; by sequence step and template
          variation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4" />
            Overall performance
          </CardTitle>
          <CardDescription>
            How this campaign is performing across all templates and steps.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Sent
            </p>
            <p className="text-2xl font-semibold">
              {overallSent.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Open rate
            </p>
            <p className="text-2xl font-semibold">
              {overallOpenRate.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Click rate
            </p>
            <p className="text-2xl font-semibold">
              {(overallClickRate ?? 0).toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Reply rate
            </p>
            <p className="text-2xl font-semibold">
              {overallReplyRate.toFixed(1)}%
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4" />
            A/B performance by sequence
          </CardTitle>
          <CardDescription>
            See how each step and template variation performed within this campaign.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {abStatusMessage && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              {abStatusMessage}
            </div>
          )}
          {statsByTemplateLoading && (
            <p className="text-sm text-muted-foreground">Loading A/B stats…</p>
          )}

          {!statsByTemplateLoading && sequenceSteps.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This campaign doesn&apos;t have an email sequence configured yet.
            </p>
          )}

          {sequenceSteps.map((step) => {
            const hasVariants = step.variants.length > 1;

            const winningVariant =
              hasVariants && step.variants.length > 0
                ? step.variants.reduce<{
                    variant: (typeof step.variants)[number];
                    score: number;
                  } | null>((best, current) => {
                    const score =
                      replyWeight * current.replyRate +
                      openWeight * current.openRate +
                      clickWeight * current.clickRate;
                    if (!best || score > best.score) {
                      return { variant: current, score };
                    }
                    return best;
                  }, null)
                : null;

            return (
              <div key={step.stepIndex} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {step.label}{" "}
                      {step.delayDays > 0 && (
                        <span className="text-xs text-muted-foreground">
                          · Sent after {step.delayDays} day
                          {step.delayDays === 1 ? "" : "s"}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {hasVariants
                        ? `${step.variants.length} variants`
                        : "Single template (no A/B variants)"}
                    </p>
                  </div>
                  {hasVariants && winningVariant && (
                    <div className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-success" />
                        <span className="font-medium text-foreground">
                          Winning template
                        </span>
                      </span>
                      <span>
                        Variant {winningVariant.variant.variantLabel} (
                        {winningVariant.variant.templateName})
                      </span>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">Variant</TableHead>
                        <TableHead>Template</TableHead>
                        <TableHead className="text-right">Sent</TableHead>
                        <TableHead className="text-right">Open %</TableHead>
                        <TableHead className="text-right">Click %</TableHead>
                        <TableHead className="text-right">Reply %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {step.variants.map((variant) => {
                        const isWinner = winnerTemplateId === variant.templateId;

                        return (
                          <TableRow key={variant.templateId}>
                            <TableCell className="font-medium">
                              Variant {variant.variantLabel}
                              {isWinner && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge
                                    variant="outline"
                                    className="border-primary/40 text-primary"
                                  >
                                    Winner
                                  </Badge>
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="max-w-xs">
                              <p className="text-sm font-medium truncate">
                                {variant.templateName}
                              </p>
                            </TableCell>
                            <TableCell className="text-right">
                              {variant.sent.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              {variant.openRate.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right">
                              {variant.clickRate.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right">
                              {variant.replyRate.toFixed(1)}%
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}

          {!statsByTemplateLoading &&
            statsByTemplate &&
            statsByTemplate.byTemplate.length === 0 && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertCircle className="w-4 h-4 mt-0.5 text-amber-500" />
                <p>
                  This campaign hasn&apos;t sent any emails yet. Once it starts
                  sending, you&apos;ll see per-template performance here.
                </p>
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

