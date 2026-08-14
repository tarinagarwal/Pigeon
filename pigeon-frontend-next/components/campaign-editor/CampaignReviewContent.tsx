"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertCircle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { Campaign, CampaignStats, CampaignStatsByTemplate, EmailTemplate } from "@/types/api";

export type SpamAnalysisResult = {
  result: {
    spamOk: boolean;
    spamWordsFound: string[];
    linkOk: boolean;
    linkMax: number;
    unsubscribeOk: boolean;
  };
  greetingOk: boolean;
  score: number;
  riskLevel: string;
  templatesOverLinkLimit?: number;
  spamWordsByTemplate: Record<string, { templateId: string; templateName: string }[]>;
};

type SendingDisplay =
  | { type: "emails"; emails: string[] }
  | { type: "inboxes"; rows: { id: string; email: string }[] };

type CampaignReviewContentProps = {
  spamAnalysis: SpamAnalysisResult;
  campaignData: {
    name: string;
    emails: { templateIds: string[]; delay: number }[];
    dailyLimit: number;
  };
  audienceVerified: number;
  audienceSelected: boolean;
  sendingDisplay: SendingDisplay;
  /** Edit flow: A/B stats and dashboard link */
  editContext?: {
    campaignId: string;
    campaign: Campaign;
    templates: EmailTemplate[];
    statsByTemplateLoading: boolean;
    statsByTemplate: CampaignStatsByTemplate | undefined;
    campaignStats?: CampaignStats | undefined;
    firstStepTemplateCount: number;
  };
};

export function CampaignReviewContent({
  spamAnalysis,
  campaignData,
  audienceVerified,
  audienceSelected,
  sendingDisplay,
  editContext,
}: CampaignReviewContentProps) {
  const hasAbTest =
    editContext != null &&
    ((editContext.campaign.template_ids?.length ?? editContext.firstStepTemplateCount) ?? 0) > 1;
  const winnerTemplateId = editContext?.campaign.ab_winner_template_id;
  const winnerTemplateName = winnerTemplateId
    ? editContext?.templates.find((t) => t.id === winnerTemplateId)?.name
    : null;
  const hasRun = (editContext?.campaignStats?.sent ?? 0) > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-6"
    >
      {editContext && hasAbTest && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">A/B performance by template</CardTitle>
            <CardDescription>
              {hasRun
                ? "Results from sends on this campaign. Changes you save apply to future sends."
                : "Compare open, click, and reply rates per template variant after you start sending."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {winnerTemplateId && winnerTemplateName && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                <p className="font-medium text-primary">Winner auto-selected: {winnerTemplateName}</p>
                <p className="text-muted-foreground mt-0.5">Remaining contacts will receive this template only.</p>
              </div>
            )}
            {editContext.statsByTemplateLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : editContext.statsByTemplate?.byTemplate?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium">Template</th>
                      <th className="text-right py-2 font-medium">Sent</th>
                      <th className="text-right py-2 font-medium">Open %</th>
                      <th className="text-right py-2 font-medium">Click %</th>
                      <th className="text-right py-2 font-medium">Reply %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editContext.statsByTemplate.byTemplate.map((row) => (
                      <tr key={row.templateId} className="border-b last:border-0">
                        <td className="py-2 font-medium">{row.templateName}</td>
                        <td className="text-right py-2">{row.sent}</td>
                        <td className="text-right py-2">{row.openRate}%</td>
                        <td className="text-right py-2">{row.clickRate}%</td>
                        <td className="text-right py-2">{row.replyRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Send emails to see performance by template.</p>
            )}
            <p className="text-xs text-muted-foreground">
              For full charts and placement tests, open{" "}
              <Link
                href={`/campaigns/${editContext.campaignId}`}
                className="text-primary font-medium underline-offset-4 hover:underline"
              >
                campaign analytics
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spam Score Analysis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Progress value={Math.round((10 - spamAnalysis.score) * 10)} className="h-3" />
            </div>
            <Badge
              className={
                spamAnalysis.riskLevel === "Low"
                  ? "bg-success"
                  : spamAnalysis.riskLevel === "Medium"
                    ? "bg-amber-500/90 text-white"
                    : "bg-destructive"
              }
            >
              {spamAnalysis.riskLevel} Risk: {spamAnalysis.score.toFixed(1)}/10
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div className={`flex items-center gap-2 ${spamAnalysis.result.spamOk ? "text-success" : "text-destructive"}`}>
              {spamAnalysis.result.spamOk ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>
                {spamAnalysis.result.spamOk
                  ? "No spam trigger words detected"
                  : `Spam words found: ${spamAnalysis.result.spamWordsFound.join(", ") || "check Settings → Compliance"}`}
              </span>
              {!spamAnalysis.result.spamOk &&
                spamAnalysis.spamWordsByTemplate &&
                Object.keys(spamAnalysis.spamWordsByTemplate).length > 0 && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {Object.entries(spamAnalysis.spamWordsByTemplate).map(([word, templatesForWord]) => (
                      <div key={word}>
                        <span className="font-medium">{word}:</span>{" "}
                        {templatesForWord.map((t) => t.templateName).join(", ")}
                      </div>
                    ))}
                  </div>
                )}
            </div>
            <div className={`flex items-center gap-2 ${spamAnalysis.result.linkOk ? "text-success" : "text-destructive"}`}>
              {spamAnalysis.result.linkOk ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {spamAnalysis.result.linkOk
                ? "Link count within safe limits (max 3 per email)"
                : `${spamAnalysis.templatesOverLinkLimit ?? 0} email(s) have too many links (max ${spamAnalysis.result.linkMax} per email)`}
            </div>
            <div className={`flex items-center gap-2 ${spamAnalysis.greetingOk ? "text-success" : "text-destructive"}`}>
              {spamAnalysis.greetingOk ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {spamAnalysis.greetingOk
                ? "Proper greeting and signature present"
                : "Add a greeting (e.g. Hi, Hello) and sign-off (e.g. Best, Regards) to reduce spam risk"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Campaign Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Campaign Name</span>
            <span className="font-medium text-right">{campaignData.name || "Not set"}</span>
          </div>
          <div className="flex justify-between gap-4 items-start">
            <span className="text-muted-foreground shrink-0">Sending Inbox</span>
            <div className="font-medium text-right flex flex-wrap gap-1.5 justify-end">
              {sendingDisplay.type === "emails" ? (
                sendingDisplay.emails.length === 0 ? (
                  <span className="text-muted-foreground">Not selected</span>
                ) : (
                  sendingDisplay.emails.map((email) => (
                    <span key={email} className="inline-block px-2 py-0.5 rounded-md bg-muted text-sm">
                      {email}
                    </span>
                  ))
                )
              ) : sendingDisplay.rows.length === 0 ? (
                <span className="text-muted-foreground">Not selected</span>
              ) : (
                sendingDisplay.rows.map((inbox) => (
                  <span key={inbox.id} className="inline-block px-2 py-0.5 rounded-md bg-muted text-sm">
                    {inbox.email}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Contacts</span>
            <span className="font-medium text-right">
              {audienceSelected ? `${audienceVerified.toLocaleString()} verified` : "Not selected"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Email Sequence</span>
            <span className="font-medium text-right">{campaignData.emails.length} emails</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground shrink-0">Daily Limit</span>
            <span className="font-medium text-right">{campaignData.dailyLimit} emails/day</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-warning/50 bg-warning/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Warmup Recommendation</p>
              <p className="text-sm text-muted-foreground">
                Consider starting with a lower daily limit (25-30) for the first week to maintain inbox health
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
