"use client";

import { useEffect, useMemo } from "react";
import { useDomains } from "@/hooks/useDomains";
import { useInboxes } from "@/hooks/useInboxes";
import { useContacts } from "@/hooks/useContacts";
import { useTemplates } from "@/hooks/useTemplates";
import { useCampaigns } from "@/hooks/useCampaigns";
import { trackEvent } from "@/lib/analytics-events";

export type SetupStep = {
  id: "domain" | "inbox" | "contacts" | "template" | "campaign";
  label: string;
  href: string;
  completed: boolean;
  hint: string;
};

export function useActivationProgress(userId: string) {
  const { data: domains = [], isLoading: domainsLoading } = useDomains();
  const { data: inboxes = [], isLoading: inboxesLoading } = useInboxes(userId);
  const { data: contactsData, isLoading: contactsLoading } = useContacts(userId, 0, 1);
  const { data: templates = [], isLoading: templatesLoading } = useTemplates(userId);
  const { data: campaigns = [], isLoading: campaignsLoading } = useCampaigns(userId, { archived: false });

  const contactsCount = contactsData?.total ?? 0;

  const steps = useMemo<SetupStep[]>(
    () => [
      {
        id: "domain",
        label: "Add and verify a domain",
        href: "/domains",
        completed: domains.length > 0,
        hint: "Connect your sending domain first.",
      },
      {
        id: "inbox",
        label: "Connect an inbox",
        href: "/inboxes/new",
        completed: inboxes.length > 0,
        hint: "Add Gmail or SMTP to send campaigns.",
      },
      {
        id: "contacts",
        label: "Import contacts",
        href: "/contacts/import",
        completed: contactsCount > 0,
        hint: "Upload your first list in CSV/Excel.",
      },
      {
        id: "template",
        label: "Create a template",
        href: "/templates/new",
        completed: templates.length > 0,
        hint: "Write the first email in your sequence.",
      },
      {
        id: "campaign",
        label: "Create a campaign",
        href: "/campaigns/new",
        completed: campaigns.length > 0,
        hint: "Launch your first outreach flow.",
      },
    ],
    [domains.length, inboxes.length, contactsCount, templates.length, campaigns.length]
  );

  const completedCount = steps.filter((step) => step.completed).length;
  const percent = Math.round((completedCount / steps.length) * 100);
  const nextStep = steps.find((step) => !step.completed) ?? null;
  const isComplete = completedCount === steps.length;

  const isLoading =
    domainsLoading ||
    inboxesLoading ||
    contactsLoading ||
    templatesLoading ||
    campaignsLoading;

  useEffect(() => {
    if (typeof window === "undefined" || !userId || isLoading) return;

    for (const step of steps) {
      if (!step.completed) continue;
      const key = `activation-step-complete:${userId}:${step.id}`;
      if (window.localStorage.getItem(key) === "1") continue;
      window.localStorage.setItem(key, "1");
      trackEvent("setup_step_completed", { stepId: step.id });
    }
  }, [isLoading, steps, userId]);

  return {
    steps,
    completedCount,
    totalSteps: steps.length,
    percent,
    nextStep,
    isComplete,
    isLoading,
  };
}

