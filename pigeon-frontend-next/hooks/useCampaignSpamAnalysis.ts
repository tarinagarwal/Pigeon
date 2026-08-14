"use client";

import { useMemo } from "react";
import {
  runComplianceCheck,
  hasGreetingAndSignature,
  type ComplianceSettings,
} from "@/lib/compliance";
import type { CampaignEmailStep } from "@/lib/campaign-editor/types";
import type { EmailTemplate } from "@/types/api";

export function useCampaignSpamAnalysis(
  emails: CampaignEmailStep[],
  templates: EmailTemplate[],
  compliance: ComplianceSettings | undefined
) {
  return useMemo(() => {
    let combinedContent = "";
    let combinedBody = "";
    const templateChecks: {
      templateId: string;
      templateName: string;
      check: ReturnType<typeof runComplianceCheck>;
    }[] = [];

    for (const step of emails) {
      const ids = step.templateIds ?? [];
      for (const tid of ids) {
        if (!tid) continue;
        const t = templates.find((x) => x.id === tid);
        if (t) {
          const subject = t.subject ?? "";
          const body = t.body ?? "";
          const content = `${subject} ${body}`;
          combinedContent += " " + content;
          combinedBody += " " + body;
          const check = runComplianceCheck(content, compliance);
          templateChecks.push({
            templateId: t.id,
            templateName: (t.name ?? subject) || "Untitled template",
            check,
          });
        }
      }
    }

    const result = runComplianceCheck(combinedContent, compliance);
    const linkOk = templateChecks.length === 0 || templateChecks.every((r) => r.check.linkOk);
    const templatesOverLinkLimit = templateChecks.filter((r) => !r.check.linkOk).length;

    const spamWordsByTemplate: Record<string, { templateId: string; templateName: string }[]> = {};
    for (const tc of templateChecks) {
      for (const word of tc.check.spamWordsFound) {
        if (!spamWordsByTemplate[word]) {
          spamWordsByTemplate[word] = [];
        }
        if (!spamWordsByTemplate[word].some((t) => t.templateId === tc.templateId)) {
          spamWordsByTemplate[word].push({
            templateId: tc.templateId,
            templateName: tc.templateName,
          });
        }
      }
    }

    const resultWithPerEmailLinks = {
      ...result,
      linkOk,
      linkCount: result.linkCount,
    };
    const greetingOk = hasGreetingAndSignature(combinedBody);
    let score = 0;
    if (!result.spamOk) score += 3;
    if (!resultWithPerEmailLinks.linkOk) score += 2;
    if (!result.unsubscribeOk) score += 2;
    if (!greetingOk) score += 1.5;
    score = Math.min(10, Math.round(score * 10) / 10);
    const riskLevel = score <= 2 ? "Low" : score <= 5 ? "Medium" : "High";
    return {
      result: resultWithPerEmailLinks,
      greetingOk,
      score,
      riskLevel,
      templatesOverLinkLimit,
      spamWordsByTemplate,
    };
  }, [emails, templates, compliance]);
}
