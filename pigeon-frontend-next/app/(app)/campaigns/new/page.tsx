"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Users,
  Mail,
  Sparkles,
  Plus,
  Trash2,
  Clock,
  Globe,
  AlertCircle,
  Info,
  Loader2,
  Search,
} from "lucide-react";
import { useInboxes } from "@/hooks/useInboxes";
import { useDomains } from "@/hooks/useDomains";
import { useAuth } from "@/contexts/AuthContext";
import { useContactLists, useAudiencePreview } from "@/hooks/useContacts";
import { useCreateCampaign } from "@/hooks/useCampaigns";
import { useTemplates } from "@/hooks/useTemplates";
import { useSettings, useSerperSettings } from "@/hooks/useSettings";
import { useLLMConfigs } from "@/hooks/useLLM";
import { useReplyToImapConfigs } from "@/hooks/useReplyToImap";
import { useWarmupNetworkContacts, useWarmupSharedPoolState } from "@/hooks/useWarmup";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SmtpInboxMultiSelect } from "@/components/campaigns/SmtpInboxMultiSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";
import {
  CAMPAIGN_WIZARD_STEPS,
  defaultCampaignFormData,
  getRecommendedInboxesAndSpread,
  getRootDomain,
} from "@/lib/campaign-editor";
import type { CampaignFormData } from "@/lib/campaign-editor/types";
import { validateCampaignForm } from "@/lib/campaign-editor/validation";
import { CampaignStepDelivery } from "@/components/campaign-editor/CampaignStepDelivery";
import { CampaignReviewContent } from "@/components/campaign-editor/CampaignReviewContent";
import { SenderIdentityPanel } from "@/components/campaign-editor/SenderIdentityPanel";
import { useCampaignSpamAnalysis } from "@/hooks/useCampaignSpamAnalysis";
import { cn } from "@/lib/utils";

const steps = CAMPAIGN_WIZARD_STEPS;

export default function NewCampaignPage() {
  const router = useRouter();
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const isSubmittingRef = useRef(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [draftCampaignId, setDraftCampaignId] = useState<string | null>(null);
  const [campaignData, setCampaignData] = useState<CampaignFormData>(() => defaultCampaignFormData());
  const [testEmail, setTestEmail] = useState("");
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [saveDraftLoading, setSaveDraftLoading] = useState(false);
  const [replyToType, setReplyToType] = useState<"default" | "none" | "gmail" | "imap" | "custom">("none");
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [replyToEmail, setReplyToEmail] = useState<string>("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [bestSendTime, setBestSendTime] = useState<{
    best_hour: number;
    best_hour_label: string;
    open_rate: number;
    based_on_sent: number;
    message: string;
  } | null>(null);
  const [bestSendTimeFetched, setBestSendTimeFetched] = useState(false);
  /** Root domain FQDNs (e.g. pigeon.com) with ready SMTP inboxes — one or more may be selected. */
  const [smtpSelectedRootDomains, setSmtpSelectedRootDomains] = useState<string[]>([]);
  /** When false, empty domain selection is intentional (do not auto-pick a default). */
  const allowSmtpDomainAutofillRef = useRef(true);
  const autosaveInProgressRef = useRef(false);

  const { data: inboxes = [], isLoading: inboxesLoading } = useInboxes(userId);
  const { data: domains = [], isLoading: domainsLoading } = useDomains();
  const { data: contactLists = [], isLoading: contactListsLoading } = useContactLists(userId);
  const { data: templates = [], isLoading: templatesLoading } = useTemplates(userId);
  const { data: settingsData, isLoading: settingsLoading } = useSettings();
  const { data: llmConfigs = [], isLoading: llmConfigsLoading } = useLLMConfigs(userId);
  const { data: serperSettings } = useSerperSettings(true);
  const { data: replyToImapConfigs = [] } = useReplyToImapConfigs();
  const formDataLoading = inboxesLoading || contactListsLoading || templatesLoading || settingsLoading || llmConfigsLoading || domainsLoading;
  const createCampaign = useCreateCampaign();
  const campaignGate = usePlanGate("campaigns");
  const { data: warmupNetworkData } = useWarmupNetworkContacts(!!userId);
  const { data: sharedPoolState } = useWarmupSharedPoolState(!!userId);
  const warmupNetworkCount = warmupNetworkData?.contacts?.length ?? 0;
  const poolCreditBalance = sharedPoolState?.credits?.balance ?? 0;
  const poolCostPerSend = sharedPoolState?.credits?.cost_per_send ?? 1;
  const domainById = useMemo(() => {
    const map = new Map<string, (typeof domains)[number]>();
    domains.forEach((d) => map.set(d.id, d));
    return map;
  }, [domains]);
  const smtpInboxesWithRoot = useMemo(
    () =>
      inboxes
        .filter((i) => i.sender_type === "smtp" && i.status === "ready")
        .map((inbox) => {
          const domainName = inbox.domain_id ? domainById.get(inbox.domain_id)?.domain : undefined;
          return {
            ...inbox,
            rootDomain: domainName ? getRootDomain(domainName) : "",
          };
        })
        .filter((inbox) => !!inbox.rootDomain),
    [inboxes, domainById]
  );
  const smtpRootDomainOptions = useMemo(() => {
    const rootInboxCount = new Map<string, number>();
    smtpInboxesWithRoot.forEach((inbox) => {
      rootInboxCount.set(inbox.rootDomain, (rootInboxCount.get(inbox.rootDomain) ?? 0) + 1);
    });

    const connectedRoots = new Set<string>();
    domains.forEach((domain) => {
      const root = getRootDomain(domain.domain);
      if (root) connectedRoots.add(root);
    });

    return Array.from(connectedRoots)
      .sort()
      .map((rootDomain) => ({
        rootDomain,
        inboxCount: rootInboxCount.get(rootDomain) ?? 0,
        hasReadyInboxes: (rootInboxCount.get(rootDomain) ?? 0) > 0,
      }));
  }, [domains, smtpInboxesWithRoot]);
  const smtpInboxesForSelectedRoots = useMemo(
    () =>
      smtpInboxesWithRoot.filter((i) => smtpSelectedRootDomains.includes(i.rootDomain)),
    [smtpInboxesWithRoot, smtpSelectedRootDomains]
  );
  const gmailInboxes = useMemo(
    () => inboxes.filter((i) => i.sender_type === "gmail"),
    [inboxes]
  );

  const handleSenderTypeChange = (next: "gmail" | "smtp") => {
    if (next === campaignData.senderType) return;
    setCampaignData((prev) => ({
      ...prev,
      senderType: next,
      senderIds: [],
      enableRotation: next === "smtp",
      dailyLimit: prev.dailyLimitTouched ? prev.dailyLimit : 50,
    }));
    if (next === "smtp") {
      allowSmtpDomainAutofillRef.current = true;
      const firstReady = smtpRootDomainOptions.find((option) => option.hasReadyInboxes)?.rootDomain;
      setSmtpSelectedRootDomains(firstReady ? [firstReady] : []);
    } else {
      setSmtpSelectedRootDomains([]);
    }
  };

  // Get contact list data when selected
  const selectedList = contactLists.find(list => list.id === campaignData.contactList);
  const { data: audiencePreview, isLoading: audienceLoading } = useAudiencePreview(userId, campaignData.contactList || undefined);

  // Best time to send based on open rates from previous campaigns (selected timezone)
  useEffect(() => {
    if (!userId || !campaignData.timezone) return;
    let cancelled = false;
    setBestSendTimeFetched(false);
    api.analytics
      .getBestSendTime(userId, campaignData.timezone, 30)
      .then((res) => {
        if (cancelled) return;
        setBestSendTimeFetched(true);
        if (res.best_hour != null && res.best_hour_label != null) {
          setBestSendTime({
            best_hour: res.best_hour,
            best_hour_label: res.best_hour_label,
            open_rate: res.open_rate ?? 0,
            based_on_sent: res.based_on_sent ?? 0,
            message: res.message,
          });
        } else {
          setBestSendTime(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBestSendTimeFetched(true);
          setBestSendTime(null);
        }
      });
    return () => { cancelled = true; };
  }, [userId, campaignData.timezone]);

  // When defaulting to Domain (SMTP), pick the first root that has ready SMTP inboxes (until user clears all)
  useEffect(() => {
    if (campaignData.senderType !== "smtp") return;
    if (smtpSelectedRootDomains.length > 0) return;
    if (!allowSmtpDomainAutofillRef.current) return;
    const firstReady = smtpRootDomainOptions.find((option) => option.hasReadyInboxes)?.rootDomain;
    if (firstReady) setSmtpSelectedRootDomains([firstReady]);
  }, [campaignData.senderType, smtpRootDomainOptions, smtpSelectedRootDomains.length]);

  const handleSmtpRootToggle = (root: string, checked: boolean) => {
    const rootOption = smtpRootDomainOptions.find((option) => option.rootDomain === root);
    if (!rootOption?.hasReadyInboxes) return;

    setSmtpSelectedRootDomains((prevRoots) => {
      const nextRoots = checked
        ? [...new Set([...prevRoots, root])].sort()
        : prevRoots.filter((r) => r !== root);
      if (nextRoots.length === 0) {
        allowSmtpDomainAutofillRef.current = false;
      } else {
        allowSmtpDomainAutofillRef.current = true;
      }
      setCampaignData((cd) => {
        const pruned = cd.senderIds.filter((id) => {
          const inbox = inboxes.find((i) => i.id === id);
          if (!inbox?.domain_id) return false;
          const dn = domainById.get(inbox.domain_id)?.domain;
          const rd = dn ? getRootDomain(dn) : "";
          return nextRoots.includes(rd);
        });
        const effectiveCount = pruned.length || 1;
        return {
          ...cd,
          senderIds: pruned,
          enableRotation: pruned.length > 1,
          dailyLimit: cd.dailyLimitTouched ? cd.dailyLimit : effectiveCount * 50,
        };
      });
      return nextRoots;
    });
  };

  const autosaveDraftIfNeeded = async () => {
    if (formDataLoading) return;
    const name = campaignData.name.trim();
    if (!name) return;
    if (!userId) return;
    if (campaignGate.atLimit) return;
    if (autosaveInProgressRef.current) return;

    autosaveInProgressRef.current = true;
    try {
      const templateIds = campaignData.emails.flatMap((e) => e.templateIds);
      const emailSequence = campaignData.emails.flatMap((e) =>
        (e.templateIds || []).map((tid) => ({ template_id: tid, delay_days: e.delay ?? 0 }))
      );

      if (replyToType === "custom" && !replyToEmail?.trim()) {
        autosaveInProgressRef.current = false;
        return;
      }

      const basePayload = {
        name,
        sender_name:
          campaignData.senderType === "gmail"
            ? campaignData.senderIds.length > 0
              ? inboxes.find((i) => i.id === campaignData.senderIds[0])?.email
              : undefined
            : undefined,
        daily_limit: campaignData.dailyLimit,
        template_ids: templateIds,
        contact_list_ids: campaignData.contactList ? [campaignData.contactList] : [],
        contact_ids: [] as string[],
        status: "draft" as const,
        field_mapping: {},
        email_sequence: emailSequence,
        start_date: undefined as string | undefined,
        start_time: campaignData.startTime,
        end_time: campaignData.endTime,
        schedule_weekdays: campaignData.scheduleWeekdays,
        timezone: campaignData.timezone,
        sender_type: campaignData.senderType,
        sender_ids: campaignData.senderIds,
        sender_rotation: campaignData.senderRotation,
        rotation_enabled: campaignData.enableRotation,
        use_ai_generation: campaignData.useAiGeneration,
        ai_generation_prompt: campaignData.useAiGeneration ? campaignData.aiGenerationPrompt : undefined,
        ai_generation_provider: campaignData.useAiGeneration ? campaignData.aiGenerationProvider : undefined,
        use_external_enrichment: campaignData.useExternalEnrichment,
        external_enrichment_prompt: campaignData.useExternalEnrichment
          ? campaignData.externalEnrichmentPrompt || undefined
          : undefined,
        external_enrichment_provider: campaignData.useExternalEnrichment
          ? campaignData.externalEnrichmentProvider || undefined
          : undefined,
        reply_to_type: replyToType === "default" ? undefined : replyToType,
        reply_to_id: replyToType === "default" ? undefined : replyToId ?? undefined,
        reply_to_email: replyToType === "custom" ? (replyToEmail?.trim() || undefined) : undefined,
        campaign_real_engagement_network: campaignData.campaignRealEngagementNetwork,
        campaign_personal_network_pool:
          campaignData.campaignRealEngagementNetwork && campaignData.campaignPersonalNetworkPool,
        campaign_real_engagement_percent: campaignData.campaignRealEngagementPercent,
        open_tracking: campaignData.openTracking,
        updated_at: new Date().toISOString(),
      };

      if (!draftCampaignId) {
        const id = crypto.randomUUID();
        const payload = {
          ...basePayload,
          id,
          user_id: userId,
          created_at: new Date().toISOString(),
        };
        await api.campaigns.create(payload as any);
        setDraftCampaignId(id);
      } else {
        await api.campaigns.update(draftCampaignId, basePayload as any);
      }
    } catch {
      // Silent fail for autosave
    } finally {
      autosaveInProgressRef.current = false;
    }
  };

  const goToStep = (targetStep: number) => {
    if (targetStep === currentStep) return;
    void autosaveDraftIfNeeded();
    setCurrentStep(Math.min(Math.max(targetStep, 1), 5));
  };

  const nextStep = () => goToStep(currentStep + 1);
  const prevStep = () => goToStep(currentStep - 1);

  const handleSaveDraft = async () => {
    if (!campaignData.name.trim() || campaignGate.atLimit) return;
    setSaveDraftLoading(true);
    try {
      await autosaveDraftIfNeeded();
      toast.success("Campaign saved as draft");
      router.push("/campaigns");
    } catch {
      toast.error("Failed to save draft");
    } finally {
      setSaveDraftLoading(false);
    }
  };

  const spamAnalysis = useCampaignSpamAnalysis(campaignData.emails, templates, settingsData?.compliance);

  const handleSendConnectionTest = async () => {
    const email = testEmail.trim();
    if (!email) {
      toast.error("Please enter an email address to send the test email");
      return;
    }
    if (!userId) {
      toast.error("User not found. Please log in again.");
      return;
    }

    setIsTestingConnection(true);
    try {
    if (campaignData.senderType === "gmail") {
      const gmailInboxes = inboxes.filter((i) => i.sender_type === "gmail");
      if (gmailInboxes.length === 0) {
        toast.error("Please connect Gmail in Settings first");
        return;
      }
      if (campaignData.senderIds.length === 0) {
        toast.error("Please select at least one Gmail account");
        return;
      }
        const gmailSenderId = campaignData.senderIds[0];
        const result = await api.emails.sendConnectionTest(userId, email, gmailSenderId);
        toast.success(result.message || `Test email sent to ${email}`);
      } else {
        const selectedInboxId = campaignData.senderIds[0];
        if (!selectedInboxId) {
          toast.error("Please select an SMTP inbox first");
          return;
        }
        const inbox = inboxes.find(i => i.id === selectedInboxId);
        if (!inbox || inbox.sender_type !== "smtp") {
          toast.error("Selected inbox is not a valid SMTP inbox");
          return;
        }
        const result = await api.emails.sendSmtpConnectionTest(userId, selectedInboxId, email);
        toast.success(result.message || `Test email sent via SMTP to ${email}`);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to send test email");
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleLaunchCampaign = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    const gmailInboxList = inboxes.filter((i) => i.sender_type === "gmail");
    const ready = validateCampaignForm(campaignData, "ready", {
      smtpSelectedRootDomains,
      reply: { replyToType, replyToId, replyToEmail },
      gmailInboxCount: gmailInboxList.length,
    });
    if (!ready.ok) {
      toast.error(ready.message);
      isSubmittingRef.current = false;
      return;
    }

    try {
      const templateIds = campaignData.emails.flatMap((e) => e.templateIds);
      const emailSequence = campaignData.emails.flatMap((e) =>
        (e.templateIds || []).map((tid) => ({ template_id: tid, delay_days: e.delay ?? 0 }))
      );
      // Create / update campaign
      const id = draftCampaignId ?? crypto.randomUUID();
      const campaignPayload = {
        id,
        user_id: userId,
        name: campaignData.name.trim(),
        sender_name:
          campaignData.senderType === "gmail"
            ? (campaignData.senderIds.length > 0
                ? inboxes.find((i) => i.id === campaignData.senderIds[0])?.email
                : undefined)
            : undefined,
        daily_limit: campaignData.dailyLimit,
        template_ids: templateIds,
        contact_list_ids: campaignData.contactList ? [campaignData.contactList] : [],
        contact_ids: [],
        status: "draft" as const,
        field_mapping: {},
        email_sequence: emailSequence,
        start_date: undefined,
        start_time: campaignData.startTime,
        end_time: campaignData.endTime,
        schedule_weekdays: campaignData.scheduleWeekdays,
        timezone: campaignData.timezone,
        sender_type: campaignData.senderType,
        sender_ids: campaignData.senderIds,
        sender_rotation: campaignData.senderRotation,
        rotation_enabled: campaignData.enableRotation,
        use_ai_generation: campaignData.useAiGeneration,
        ai_generation_prompt: campaignData.useAiGeneration ? campaignData.aiGenerationPrompt : undefined,
        ai_generation_provider: campaignData.useAiGeneration ? campaignData.aiGenerationProvider : undefined,
        use_external_enrichment: campaignData.useExternalEnrichment,
        external_enrichment_prompt: campaignData.useExternalEnrichment
          ? campaignData.externalEnrichmentPrompt || undefined
          : undefined,
        external_enrichment_provider: campaignData.useExternalEnrichment
          ? campaignData.externalEnrichmentProvider || undefined
          : undefined,
        reply_to_type: replyToType === "default" ? undefined : replyToType,
        reply_to_id: replyToType === "default" ? undefined : replyToId ?? undefined,
        reply_to_email: replyToType === "custom" ? (replyToEmail?.trim() || undefined) : undefined,
        campaign_real_engagement_network: campaignData.campaignRealEngagementNetwork,
        campaign_personal_network_pool:
          campaignData.campaignRealEngagementNetwork && campaignData.campaignPersonalNetworkPool,
        campaign_real_engagement_percent: campaignData.campaignRealEngagementPercent,
        open_tracking: campaignData.openTracking,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (campaignGate.atLimit) {
        toast.error(campaignGate.upgradeLine || "Your current plan does not allow creating more campaigns.");
        setUpgradeOpen(true);
        isSubmittingRef.current = false;
        return;
      }
      if (draftCampaignId) {
        await api.campaigns.update(draftCampaignId, campaignPayload as any);
        router.push("/campaigns");
        isSubmittingRef.current = false;
      } else {
        createCampaign.mutate(campaignPayload as any, {
          onSuccess: () => {
            setDraftCampaignId(id);
            router.push("/campaigns");
          },
          onSettled: () => {
            isSubmittingRef.current = false;
          },
        });
      }
    } catch (error: any) {
      isSubmittingRef.current = false;
      toast.error(error.message || "Failed to create campaign");
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <SenderIdentityPanel
              campaignData={campaignData}
              setCampaignData={setCampaignData}
              handleSenderTypeChange={handleSenderTypeChange}
              gmailInboxes={gmailInboxes}
              smtpRootDomainOptions={smtpRootDomainOptions}
              smtpSelectedRootDomains={smtpSelectedRootDomains}
              setSmtpSelectedRootDomains={setSmtpSelectedRootDomains}
              handleSmtpRootToggle={handleSmtpRootToggle}
              smtpInboxesForSelectedRoots={smtpInboxesForSelectedRoots}
              inboxes={inboxes}
              testEmail={testEmail}
              setTestEmail={setTestEmail}
              handleSendConnectionTest={handleSendConnectionTest}
              isTestingConnection={isTestingConnection}
              allowSmtpDomainAutofillRef={allowSmtpDomainAutofillRef}
            />
          </motion.div>
        );

      case 2:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Audience</CardTitle>
                <CardDescription>
                  Choose your list and review who will receive this campaign.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-0">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex gap-3">
                  <Info className="h-5 w-5 shrink-0 text-primary mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Recommendation</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      We recommend creating a dedicated contact list for each new campaign so you can target the right
                      audience and track performance clearly.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="audience-contact-list">Contact list</Label>
                  <p className="text-sm text-muted-foreground">Who receives this campaign from your imported lists.</p>
                  <Select
                    value={campaignData.contactList}
                    onValueChange={(value) => setCampaignData({ ...campaignData, contactList: value })}
                  >
                    <SelectTrigger id="audience-contact-list">
                      <SelectValue placeholder="Choose a contact list" />
                    </SelectTrigger>
                    <SelectContent>
                      {contactLists.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground">No contact lists available</div>
                      ) : (
                        contactLists.map((list) => (
                          <SelectItem key={list.id} value={list.id}>
                            {list.name} ({list.contact_count || list.contact_ids.length} contacts)
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {contactLists.length === 0 && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-4 flex gap-3">
                      <Users className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500 mt-0.5" />
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">No contact lists yet</p>
                        <p className="text-sm text-muted-foreground">
                          Create a contact list in Contacts, then come back here to choose it as your campaign audience.
                        </p>
                        <Link href="/contacts">
                          <Button size="sm" variant="default" className="mt-1">
                            <Plus className="h-4 w-4 mr-1.5" />
                            Go to Contacts
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )}
                </div>

            {selectedList && (() => {
              const listSize = audiencePreview?.total_contacts ?? selectedList?.contact_count ?? (Array.isArray(selectedList?.contact_ids) ? selectedList.contact_ids.length : 0) ?? 0;
              const { inboxes: recommendedInboxes, spreadDays } = getRecommendedInboxesAndSpread(listSize);
              const selectedInboxCount = campaignData.senderIds.length;
              const isOverRecommended = selectedInboxCount > recommendedInboxes;
              return (
                <div className="space-y-6 pt-2 border-t border-border">
                  <div
                    className={
                      isOverRecommended
                        ? "rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex flex-wrap items-center gap-2"
                        : "rounded-lg border border-primary/20 bg-primary/5 p-4 flex flex-wrap items-center gap-2"
                    }
                  >
                    {isOverRecommended ? (
                      <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
                    ) : (
                      <Info className="h-5 w-5 shrink-0 text-primary" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        For this list we recommend <strong>{recommendedInboxes} inbox{recommendedInboxes !== 1 ? "es" : ""}</strong>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        At 35 emails/day per inbox, your campaign would spread over approximately{" "}
                        <strong>{spreadDays} day{spreadDays !== 1 ? "s" : ""}</strong> for best deliverability. You can choose
                        which inboxes to use in Campaign Info.
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 border-l-2 border-muted pl-2">
                        Note: Using 3 inboxes is best for small lists (1–300 contacts).
                      </p>
                      {isOverRecommended && (
                        <p className="text-xs text-destructive font-medium mt-1.5">
                          You have selected {selectedInboxCount} inboxes (more than recommended). Consider using fewer for
                          better deliverability.
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-4">Audience preview</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-center">
                      <div className="p-4 rounded-lg bg-secondary">
                        <p className="text-2xl font-bold text-primary">
                          {audienceLoading ? "—" : (audiencePreview?.total_contacts ?? 0).toLocaleString()}
                        </p>
                        <p className="text-sm text-muted-foreground">Total Contacts</p>
                      </div>
                      <div className="p-4 rounded-lg bg-secondary">
                        <p className="text-2xl font-bold text-success">
                          {audienceLoading ? "—" : (audiencePreview?.verified ?? 0).toLocaleString()}
                        </p>
                        <p className="text-sm text-muted-foreground">Verified</p>
                      </div>
                      <div className="p-4 rounded-lg bg-secondary">
                        <p className="text-2xl font-bold text-warning">
                          {audienceLoading ? "—" : (audiencePreview?.duplicates_removed ?? 0).toLocaleString()}
                        </p>
                        <p className="text-sm text-muted-foreground">Duplicates Removed</p>
                      </div>
                      <div className="p-4 rounded-lg bg-secondary">
                        <p className="text-2xl font-bold text-muted-foreground">
                          {audienceLoading ? "—" : (audiencePreview?.pending ?? 0).toLocaleString()}
                        </p>
                        <p className="text-sm text-muted-foreground">Pending</p>
                      </div>
                      <div className="p-4 rounded-lg bg-secondary">
                        <p className="text-2xl font-bold text-destructive">
                          {audienceLoading ? "—" : (audiencePreview?.blocked ?? 0).toLocaleString()}
                        </p>
                        <p className="text-sm text-muted-foreground">Blocked</p>
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground space-y-2 mt-4">
                      <p className="font-medium text-foreground">What these numbers mean</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>
                          <strong>Verified:</strong> Contacts who have engaged (opened, clicked, replied).
                        </li>
                        <li>
                          <strong>Pending:</strong> Not yet engaged and have received fewer than 3 emails globally; they
                          will receive this campaign.
                        </li>
                        <li>
                          <strong>Blocked:</strong> Still not engaged but have already received 3+ emails globally; they
                          will not receive this campaign.
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })()}
              </CardContent>
            </Card>

            <div className="border-t border-border pt-6">
            <Card className="border-muted-foreground/20 bg-muted/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Reply engagement &amp; network reach</CardTitle>
                <CardDescription>
                  Optional: add real inbox activity alongside your list sends—aimed at getting replies and mixing in
                  human-looking engagement so traffic is less likely to look like generic blast outreach to mailbox
                  providers.{" "}
                  <span className="font-medium text-foreground">{"{{company}}"}</span> is sampled from your selected
                  list; <span className="font-medium text-foreground">{"{{first_name}}"}</span> and{" "}
                  <span className="font-medium text-foreground">{"{{last_name}}"}</span> come from each recipient&apos;s
                  email address.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-0 pt-0">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between pb-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">Real engagement (Warmup Network)</span>
                        <Badge variant="secondary" className="text-xs">
                          Recommended
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Automated Real Network</p>
                      <p className="text-sm text-muted-foreground">
                        Sends to your own contacts — genuine email activity that builds real sender reputation.{" "}
                        <span className="font-medium text-foreground">{warmupNetworkCount}</span> contacts in your
                        network.
                      </p>
                      <Link
                        href="/warmup/network"
                        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Manage Warmup Network
                      </Link>
                    </div>
                    <Switch
                      checked={campaignData.campaignRealEngagementNetwork}
                      onCheckedChange={(c) => {
                        const on = c === true;
                        setCampaignData({
                          ...campaignData,
                          campaignRealEngagementNetwork: on,
                          campaignPersonalNetworkPool: on ? campaignData.campaignPersonalNetworkPool : false,
                        });
                      }}
                      className="shrink-0 data-[state=checked]:bg-primary"
                      aria-label="Enable real engagement warmup network"
                    />
                  </div>

                  <div
                    className={cn(
                      "border-t border-border pt-4 transition-opacity",
                      !campaignData.campaignRealEngagementNetwork && "opacity-60"
                    )}
                  >
                    <div className="mb-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Real engagement send share (of campaign daily sends)
                      </p>
                      <div className="flex items-center gap-3">
                        <Select
                          value={String(campaignData.campaignRealEngagementPercent)}
                          onValueChange={(v) =>
                            setCampaignData({
                              ...campaignData,
                              campaignRealEngagementPercent: Number(v),
                            })
                          }
                          disabled={!campaignData.campaignRealEngagementNetwork}
                        >
                          <SelectTrigger className="h-8 w-[180px]">
                            <SelectValue placeholder="Select percentage" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="20">20%</SelectItem>
                            <SelectItem value="40">40%</SelectItem>
                            <SelectItem value="60">60%</SelectItem>
                            <SelectItem value="80">80%</SelectItem>
                            <SelectItem value="100">100%</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          With est. sends/day <span className="font-medium text-foreground">{campaignData.dailyLimit}</span>,
                          this targets about{" "}
                          <span className="font-medium text-foreground">
                            {Math.max(
                              1,
                              Math.round(
                                campaignData.dailyLimit * (campaignData.campaignRealEngagementPercent / 100)
                              )
                            )}
                          </span>{" "}
                          real-engagement recipient slots.
                        </p>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-muted-foreground mb-3">
                      Optional: Shared contact pool (inside Real engagement)
                    </p>
                    <div className="rounded-lg border bg-background/80 p-3 sm:p-4">
                      <div className="flex gap-3">
                        <Checkbox
                          id="campaign-personal-network-pool"
                          checked={campaignData.campaignPersonalNetworkPool}
                          onCheckedChange={(c) =>
                            setCampaignData({ ...campaignData, campaignPersonalNetworkPool: c === true })
                          }
                          disabled={
                            !campaignData.campaignRealEngagementNetwork || poolCreditBalance < poolCostPerSend
                          }
                          className="mt-0.5"
                        />
                        <div className="min-w-0 space-y-2">
                          <Label
                            htmlFor="campaign-personal-network-pool"
                            className={cn(
                              "text-sm font-medium",
                              campaignData.campaignRealEngagementNetwork
                                ? "cursor-pointer"
                                : "cursor-not-allowed text-muted-foreground"
                            )}
                          >
                            Shared contact pool
                          </Label>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              Credits based
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              Balance:{" "}
                              <span className="font-medium text-foreground">{poolCreditBalance}</span> credits
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Also rent sends from the shared pool of other users&apos; real networks (on top of your own).
                            Each email to a pool recipient deducts {poolCostPerSend} credit
                            {poolCostPerSend === 1 ? "" : "s"}.
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Leave unchecked to use only your saved Warmup Network contacts — no rented pool recipients.
                          </p>
                          {!campaignData.campaignRealEngagementNetwork && (
                            <p className="text-xs text-muted-foreground">
                              Turn on <span className="font-medium text-foreground">Real engagement</span> first; the pool
                              is an add-on to that mode.
                            </p>
                          )}
                          {campaignData.campaignRealEngagementNetwork && poolCreditBalance < poolCostPerSend && (
                            <p className="text-xs text-amber-600 dark:text-amber-500">
                              Add credits to enable the pool. You can still run Real engagement with your own network
                              only.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            </div>

          </motion.div>
        );

      case 3:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            {templates.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <Mail className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium">No templates yet</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">
                    Create email templates first, then select them here for your campaign sequence.
                  </p>
                  <Button asChild>
                    <Link href="/templates">Create templates</Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="border-primary/50 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Info className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Suggestion</p>
                        <p className="text-sm text-muted-foreground">
                          Add 3–5 variations for best results with variables and a good amount of spintax.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {campaignData.emails.map((email, index) => {
                  const templateIds = (email.templateIds ?? [""]).length ? (email.templateIds ?? [""]) : [""];
                  return (
                    <Card key={index}>
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-base">
                          {index === 0 ? "Initial Email" : `Follow-up ${index}`}
                        </CardTitle>
                        {index > 0 && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <Clock className="w-3 h-3 text-muted-foreground" />
                              <Label htmlFor={`delay-${index}`} className="text-sm font-normal text-muted-foreground whitespace-nowrap">Send after</Label>
                              <Input
                                id={`delay-${index}`}
                                type="number"
                                min={campaignData.emails[index - 1].delay + 1}
                                max={365}
                                value={email.delay}
                                onChange={(e) => {
                                  const prevDelay = campaignData.emails[index - 1].delay;
                                  const minVal = prevDelay + 1;
                                  const v = parseInt(e.target.value, 10);
                                  const val = Number.isNaN(v) ? minVal : Math.min(365, Math.max(minVal, v));
                                  const newEmails = campaignData.emails.map((em, i) => ({ ...em, templateIds: em.templateIds ?? [""] }));
                                  newEmails[index] = { ...newEmails[index], delay: val };
                                  for (let j = index + 1; j < newEmails.length; j++) {
                                    if (newEmails[j].delay <= newEmails[j - 1].delay) {
                                      newEmails[j] = { ...newEmails[j], delay: newEmails[j - 1].delay + 1 };
                                    }
                                  }
                                  setCampaignData({ ...campaignData, emails: newEmails });
                                }}
                                className="w-16 h-8"
                              />
                              <span className="text-sm text-muted-foreground whitespace-nowrap">days</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                const newEmails = campaignData.emails.filter((_, i) => i !== index).map((e) => ({ ...e, templateIds: e.templateIds ?? [""] }));
                                setCampaignData({ ...campaignData, emails: newEmails });
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {templateIds.map((tid, vi) => (
                          <div key={vi} className="space-y-2">
                            <Label>
                              {index === 0 && vi === 0 ? "Template" : `Variant ${String.fromCharCode(65 + vi)}`}
                            </Label>
                            <Select
                              value={tid || ""}
                              onValueChange={(value) => {
                                const newEmails = campaignData.emails.map((em, i) => ({ ...em, templateIds: em.templateIds ?? [""] }));
                                const stepIds = [...(newEmails[index].templateIds ?? [""])];
                                if (vi >= stepIds.length) stepIds.length = vi + 1;
                                stepIds[vi] = value;
                                newEmails[index] = { ...newEmails[index], templateIds: stepIds };
                                setCampaignData({ ...campaignData, emails: newEmails });
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Choose a template" />
                              </SelectTrigger>
                              <SelectContent>
                                {templates.map((template) => (
                                  <SelectItem key={template.id} value={template.id}>
                                    {template.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {templates.find((t) => t.id === tid) && (
                              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                                <p className="font-medium text-muted-foreground">Preview</p>
                                <p className="font-medium truncate">{templates.find((t) => t.id === tid)?.subject}</p>
                                <p className="text-muted-foreground line-clamp-2">
                                  {(templates.find((t) => t.id === tid)?.body ?? "").replace(/<[^>]*>/g, " ").trim().slice(0, 120)}
                                  {(templates.find((t) => t.id === tid)?.body?.length ?? 0) > 120 ? "…" : ""}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => {
                              const newEmails = campaignData.emails.map((em, i) => ({ ...em, templateIds: em.templateIds ?? [""] }));
                              newEmails[index] = { ...newEmails[index], templateIds: [...(newEmails[index].templateIds ?? [""]), ""] };
                              setCampaignData({ ...campaignData, emails: newEmails });
                            }}
                          >
                            <Plus className="w-3 h-3" />
                            Add variant
                          </Button>
                          {(email.templateIds?.length ?? 1) > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground"
                              onClick={() => {
                                const newEmails = campaignData.emails.map((em, i) => ({ ...em, templateIds: em.templateIds ?? [""] }));
                                const stepIds = (newEmails[index].templateIds ?? [""]).slice(0, -1);
                                if (stepIds.length < 1) return;
                                newEmails[index] = { ...newEmails[index], templateIds: stepIds };
                                setCampaignData({ ...campaignData, emails: newEmails });
                              }}
                            >
                              Remove last variant
                            </Button>
                          )}
                        </div>
                        <p className="pt-1">
                          <Link href="/get-started#ab-testing" className="text-sm text-muted-foreground hover:text-primary hover:underline">How template variants & A/B testing work →</Link>
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}


                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => {
                    const last = campaignData.emails[campaignData.emails.length - 1];
                    setCampaignData({
                      ...campaignData,
                      emails: [
                        ...campaignData.emails.map((e) => ({ ...e, templateIds: e.templateIds ?? [""] })),
                        { templateIds: [""], delay: (last?.delay ?? 0) + 2 },
                      ],
                    });
                  }}
                >
                  <Plus className="w-4 h-4" />
                  Add Follow-up
                </Button>

              </>
            )}
          </motion.div>
        );

      case 4:
        return (
          <CampaignStepDelivery
            campaignData={campaignData}
            setCampaignData={setCampaignData}
            replyToType={replyToType}
            setReplyToType={setReplyToType}
            replyToId={replyToId}
            setReplyToId={setReplyToId}
            replyToEmail={replyToEmail}
            setReplyToEmail={setReplyToEmail}
            inboxes={inboxes}
            replyToImapConfigs={replyToImapConfigs}
            llmConfigs={llmConfigs}
            serperSettings={serperSettings}
            bestSendTime={bestSendTime}
            bestSendTimeFetched={bestSendTimeFetched}
            showListen
          />
        );

      case 5: {
        let sendingInboxEmails: string[];
        if (campaignData.senderType === "gmail") {
          const selectedGmail = inboxes.filter(
            (i) => i.sender_type === "gmail" && campaignData.senderIds.includes(i.id)
          );
          sendingInboxEmails = selectedGmail.length > 0 ? selectedGmail.map((i) => i.email) : [];
        } else {
          const selectedInboxes = inboxes.filter((inbox) =>
            campaignData.senderIds.includes(inbox.id)
          );
          sendingInboxEmails = selectedInboxes.length > 0 ? selectedInboxes.map((i) => i.email) : [];
        }
        return (
          <CampaignReviewContent
            spamAnalysis={spamAnalysis}
            campaignData={campaignData}
            audienceVerified={audiencePreview?.verified ?? 0}
            audienceSelected={!!selectedList}
            sendingDisplay={{ type: "emails", emails: sendingInboxEmails }}
          />
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="max-w-3xl mx-auto bg-background min-h-[calc(100vh-4rem)]">
      <UpgradeModal featureKey="campaigns" gate={campaignGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/campaigns">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Create Campaign</h1>
          <p className="text-muted-foreground">Set up your email campaign step by step</p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div
                className="flex flex-col items-center cursor-pointer"
                onClick={() => goToStep(step.id)}
                data-tour={
                  step.title === "Basics"
                    ? "campaigns-new-tab-info"
                    : step.title === "Audience"
                      ? "campaigns-new-tab-audience"
                      : step.title === "Email sequence"
                        ? "campaigns-new-tab-sequence"
                        : step.title === "Delivery"
                          ? "campaigns-new-tab-delivery"
                          : step.title === "Review"
                            ? "campaigns-new-tab-review"
                            : undefined
                }
              >
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${
                    currentStep >= step.id
                      ? "gradient-primary text-white"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {currentStep > step.id ? (
                    <Check className="w-5 h-5" />
                  ) : (
                    <step.icon className="w-5 h-5" />
                  )}
                </div>
                <span
                  className={`text-xs mt-2 whitespace-nowrap ${
                    currentStep >= step.id ? "text-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`h-[2px] flex-1 mx-4 rounded-full ${
                    currentStep > step.id ? "bg-primary" : "bg-secondary"
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <CardContent className="p-6">
          {formDataLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-10 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <AnimatePresence mode="wait">{renderStep()}</AnimatePresence>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6 pb-12">
        <Button variant="outline" onClick={prevStep} disabled={currentStep === 1}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Previous
        </Button>

        {currentStep === 5 ? (
          <Button 
            className="gradient-primary" 
            onClick={handleLaunchCampaign}
            disabled={createCampaign.isPending}
          >
            {createCampaign.isPending ? "Creating..." : "Launch Campaign"}
            <Check className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button onClick={nextStep}>
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveDraft}
              disabled={!campaignData.name.trim() || campaignGate.atLimit || saveDraftLoading}
            >
              {saveDraftLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Save
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
