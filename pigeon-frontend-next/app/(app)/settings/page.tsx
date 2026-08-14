"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Webhook,
  CreditCard,
  Globe,
  Mail,
  Save,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Crown,
  AlertCircle,
  Calendar,
  Zap,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useGmailStatus, useGmailAuth, useDisconnectGmail, useAddGmailAppPassword } from "@/hooks/useGmail";
import { useDomains } from "@/hooks/useDomains";
import { useInboxes } from "@/hooks/useInboxes";
import { useLLMConfigs, useSaveLLMConfig, useDeleteLLMConfig } from "@/hooks/useLLM";
import {
  useSettings,
  useUpdateSettings,
  useGmailOAuthStatus,
  useGoogleOAuthConfig,
  useUpdateGoogleOAuthConfig,
  useSerperSettings,
  useUpdateSerperSettings,
  useZeroBounceSettings,
  useUpdateZeroBounceSettings,
} from "@/hooks/useSettings";
import { useSessions, useRevokeOtherSessions, formatLastActive } from "@/hooks/useSessions";
import {
  useReplyToImapConfigs,
  useCreateReplyToImapConfig,
  useDeleteReplyToImapConfig,
  useTestReplyToImapConfig,
} from "@/hooks/useReplyToImap";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradeModal } from "@/components/UpgradeModal";
import { useAuth } from "@/contexts/AuthContext";
import { HealthScoreTooltip } from "@/components/HealthScoreTooltip";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { usePlanGate, type PlanGateResult } from "@/hooks/usePlanGate";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { HelpLinks } from "@/components/HelpLinks";
import { AppPageShell } from "@/components/AppPageShell";
import { Checkbox } from "@/components/ui/checkbox";

const VALID_TAB_IDS = ["account", "security", "notifications", "integrations", "compliance", "billing"];

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(() =>
    VALID_TAB_IDS.includes(tabFromUrl || "") ? tabFromUrl! : "account"
  );
  const { user, effectiveUserId, refetchUser } = useAuth();
  const confirmDialog = useConfirmDialog();
  const inboxGate = usePlanGate("inboxes");

  const userId = effectiveUserId;
  const isIntegrationsTab = activeTab === "integrations";
  const isSecurityTab = activeTab === "security";

  const { data: gmailStatus, refetch: refetchGmail, isLoading: gmailLoading } = useGmailStatus(userId, isIntegrationsTab);
  const gmailAuth = useGmailAuth();
  const disconnectGmail = useDisconnectGmail();
  const addGmailAppPassword = useAddGmailAppPassword();
  const { data: domains = [], isLoading: domainsLoading } = useDomains(isIntegrationsTab);
  const { data: inboxes = [], isLoading: inboxesLoading } = useInboxes(userId, isIntegrationsTab);
  const { data: llmConfigs = [], isLoading: llmConfigsLoading } = useLLMConfigs(userId, isIntegrationsTab);
  const saveLLMConfig = useSaveLLMConfig();
  const deleteLLMConfig = useDeleteLLMConfig();
  const { data: settingsData, isLoading: settingsLoading } = useSettings();
  const updateSettings = useUpdateSettings();
  const { data: sessions = [], isLoading: sessionsLoading } = useSessions(isSecurityTab);
  const revokeOtherSessions = useRevokeOtherSessions();
  const { data: replyToImapConfigs = [], isLoading: replyToImapLoading } = useReplyToImapConfigs(isIntegrationsTab);
  const createReplyToImap = useCreateReplyToImapConfig();
  const deleteReplyToImap = useDeleteReplyToImapConfig();
  const testReplyToImap = useTestReplyToImapConfig();
  const { data: gmailOAuthStatus, isLoading: gmailOAuthStatusLoading } = useGmailOAuthStatus(isIntegrationsTab);
  const { data: googleOAuthConfig } = useGoogleOAuthConfig(isIntegrationsTab);
  const updateGoogleOAuthConfig = useUpdateGoogleOAuthConfig();
  const { data: serperSettings, isLoading: serperSettingsLoading } = useSerperSettings(isIntegrationsTab);
  const updateSerperSettings = useUpdateSerperSettings();
  const { data: zerobounceSettings, isLoading: zerobounceSettingsLoading } = useZeroBounceSettings(isIntegrationsTab);
  const updateZeroBounceSettings = useUpdateZeroBounceSettings();

  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [gmailAppPasswordEmail, setGmailAppPasswordEmail] = useState("");
  const [gmailAppPasswordPassword, setGmailAppPasswordPassword] = useState("");
  const [showGmailConnectModal, setShowGmailConnectModal] = useState(false);
  const [showGmailAppPasswordModal, setShowGmailAppPasswordModal] = useState(false);
  const [gmailConnectionTestOpen, setGmailConnectionTestOpen] = useState(false);
  const [gmailConnectionTestAccount, setGmailConnectionTestAccount] = useState<{
    id: string;
    email: string;
  } | null>(null);
  const [gmailConnectionTestToEmail, setGmailConnectionTestToEmail] = useState("");
  const [gmailConnectionTestPending, setGmailConnectionTestPending] = useState(false);
  const [gmailConnectTab, setGmailConnectTab] = useState<"oauth" | "app_password">("app_password");

  const planAllowsGoogle = (user?.limits?.max_google_accounts ?? 0) > 0;
  const gmailAccountsUsed =
    gmailStatus?.accounts?.length ?? (user?.usage as { gmail_inboxes?: number } | undefined)?.gmail_inboxes ?? 0;

  const gmailGate: PlanGateResult = useMemo(() => {
    const limit = user?.limits?.max_google_accounts ?? null;
    const usage = gmailAccountsUsed;
    if (limit == null || limit === -1) {
      return { ...inboxGate };
    }
    const used = usage ?? 0;
    const atLimit = used >= limit;
    const reason = atLimit
      ? `Plan limit reached: maximum ${limit} Google accounts. Upgrade at the Pricing page to add more.`
      : "";
    return {
      key: "inboxes",
      label: "Max Google accounts",
      usage,
      limit,
      remaining: Math.max(limit - used, 0),
      atLimit,
      canCreate: !atLimit,
      reason,
      upgradeLine: reason,
      ctaLabel: "Upgrade Plan",
      planName: user?.plan?.name,
    };
  }, [user?.limits?.max_google_accounts, user?.plan?.name, gmailAccountsUsed, inboxGate]);

  const isSettingsPageLoading =
    (activeTab === "security" && sessionsLoading) ||
    (activeTab === "notifications" && settingsLoading) ||
    (activeTab === "compliance" && settingsLoading) ||
    (activeTab === "integrations" &&
      (gmailLoading ||
        domainsLoading ||
        inboxesLoading ||
        llmConfigsLoading ||
        replyToImapLoading ||
        gmailOAuthStatusLoading ||
        serperSettingsLoading ||
        zerobounceSettingsLoading));

  const [llmProvider, setLlmProvider] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModelName, setLlmModelName] = useState("");
  const [showLLMForm, setShowLLMForm] = useState(false);
  const [serperApiKeyInput, setSerperApiKeyInput] = useState("");
  const [zerobounceApiKeyInput, setZerobounceApiKeyInput] = useState("");
  const [zerobounceTestOpen, setZerobounceTestOpen] = useState(false);
  const [zerobounceTestEmail, setZerobounceTestEmail] = useState("");
  const [zerobounceTestTimeout, setZerobounceTestTimeout] = useState<number>(15);
  const [zerobounceTestActivityData, setZerobounceTestActivityData] = useState(false);
  const [zerobounceTestVerifyPlus, setZerobounceTestVerifyPlus] = useState(false);
  const [zerobounceTestPending, setZerobounceTestPending] = useState(false);
  const [zerobounceTestResult, setZerobounceTestResult] = useState<Record<string, unknown> | null>(null);
  const [zerobounceTestError, setZerobounceTestError] = useState<string | null>(null);

  const [profileFirstName, setProfileFirstName] = useState(user?.first_name ?? "");
  const [profileLastName, setProfileLastName] = useState(user?.last_name ?? "");
  const [profileCompany, setProfileCompany] = useState(user?.company ?? "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [complianceSpamWords, setComplianceSpamWords] = useState("");
  const [complianceMaxLinks, setComplianceMaxLinks] = useState(3);
  const [complianceMaxImages, setComplianceMaxImages] = useState(2);
  const [complianceRequireUnsub, setComplianceRequireUnsub] = useState(false);
  const [defaultReplyToType, setDefaultReplyToType] = useState<string>("none");
  const [defaultReplyToId, setDefaultReplyToId] = useState<string | null>(null);
  const [showAddImapDialog, setShowAddImapDialog] = useState(false);
  const [imapForm, setImapForm] = useState({
    email: "",
    imap_host: "",
    imap_port: 993,
    imap_username: "",
    imap_password: "",
  });
  const [imapProvider, setImapProvider] = useState<string>("other");
  const [integrationsSubTab, setIntegrationsSubTab] = useState("email");
  const [gmailUpgradeOpen, setGmailUpgradeOpen] = useState(false);
  const [razorpaySubscription, setRazorpaySubscription] = useState<{
    subscription: {
      id: string;
      status: string;
      plan_id: string;
      current_start: string | null;
      current_end: string | null;
      charge_at?: number;
      billing_cycle?: "monthly" | "annual";
    } | null;
    short_url: string | null;
  } | null>(null);
  const [lemonSqueezySubscription, setLemonSqueezySubscription] = useState<{
    subscription: {
      id: string;
      status: string;
      plan_id: string;
      current_start: string | null;
      current_end: string | null;
      billing_cycle?: "monthly" | "annual";
    } | null;
    customer_portal_url: string | null;
  } | null>(null);
  const [billingSubscriptionLoading, setBillingSubscriptionLoading] = useState(false);
  const [upgradePlanId, setUpgradePlanId] = useState<string>("");
  const [upgradeAtCycleEnd, setUpgradeAtCycleEnd] = useState(false);
  const [billAnnually, setBillAnnually] = useState(false);
  const [billingUpgradePlans, setBillingUpgradePlans] = useState<
    Array<{ id: string; name: string; price: string }>
  >([]);
  const [billingUpgradePlansLoading, setBillingUpgradePlansLoading] = useState(false);

  const [webhooks, setWebhooks] = useState<{ id: string; url: string; events: string[] }[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [webhooksError, setWebhooksError] = useState<string | null>(null);
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false);
  const [webhookFormId, setWebhookFormId] = useState<string | null>(null);
  const [webhookFormUrl, setWebhookFormUrl] = useState("");
  const [webhookFormEvents, setWebhookFormEvents] = useState<string[]>(["email.sent", "email.opened"]);

  const isIndia = user?.is_india !== false;
  const isPaidSubscription =
    !!razorpaySubscription?.subscription &&
    ["active", "authenticated", "pending"].includes(
      razorpaySubscription.subscription.status
    );
  const hasAnyPaidSubscription =
    isPaidSubscription ||
    !!lemonSqueezySubscription ||
    user?.subscription_status === "active";
  const isPendingSubscription = razorpaySubscription?.subscription?.status === "created";
  const hasUsedTrial = !!user?.trial_used_at;
  const isInTrialPeriod =
    user?.subscription_status === "trial" ||
    (!!user?.trial_ends_at && new Date(String(user.trial_ends_at)) > new Date()) ||
    razorpaySubscription?.subscription?.status === "authenticated";
  const showStartPlansCard =
    !billingSubscriptionLoading &&
    !hasAnyPaidSubscription &&
    !hasUsedTrial &&
    !isInTrialPeriod;
  const isFreePlan = !user?.plan_id || user.plan_id === "free" || user?.plan?.id === "free";
  const canClaimFreeTrial =
    isFreePlan && !hasUsedTrial && !isInTrialPeriod && !hasAnyPaidSubscription;
  const currentPlanIdNormalized = String(user?.plan_id ?? user?.plan?.id ?? "")
    .trim()
    .toLowerCase();
  const availableUpgradePlans = useMemo(
    () => billingUpgradePlans.filter((plan) => plan.id !== currentPlanIdNormalized),
    [billingUpgradePlans, currentPlanIdNormalized]
  );

  const WEBHOOK_EVENTS = [
    { id: "email.sent", label: "Email sent" },
    { id: "email.opened", label: "Email opened" },
    { id: "email.replied", label: "Email replied" },
    { id: "email.bounced", label: "Email bounced (failed)" },
  ];

  useEffect(() => {
    const t = searchParams.get("tab");
    if (VALID_TAB_IDS.includes(t || "")) setActiveTab(t!);
  }, [searchParams]);

  useEffect(() => {
    if (activeTab !== "billing") return;
    setBillingSubscriptionLoading(true);
    if (isIndia) {
      api.billing.razorpay
        .getSubscription()
        .then((data) => {
          setRazorpaySubscription(data);
          if (data?.subscription) refetchUser();
        })
        .catch(() => setRazorpaySubscription(null))
        .finally(() => setBillingSubscriptionLoading(false));
    } else {
      api.billing.lemonSqueezy
        .getSubscription()
        .then((data) => setLemonSqueezySubscription(data))
        .catch(() => setLemonSqueezySubscription(null))
        .finally(() => setBillingSubscriptionLoading(false));
    }
  }, [activeTab, isIndia, refetchUser]);

  useEffect(() => {
    if (activeTab !== "billing") return;
    let cancelled = false;
    setBillingUpgradePlansLoading(true);
    api.plans
      .list()
      .then((res) => {
        if (cancelled) return;
        const plans = Array.isArray(res?.plans) ? res.plans : [];
        const parsed = plans
          .map((plan) => {
            const id = String((plan as { id?: unknown }).id ?? "")
              .trim()
              .toLowerCase();
            const name = String((plan as { name?: unknown }).name ?? id);
            const price = String((plan as { price?: unknown }).price ?? "")
              .trim()
              .toLowerCase();
            return { id, name, price };
          })
          .filter((plan) => plan.id && plan.price !== "0" && plan.price !== "custom")
          .sort((a, b) => {
            const aPrice = Number(a.price);
            const bPrice = Number(b.price);
            if (Number.isNaN(aPrice) && Number.isNaN(bPrice)) return a.name.localeCompare(b.name);
            if (Number.isNaN(aPrice)) return 1;
            if (Number.isNaN(bPrice)) return -1;
            return aPrice - bPrice;
          });
        setBillingUpgradePlans(parsed);
      })
      .catch(() => {
        if (!cancelled) setBillingUpgradePlans([]);
      })
      .finally(() => {
        if (!cancelled) setBillingUpgradePlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (upgradePlanId && !availableUpgradePlans.some((plan) => plan.id === upgradePlanId)) {
      setUpgradePlanId("");
    }
  }, [upgradePlanId, availableUpgradePlans]);

  const openCreateWebhookDialog = () => {
    setWebhookFormId(null);
    setWebhookFormUrl("");
    setWebhookFormEvents(["email.sent", "email.opened"]);
    setWebhookDialogOpen(true);
  };

  const openEditWebhookDialog = (webhook: {
    id: string;
    url: string;
    events: string[];
  }) => {
    setWebhookFormId(webhook.id);
    setWebhookFormUrl(webhook.url);
    setWebhookFormEvents(webhook.events?.length ? webhook.events : ["email.sent"]);
    setWebhookDialogOpen(true);
  };

  const toggleWebhookEvent = (eventId: string) => {
    setWebhookFormEvents((prev) =>
      prev.includes(eventId)
        ? prev.filter((e) => e !== eventId)
        : [...prev, eventId]
    );
  };

  const handleSaveWebhook = async () => {
    if (!webhookFormUrl.trim()) {
      toast.error("Please enter a webhook URL");
      return;
    }
    if (webhookFormEvents.length === 0) {
      toast.error("Please select at least one event");
      return;
    }
    try {
      setWebhooksLoading(true);
      if (webhookFormId) {
        const updated = await api.webhooks.update(webhookFormId, {
          url: webhookFormUrl.trim(),
          events: webhookFormEvents,
        });
        setWebhooks((prev) =>
          prev.map((w) => (w.id === webhookFormId ? { ...w, ...updated } : w))
        );
        toast.success("Webhook updated");
      } else {
        const created = await api.webhooks.create(
          webhookFormUrl.trim(),
          webhookFormEvents
        );
        setWebhooks((prev) => [...prev, created]);
        toast.success("Webhook created");
      }
      setWebhookDialogOpen(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to save webhook"
      );
    } finally {
      setWebhooksLoading(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      await api.webhooks.delete(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      toast.success("Webhook deleted");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to delete webhook"
      );
    }
  };

  useEffect(() => {
    if (activeTab !== "integrations") return;
    let cancelled = false;
    const loadWebhooks = async () => {
      setWebhooksLoading(true);
      setWebhooksError(null);
      try {
        const items = await api.webhooks.list();
        if (!cancelled) {
          setWebhooks(items);
        }
      } catch (e) {
        if (!cancelled) {
          setWebhooksError(
            e instanceof Error ? e.message : "Failed to load webhooks"
          );
        }
      } finally {
        if (!cancelled) {
          setWebhooksLoading(false);
        }
      }
    };
    loadWebhooks();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (isFreePlan && gmailConnectTab === "oauth") setGmailConnectTab("app_password");
  }, [isFreePlan, gmailConnectTab]);

  const paymentCompletedRef = useRef(false);
  const razorpaySyncInProgressRef = useRef(false);
  const razorpaySyncRequested = searchParams.get("rp_sync") === "1";

  const loadRazorpayScript = (): Promise<void> => {
    if (typeof window !== "undefined" && (window as unknown as { Razorpay?: unknown }).Razorpay)
      return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Razorpay"));
      document.body.appendChild(s);
    });
  };

  const refreshRazorpaySubscription = async (): Promise<{
    subscription: { status?: string } | null;
    short_url: string | null;
  } | null> => {
    setBillingSubscriptionLoading(true);
    try {
      const data = await api.billing.razorpay.getSubscription();
      setRazorpaySubscription(data);
      return data;
    } catch {
      setRazorpaySubscription(null);
      return null;
    } finally {
      setBillingSubscriptionLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "billing" || !isIndia || !razorpaySyncRequested) return;
    if (razorpaySyncInProgressRef.current) return;

    razorpaySyncInProgressRef.current = true;
    let cancelled = false;

    const runSync = async () => {
      const maxAttempts = 8;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (cancelled) return;
        const data = await refreshRazorpaySubscription();
        const status = data?.subscription?.status;
        if (status && status !== "created") {
          await refetchUser();
          break;
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      if (!cancelled) {
        router.replace("/settings?tab=billing", { scroll: false });
      }
    };

    runSync().finally(() => {
      razorpaySyncInProgressRef.current = false;
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, isIndia, razorpaySyncRequested, refetchUser, router]);

  const openRazorpayCheckout = async (planId: string, annual?: boolean) => {
    try {
      paymentCompletedRef.current = false;
      const { subscription_id, key_id } = await api.billing.razorpay.createSubscription(
        planId,
        annual
      );
      await loadRazorpayScript();
      const Razorpay = (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } })
        .Razorpay;
      new Razorpay({
        key: key_id,
        subscription_id,
        callback_url: `${window.location.origin}/settings?tab=billing&rp_sync=1`,
        redirect: true,
        handler: () => {
          paymentCompletedRef.current = true;
          toast.success("Subscription started. Your plan will update shortly.");
          refetchUser();
          setRazorpaySubscription(null);
          setBillingSubscriptionLoading(true);
          api.billing.razorpay
            .getSubscription()
            .then(setRazorpaySubscription)
            .finally(() => setBillingSubscriptionLoading(false));
        },
        modal: {
          ondismiss: async () => {
            if (paymentCompletedRef.current) return;
            try {
              await api.billing.razorpay.cancelSubscription(false);
              refetchUser();
              setRazorpaySubscription(null);
              if (activeTab === "billing") {
                setBillingSubscriptionLoading(true);
                api.billing.razorpay
                  .getSubscription()
                  .then(setRazorpaySubscription)
                  .finally(() => setBillingSubscriptionLoading(false));
              }
              toast.info("Payment cancelled. You can choose a different plan anytime.");
            } catch {
              // best effort
            }
          },
        },
      }).open();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to start subscription");
    }
  };

  const handleCancelSubscription = async () => {
    try {
      const cancelAtCycleEnd = !isInTrialPeriod;
      await api.billing.razorpay.cancelSubscription(cancelAtCycleEnd);
      if (isInTrialPeriod) {
        toast.success("Trial cancelled. You have not been charged.");
      } else {
        toast.success(
          "Subscription will cancel at the end of the billing period. You will be charged on the due date, then downgraded to Free."
        );
      }
      refetchUser();
      setRazorpaySubscription(null);
      if (activeTab === "billing") {
        setBillingSubscriptionLoading(true);
        api.billing.razorpay
          .getSubscription()
          .then(setRazorpaySubscription)
          .finally(() => setBillingSubscriptionLoading(false));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel subscription");
    }
  };

  const handleUpdatePlan = async (planId: string, atCycleEnd: boolean) => {
    try {
      await api.billing.razorpay.updatePlan(
        planId,
        atCycleEnd ? "cycle_end" : "now"
      );
      toast.success(
        atCycleEnd ? "Plan change scheduled for end of billing period." : "Plan updated."
      );
      setUpgradePlanId("");
      refetchUser();
      setRazorpaySubscription(null);
      if (activeTab === "billing") {
        setBillingSubscriptionLoading(true);
        api.billing.razorpay
          .getSubscription()
          .then(setRazorpaySubscription)
          .finally(() => setBillingSubscriptionLoading(false));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update plan");
    }
  };

  const IMAP_PROVIDERS = [
    { id: "gmail", name: "Gmail", host: "imap.gmail.com", port: 993 },
    { id: "hostinger", name: "Hostinger", host: "imap.hostinger.com", port: 993 },
    { id: "godaddy", name: "GoDaddy", host: "imap.secureserver.net", port: 993 },
    { id: "zoho", name: "Zoho Mail", host: "imap.zoho.com", port: 993 },
    { id: "outlook", name: "Outlook / Microsoft 365", host: "outlook.office365.com", port: 993 },
    { id: "yahoo", name: "Yahoo Mail", host: "imap.mail.yahoo.com", port: 993 },
    { id: "other", name: "Other (custom)", host: "", port: 993 },
  ];

  const notifications = settingsData?.notifications ?? {
    campaign_updates: true,
    reply_notifications: true,
    health_alerts: false,
    weekly_reports: true,
    product_updates: true,
    ticket_reply: true,
  };

  useEffect(() => {
    if (user?.first_name !== undefined) setProfileFirstName(user.first_name);
    if (user?.last_name !== undefined) setProfileLastName(user.last_name);
    if (user?.company !== undefined) setProfileCompany(user.company ?? "");
  }, [user?.id, user?.first_name, user?.last_name, user?.company]);

  useEffect(() => {
    if (!settingsData?.compliance) return;
    if (settingsData.compliance.spam_words != null)
      setComplianceSpamWords(settingsData.compliance.spam_words);
    if (settingsData.compliance.max_links_per_email != null)
      setComplianceMaxLinks(settingsData.compliance.max_links_per_email);
    if (settingsData.compliance.max_images_per_email != null)
      setComplianceMaxImages(settingsData.compliance.max_images_per_email);
    if (settingsData.compliance.require_unsubscribe_link !== undefined)
      setComplianceRequireUnsub(settingsData.compliance.require_unsubscribe_link);
  }, [settingsData?.compliance]);

  useEffect(() => {
    const t = (settingsData as { default_reply_to_type?: string })?.default_reply_to_type;
    const id = (settingsData as { default_reply_to_id?: string | null })?.default_reply_to_id;
    setDefaultReplyToType(t ?? "none");
    setDefaultReplyToId(id ?? null);
  }, [settingsData]);

  // Stable primitive deps so the dependency array size never changes (React requirement)
  const gmailAccountsKey =
    `${(gmailStatus?.accounts ?? []).length}-${(gmailStatus?.accounts ?? [])[0]?.id ?? ""}`;
  const inboxesKey = `${inboxes.length}-${inboxes[0]?.id ?? ""}`;
  const replyToImapKey = `${replyToImapConfigs.length}-${replyToImapConfigs[0]?.id ?? ""}`;

  useEffect(() => {
    if (!settingsData) return;
    if (defaultReplyToType === "gmail" && !defaultReplyToId) {
      const firstGmailId =
        inboxes.find((i) => i.sender_type === "gmail")?.id ??
        (gmailStatus?.accounts ?? [])[0]?.id;
      if (firstGmailId) {
        setDefaultReplyToId(firstGmailId);
        updateSettings.mutate({
          default_reply_to_type: "gmail",
          default_reply_to_id: firstGmailId,
        });
      }
    } else if (
      defaultReplyToType === "imap" &&
      !defaultReplyToId &&
      replyToImapConfigs.length > 0
    ) {
      const firstImapId = replyToImapConfigs[0].id;
      setDefaultReplyToId(firstImapId);
      updateSettings.mutate({
        default_reply_to_type: "imap",
        default_reply_to_id: firstImapId,
      });
    }
  }, [
    defaultReplyToType,
    defaultReplyToId,
    settingsData,
    gmailAccountsKey,
    inboxesKey,
    replyToImapKey,
  ]);

  const handleDefaultReplyToChange = (type: string, id: string | null) => {
    setDefaultReplyToType(type);
    setDefaultReplyToId(id);
    updateSettings.mutate({
      default_reply_to_type: type === "none" ? null : type,
      default_reply_to_id: id,
    });
  };

  const handleAddImapSubmit = async () => {
    if (
      !imapForm.email ||
      !imapForm.imap_host ||
      !imapForm.imap_username ||
      !imapForm.imap_password
    ) {
      toast.error("Please fill email, host, username, and password");
      return;
    }
    createReplyToImap.mutate(
      {
        email: imapForm.email,
        imap_host: imapForm.imap_host,
        imap_port: imapForm.imap_port || 993,
        imap_username: imapForm.imap_username,
        imap_password: imapForm.imap_password,
      },
      {
        onSuccess: (data) => {
          setShowAddImapDialog(false);
          setImapForm({
            email: "",
            imap_host: "",
            imap_port: 993,
            imap_username: "",
            imap_password: "",
          });
          setImapProvider("other");
          setDefaultReplyToType("imap");
          setDefaultReplyToId(data.id);
          updateSettings.mutate({
            default_reply_to_type: "imap",
            default_reply_to_id: data.id,
          });
        },
      }
    );
  };

  const handleSaveProfile = async () => {
    if (isSavingProfile) return;
    setIsSavingProfile(true);
    try {
      await api.auth.updateProfile({
        first_name: profileFirstName || undefined,
        last_name: profileLastName || undefined,
        company: profileCompany || undefined,
      });
      await refetchUser();
      toast.success("Profile updated");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update profile");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (isChangingPassword) return;
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setIsChangingPassword(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleToggle2FA = async (enabled: boolean) => {
    try {
      await api.auth.update2FA(enabled);
      await refetchUser();
      toast.success(enabled ? "2FA enabled" : "2FA disabled");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update 2FA");
    }
  };

  const handleRevokeOtherSessions = () => {
    revokeOtherSessions.mutate();
  };

  const handleSaveCompliance = async () => {
    try {
      await updateSettings.mutateAsync({
        compliance: {
          spam_words: complianceSpamWords,
          max_links_per_email: complianceMaxLinks,
          max_images_per_email: complianceMaxImages,
          require_unsubscribe_link: complianceRequireUnsub,
        },
      });
    } catch {
      // toast from hook
    }
  };

  const handleNotificationChange = async (key: string, value: boolean) => {
    const next = { ...notifications, [key]: value };
    try {
      await updateSettings.mutateAsync({ notifications: next });
    } catch {
      // toast from hook
    }
  };

  const checkGmailLimit = (): boolean => {
    if (
      user?.usage != null &&
      user?.limits != null &&
      user.limits.max_google_accounts !== -1
    ) {
      const usedGoogle = (user.usage as { gmail_inboxes?: number }).gmail_inboxes ?? 0;
      if (usedGoogle >= user.limits.max_google_accounts) {
        setGmailUpgradeOpen(true);
        return true;
      }
    }
    return false;
  };

  const handleConnectGmail = async () => {
    if (checkGmailLimit()) return;
    if (
      !gmailOAuthStatus?.user_oauth_configured &&
      !gmailOAuthStatus?.app_default_enabled
    ) {
      toast.error(
        "Google OAuth credentials not set. Add your Google Client ID and Secret above to connect Gmail."
      );
      setShowGmailConnectModal(true);
      return;
    }
    const confirmed = await confirmDialog({
      title: "Connect Gmail",
      description:
        "Connect a Gmail account to send and track your campaigns.\n\nFor best practices, we recommend using a dedicated Gmail account for outreach rather than your primary personal or banking email.\n\nWe only read campaign-related replies so we can notify you when contacts respond. Your personal emails are never accessed.",
      variant: "default",
      confirmLabel: "Continue to Google",
      cancelLabel: "Cancel",
      learnMoreHref: "/campaign-replies",
      learnMoreLabel: "How we read campaign replies",
    });
    if (!confirmed) return;
    try {
      const { auth_url } = await gmailAuth.mutateAsync({ userId });
      window.location.href = auth_url;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "";
      if (
        msg.includes("Plan limit reached") ||
        (msg.includes("maximum") && msg.includes("inboxes"))
      ) {
        toast.error(msg);
      } else if (!msg || msg === "Failed to fetch") {
        toast.error(
          "Google OAuth credentials not set. Add your Google Client ID and Secret above to connect Gmail."
        );
      }
      if (
        msg.includes("Google OAuth credentials not set") ||
        msg === "Failed to fetch"
      ) {
        setShowGmailConnectModal(true);
      }
    }
  };

  const handleDisconnectGmail = async (account: { id: string; auth_method?: string }) => {
    try {
      if (account.auth_method === "app_password") {
        await disconnectGmail.mutateAsync({ userId, inboxId: account.id });
      } else {
        await disconnectGmail.mutateAsync({ userId, credentialId: account.id });
      }
      refetchGmail();
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Failed to disconnect Gmail"
      );
    }
  };

  const handleOpenGmailConnectionTest = (account: { id: string; email: string }) => {
    setGmailConnectionTestAccount({ id: account.id, email: account.email });
    setGmailConnectionTestToEmail((user?.email ?? "").trim());
    setGmailConnectionTestOpen(true);
  };

  const handleSendGmailConnectionTest = async () => {
    const to = gmailConnectionTestToEmail.trim();
    if (!gmailConnectionTestAccount) {
      toast.error("No account selected.");
      return;
    }
    if (!to) {
      toast.error("Enter the email address to send the test to.");
      return;
    }
    setGmailConnectionTestPending(true);
    try {
      const res = await api.emails.sendConnectionTest(userId, to, gmailConnectionTestAccount.id);
      toast.success(res.message ?? `Test email sent to ${to}`);
      setGmailConnectionTestOpen(false);
      setGmailConnectionTestAccount(null);
      setGmailConnectionTestToEmail("");
      refetchGmail();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to send test email");
    } finally {
      setGmailConnectionTestPending(false);
    }
  };

  const llmProviders = [
    { value: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
    { value: "anthropic", label: "Anthropic", defaultModel: "claude-4-sonnet-20250514" },
    { value: "gemini", label: "Google Gemini", defaultModel: "gemini-2.5-pro" },
    { value: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat" },
    { value: "grok", label: "Grok (xAI)", defaultModel: "grok-2-latest" },
    { value: "groq", label: "Groq", defaultModel: "llama-3.3-70b-versatile" },
  ];

  const handleSaveLLMConfig = async () => {
    if (!llmProvider || !llmApiKey) {
      toast.error("Provider and API key are required");
      return;
    }
    try {
      await saveLLMConfig.mutateAsync({
        user_id: userId,
        provider: llmProvider,
        api_key: llmApiKey,
        model_name:
          llmModelName ||
          llmProviders.find((p) => p.value === llmProvider)?.defaultModel,
      });
      setShowLLMForm(false);
      setLlmProvider("");
      setLlmApiKey("");
      setLlmModelName("");
    } catch {
      // Error handled by mutation
    }
  };

  const handleDeleteLLMConfig = async (provider: string) => {
    const confirmed = await confirmDialog({
      title: "Remove integration",
      description: `Delete ${provider} configuration?`,
      variant: "destructive",
    });
    if (confirmed) deleteLLMConfig.mutate({ userId, provider });
  };

  const integrations = [
    {
      name: "Gmail",
      description: "Connect your Gmail accounts",
      connected:
        (gmailStatus?.accounts?.length ?? 0) > 0 || !!gmailStatus?.connected,
      icon: "📧",
    },
    {
      name: "OpenAI",
      description: "AI-powered email generation",
      connected: llmConfigs.some((c) => c.provider === "openai"),
      icon: "🤖",
    },
    { name: "Slack", description: "Get notifications in Slack", connected: false, icon: "💬" },
    { name: "Zapier", description: "Automate workflows", connected: false, icon: "⚡" },
    { name: "HubSpot", description: "Sync contacts with CRM", connected: false, icon: "🔶" },
    {
      name: "Salesforce",
      description: "Enterprise CRM integration",
      connected: false,
      icon: "☁️",
    },
  ];

  const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/api\/?$/, "");
  const gmailCallbackUrl = `${apiBase}/api/gmail/callback`;

  return (
    <AppPageShell
      title="Settings"
      description="Manage your account, security, integrations, and billing."
    >
    <div className="space-y-6">
      {isSettingsPageLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-[200px] w-full rounded-lg" />
          <Skeleton className="h-[120px] w-full rounded-lg" />
          <Skeleton className="h-[180px] w-full rounded-lg" />
        </div>
      ) : (
        <>
          <div className="space-y-6">
            {activeTab === "account" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <Card>
                  <CardHeader>
                    <CardTitle>Profile Information</CardTitle>
                    <CardDescription>Update your personal details</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center gap-6">
                      <Avatar className="w-20 h-20">
                        <AvatarImage src="" />
                        <AvatarFallback className="gradient-primary text-white text-xl">
                          {(profileFirstName?.[0] ||
                            profileLastName?.[0] ||
                            user?.email?.[0] ||
                            "?"
                          ).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <Button variant="outline" size="sm" disabled>
                          Change Photo
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2">
                          JPG, PNG or GIF. Max 2MB.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>First Name</Label>
                        <Input
                          value={profileFirstName}
                          onChange={(e) => setProfileFirstName(e.target.value)}
                          placeholder="First name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Last Name</Label>
                        <Input
                          value={profileLastName}
                          onChange={(e) => setProfileLastName(e.target.value)}
                          placeholder="Last name"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        value={user?.email || ""}
                        type="email"
                        disabled
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Company</Label>
                      <Input
                        value={profileCompany}
                        onChange={(e) => setProfileCompany(e.target.value)}
                        placeholder="Company"
                      />
                    </div>
                    <Button
                      className="gradient-primary"
                      onClick={handleSaveProfile}
                      disabled={isSavingProfile}
                    >
                      {isSavingProfile ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      {isSavingProfile ? "Saving..." : "Save Changes"}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {activeTab === "security" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <Card>
                  <CardHeader>
                    <CardTitle>Change Password</CardTitle>
                    <CardDescription>
                      Update your password regularly for security
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Current Password</Label>
                      <Input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Current password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>New Password</Label>
                      <Input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Confirm New Password</Label>
                      <Input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                      />
                    </div>
                    <Button onClick={handleChangePassword} disabled={isChangingPassword}>
                      {isChangingPassword ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : null}
                      {isChangingPassword ? "Updating..." : "Update Password"}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Two-Factor Authentication</CardTitle>
                    <CardDescription>
                      Require a verification code sent to your email when you sign in
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Enable 2FA at login</p>
                        <p className="text-sm text-muted-foreground">
                          When on, a 6-digit code is sent to your email each time you sign
                          in. You can turn this off to skip the code step.
                        </p>
                      </div>
                      <Switch
                        checked={user?.two_fa_enabled !== false}
                        onCheckedChange={handleToggle2FA}
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Active Sessions</CardTitle>
                    <CardDescription>Manage your logged-in devices</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {sessions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No sessions to display. Log in again to see sessions.
                      </p>
                    ) : (
                      <>
                        <div className="max-h-[280px] overflow-y-auto rounded-lg border pr-1 space-y-4">
                          {sessions.map((session) => (
                            <div
                              key={session.id || session.jti}
                              className={`flex items-center justify-between p-3 rounded-lg ${
                                session.current ? "bg-secondary" : "bg-muted/50"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <Globe
                                  className={`w-5 h-5 ${
                                    session.current
                                      ? "text-primary"
                                      : "text-muted-foreground"
                                  }`}
                                />
                                <div>
                                  <p className="font-medium">{session.device}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {session.location} •{" "}
                                    {formatLastActive(session.last_active)}
                                    {session.current && " • Current session"}
                                  </p>
                                </div>
                              </div>
                              {session.current ? (
                                <Badge className="bg-success">Active</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Other session
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                        {sessions.filter((s) => !s.current).length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-4"
                            onClick={handleRevokeOtherSessions}
                            disabled={revokeOtherSessions.isPending}
                          >
                            {revokeOtherSessions.isPending
                              ? "Revoking…"
                              : "Revoke other sessions"}
                          </Button>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {activeTab === "notifications" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card>
                  <CardHeader>
                    <CardTitle>Notification Preferences</CardTitle>
                    <CardDescription>
                      Choose what notifications you want to receive
                    </CardDescription>
                    <p className="text-sm text-muted-foreground mt-1">
                      Notifications are sent to your account email (the one you signed up
                      with).
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {[
                      {
                        key: "campaign_updates",
                        title: "Campaign Updates",
                        desc: "Get notified when campaigns start, pause, or complete",
                      },
                      {
                        key: "reply_notifications",
                        title: "Reply Notifications",
                        desc: "Receive alerts when prospects reply to your emails",
                      },
                      {
                        key: "ticket_reply",
                        title: "Support Ticket Replies",
                        desc: "Get an email and in-app alert when support replies to your ticket",
                      },
                      {
                        key: "weekly_reports",
                        title: "Weekly Reports",
                        desc: "Receive weekly performance summary emails",
                      },
                      {
                        key: "product_updates",
                        title: "Product Updates",
                        desc: "Stay informed about new features and updates",
                      },
                    ].map((item) => (
                      <div
                        key={item.key}
                        className="flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">{item.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {item.desc}
                          </p>
                        </div>
                        <Switch
                          checked={
                            !!notifications[item.key as keyof typeof notifications]
                          }
                          onCheckedChange={(checked) =>
                            handleNotificationChange(item.key, checked)
                          }
                        />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {activeTab === "integrations" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <Card>
                  <CardHeader>
                    <CardTitle>Integrations</CardTitle>
                    <CardDescription>
                      Manage your connected services and third-party integrations
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-0 p-0">
                    <Tabs value={integrationsSubTab} onValueChange={setIntegrationsSubTab} className="w-full">
                      <div className="px-6 pt-6 border-b">
                        <TabsList className="h-10 bg-transparent p-0 gap-0 rounded-none -mb-px w-full justify-start">
                          <TabsTrigger
                            value="email"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                          >
                            Email
                          </TabsTrigger>
                          <TabsTrigger
                            value="ai"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                          >
                            AI &amp; Search
                          </TabsTrigger>
                          <TabsTrigger
                            value="deliverability"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                          >
                            Deliverability
                          </TabsTrigger>
                          <TabsTrigger
                            value="other"
                            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground"
                          >
                            Other
                          </TabsTrigger>
                        </TabsList>
                      </div>

                      <TabsContent value="email" className="space-y-6 p-6 mt-0">
                    {!planAllowsGoogle ? (
                      <div className="rounded-xl border bg-card p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400">
                            <Mail className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-semibold">Gmail</p>
                            <p className="text-sm text-muted-foreground">
                              Google accounts are not included in your current plan. Upgrade
                              your plan to connect Gmail.
                            </p>
                            <Link
                              href="/pricing"
                              className="text-xs text-primary hover:underline mt-1 inline-block"
                            >
                              View plans
                            </Link>
                          </div>
                        </div>
                        <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground space-y-2">
                          <p className="font-medium text-foreground">Gmail sending limits (approx.)</p>
                          <p>
                            For personal Gmail (@gmail.com): when using the web interface or OAuth2 API you can send to about 500 recipients per day. When using SMTP with an app password (or IMAP / POP), the limit is about 100 recipients per day.
                          </p>
                          <p>
                            Each account has different limits—Google sets them based on your sending behaviour. Start with a small volume and gradually increase to avoid hitting limits or affecting deliverability.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border bg-card p-4 space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400">
                            <Mail className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-semibold">Gmail</p>
                            <p className="text-sm text-muted-foreground">
                              Connect your Gmail accounts to send and track emails
                            </p>
                            <Link
                              href="/campaign-replies"
                              className="text-xs text-primary hover:underline mt-1 inline-block"
                            >
                              How we read campaign replies
                            </Link>
                          </div>
                        </div>
                        <p className="text-sm font-medium">Connect Gmail</p>
                        <p className="text-xs text-muted-foreground -mt-1">
                          Choose how you want to connect: sign in with Google
                          (OAuth) or use an app password.
                        </p>
                        <Tabs
                          value={gmailConnectTab}
                          onValueChange={(v) =>
                            setGmailConnectTab(v as "oauth" | "app_password")
                          }
                          className="w-full"
                        >
                          <TabsList className="grid w-full max-w-md grid-cols-2 h-11 rounded-lg border border-border bg-muted/30 p-1 gap-1">
                            <TabsTrigger
                              value="oauth"
                              disabled={isFreePlan}
                              className="rounded-md gap-2 px-3 text-sm font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border disabled:opacity-60 flex items-center justify-center"
                            >
                              <span className="truncate">With Google (OAuth)</span>
                              {isFreePlan && (
                                <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                  Premium
                                </span>
                              )}
                            </TabsTrigger>
                            <TabsTrigger
                              value="app_password"
                              className="rounded-md px-3 text-sm font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border flex items-center justify-center"
                            >
                              With App Password
                            </TabsTrigger>
                          </TabsList>
                          <TabsContent value="oauth" className="mt-4 space-y-2">
                            {isFreePlan ? (
                              <div className="rounded-lg border bg-muted/30 p-4">
                                <p className="text-sm text-muted-foreground">
                                  Connect with Google (OAuth) is available on Premium. Use App Password above or upgrade to unlock.
                                </p>
                                <Link href="/pricing" className="text-xs text-primary font-medium hover:underline mt-2 inline-block">
                                  View plans
                                </Link>
                              </div>
                            ) : (
                              <>
                            {!gmailOAuthStatus?.app_default_enabled && (
                              <>
                                <p className="text-xs text-muted-foreground">
                                  Add your Google Client ID and Secret once; then you
                                  can connect Gmail accounts by signing in with
                                  Google.
                                </p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {googleOAuthConfig?.user_oauth_configured && (
                                    <span className="text-xs text-muted-foreground">
                                      Credentials saved
                                    </span>
                                  )}
                                  <Button
                                    variant="default"
                                    size="sm"
                                    onClick={() => setShowGmailConnectModal(true)}
                                  >
                                    {googleOAuthConfig?.user_oauth_configured
                                      ? "Edit credentials"
                                      : "Add credentials"}
                                  </Button>
                                  {googleOAuthConfig?.user_oauth_configured && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-destructive transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
                                      onClick={async () => {
                                        const ok = await confirmDialog({
                                          title: "Remove Google OAuth credentials",
                                          description:
                                            "Remove your stored credentials? You will need to add them again to connect Gmail with Google sign-in.",
                                          variant: "destructive",
                                        });
                                        if (!ok) return;
                                        try {
                                        await updateGoogleOAuthConfig.mutateAsync({
                                          google_client_id: "",
                                          google_client_secret: "",
                                        });
                                      } catch {
                                          // toast from mutation
                                        }
                                      }}
                                      disabled={
                                        updateGoogleOAuthConfig.isPending
                                      }
                                    >
                                      Remove
                                    </Button>
                                  )}
                                </div>
                              </>
                            )}
                              </>
                            )}
                          </TabsContent>
                          <TabsContent value="app_password" className="mt-4">
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              Use your Gmail address and an app password (from
                              Google Account settings). Add or manage accounts
                              in Connected accounts below.
                            </p>
                          </TabsContent>
                        </Tabs>

                        <Separator className="my-4" />

                        <div className="space-y-3">
                          <div className="text-sm font-medium text-muted-foreground">
                            Connected accounts
                          </div>
                          {(gmailStatus?.accounts?.length ?? 0) > 0 ? (
                            <>
                              <ul className="space-y-2">
                                {(gmailStatus?.accounts ?? []).map((account) => (
                                  <li
                                    key={account.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <CheckCircle className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500" />
                                      <span className="truncate font-medium text-sm">
                                        {account.email}
                                      </span>
                                      <Badge
                                        variant="secondary"
                                        className="shrink-0 text-xs"
                                      >
                                        {account.sent_today}/50 today
                                      </Badge>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          handleOpenGmailConnectionTest(account)
                                        }
                                      >
                                        Test
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-destructive transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() =>
                                          handleDisconnectGmail(account)
                                        }
                                        disabled={disconnectGmail.isPending}
                                      >
                                        Disconnect
                                      </Button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (isFreePlan && gmailConnectTab === "oauth") {
                                    router.push("/settings?tab=billing");
                                    return;
                                  }
                                  if (gmailConnectTab === "oauth") {
                                    handleConnectGmail();
                                  } else {
                                    if (checkGmailLimit()) return;
                                    setShowGmailAppPasswordModal(true);
                                  }
                                }}
                                disabled={
                                  gmailConnectTab === "oauth" && gmailAuth.isPending
                                }
                                className="transition-colors duration-200"
                              >
                                {gmailConnectTab === "oauth" && gmailAuth.isPending
                                  ? "Connecting..."
                                  : isFreePlan && gmailConnectTab === "oauth"
                                    ? "Upgrade for Google sign-in"
                                    : gmailConnectTab === "oauth"
                                      ? "Connect with Google"
                                      : "Connect via App Password"}
                              </Button>
                            </>
                          ) : (
                            <div className="rounded-lg border border-dashed p-4 space-y-3">
                              <p className="text-sm text-muted-foreground">
                                No Gmail account connected yet. Choose a method
                                above and click the button below.
                              </p>
                              <Button
                                onClick={() => {
                                  if (isFreePlan && gmailConnectTab === "oauth") {
                                    router.push("/settings?tab=billing");
                                    return;
                                  }
                                  if (gmailConnectTab === "oauth") {
                                    handleConnectGmail();
                                  } else {
                                    if (checkGmailLimit()) return;
                                    setShowGmailAppPasswordModal(true);
                                  }
                                }}
                                disabled={
                                  gmailConnectTab === "oauth" && gmailAuth.isPending
                                }
                                className="transition-colors duration-200"
                              >
                                {gmailConnectTab === "oauth" && gmailAuth.isPending
                                  ? "Connecting..."
                                  : isFreePlan && gmailConnectTab === "oauth"
                                    ? "Upgrade for Google sign-in"
                                    : gmailConnectTab === "oauth"
                                      ? "Connect with Google"
                                      : "Connect via App Password"}
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground space-y-2">
                          <p className="font-medium text-foreground">Gmail sending limits (approx.)</p>
                          <p>
                            For personal Gmail (@gmail.com): when using the web interface or OAuth2 API you can send to about 500 recipients per day. When using SMTP with an app password (or IMAP / POP), the limit is about 100 recipients per day.
                          </p>
                          <p>
                            Each account has different limits—Google sets them based on your sending behaviour. Start with a small volume and gradually increase to avoid hitting limits or affecting deliverability.
                          </p>
                        </div>
                      </div>
                    )}

                    <Dialog
                      open={showGmailConnectModal}
                      onOpenChange={setShowGmailConnectModal}
                    >
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Connect Gmail with Google (OAuth)</DialogTitle>
                          <DialogDescription>
                            Add your Google Client ID and Secret from Google
                            Cloud Console. After saving, you can connect Gmail
                            accounts by signing in with Google.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          {!gmailOAuthStatus?.app_default_enabled && (
                            <div className="space-y-2">
                              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                                  <p className="text-xs text-muted-foreground">
                                    Get Client ID and Secret from Google Cloud
                                    Console → APIs &amp; Services → Credentials.
                                  </p>
                                  <div className="space-y-2">
                                    <Label className="text-xs">
                                      Google Client ID
                                    </Label>
                                    <Input
                                      type="text"
                                      placeholder="xxxxx.apps.googleusercontent.com"
                                      value={googleClientId}
                                      onChange={(e) =>
                                        setGoogleClientId(e.target.value)
                                      }
                                      className="font-mono text-sm"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label className="text-xs">
                                      Google Client Secret
                                    </Label>
                                    <Input
                                      type="password"
                                      placeholder="GOCSPX-xxxxx"
                                      value={googleClientSecret}
                                      onChange={(e) =>
                                        setGoogleClientSecret(e.target.value)
                                      }
                                      className="font-mono text-sm"
                                    />
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      try {
                                        await updateGoogleOAuthConfig.mutateAsync({
                                          google_client_id: googleClientId || undefined,
                                          google_client_secret:
                                            googleClientSecret || undefined,
                                        });
                                        setGoogleClientSecret("");
                                      } catch {
                                        // toast from mutation
                                      }
                                    }}
                                    disabled={
                                      updateGoogleOAuthConfig.isPending
                                    }
                                  >
                                    {updateGoogleOAuthConfig.isPending
                                      ? "Saving..."
                                      : "Save"}
                                  </Button>
                                  <div className="rounded-lg border border-dashed bg-muted/20 p-3 space-y-1.5">
                                    <p className="text-xs font-medium text-muted-foreground">
                                      Add this URL to{" "}
                                      <strong>Authorized redirect URIs</strong>{" "}
                                      in your Google Cloud Console OAuth client:
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
                                        {gmailCallbackUrl}
                                      </code>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="shrink-0"
                                        onClick={() => {
                                          navigator.clipboard.writeText(
                                            (process.env.NEXT_PUBLIC_API_URL ?? "").replace(
                                              /\/api\/?$/,
                                              ""
                                            ) + "/api/gmail/callback"
                                          );
                                          toast.success("Redirect URI copied");
                                        }}
                                      >
                                        Copy
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              {!gmailOAuthStatus?.user_oauth_configured && (
                                <p className="text-xs text-muted-foreground">
                                  Save your credentials above, then use
                                  &quot;Connect with Google&quot; in Connected
                                  accounts to add Gmail.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Dialog open={showGmailAppPasswordModal} onOpenChange={setShowGmailAppPasswordModal}>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader className="space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Mail className="h-5 w-5" />
                            </div>
                            <div>
                              <DialogTitle className="text-base">Connect Gmail Account</DialogTitle>
                              <DialogDescription className="text-xs text-muted-foreground">
                                Sign in using an app password
                              </DialogDescription>
                            </div>
                          </div>
                        </DialogHeader>

                        <Separator />

                        <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Your Gmail account must have{" "}
                            <a
                              href="https://myaccount.google.com/security"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline underline-offset-2 hover:no-underline"
                            >
                              2-Step Verification
                            </a>{" "}
                            enabled. Then generate an app password under{" "}
                            <a
                              href="https://myaccount.google.com/apppasswords"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline underline-offset-2 hover:no-underline"
                            >
                              Google Account → App Passwords
                            </a>
                            .
                          </p>
                        </div>

                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              Gmail Address
                            </Label>
                            <Input
                              type="email"
                              placeholder="you@gmail.com"
                              value={gmailAppPasswordEmail}
                              onChange={(e) => setGmailAppPasswordEmail(e.target.value)}
                              className="h-9"
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                              App Password
                            </Label>
                            <Input
                              type="password"
                              placeholder="xxxx xxxx xxxx xxxx"
                              value={gmailAppPasswordPassword}
                              onChange={(e) => setGmailAppPasswordPassword(e.target.value)}
                              className="h-9"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              16-character password generated by Google — not your regular password.
                            </p>
                          </div>
                        </div>

                        <DialogFooter className="gap-2 sm:gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowGmailAppPasswordModal(false)}
                            disabled={addGmailAppPassword.isPending}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={async () => {
                              const email = gmailAppPasswordEmail.trim();
                              const password = gmailAppPasswordPassword;
                              if (!email || !password) {
                                toast.error("Please enter both your email and app password.");
                                return;
                              }
                              if (checkGmailLimit()) return;
                              try {
                                await addGmailAppPassword.mutateAsync({ userId, email, password });
                                setGmailAppPasswordEmail("");
                                setGmailAppPasswordPassword("");
                                refetchGmail();
                                setShowGmailAppPasswordModal(false);
                              } catch {
                                // toast from hook
                              }
                            }}
                            disabled={addGmailAppPassword.isPending}
                          >
                            {addGmailAppPassword.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                Connecting…
                              </>
                            ) : (
                              "Connect Account"
                            )}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    <Dialog
                      open={gmailConnectionTestOpen}
                      onOpenChange={(open) => {
                        setGmailConnectionTestOpen(open);
                        if (!open) {
                          setGmailConnectionTestAccount(null);
                          setGmailConnectionTestToEmail("");
                        }
                      }}
                    >
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Send connection test</DialogTitle>
                          <DialogDescription>
                            Send a short test message from{" "}
                            <span className="font-medium text-foreground">
                              {gmailConnectionTestAccount?.email ?? "this account"}
                            </span>{" "}
                            to verify sending works (OAuth or app password).
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2 py-1">
                          <Label htmlFor="gmail-connection-test-to">Recipient email</Label>
                          <Input
                            id="gmail-connection-test-to"
                            type="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            value={gmailConnectionTestToEmail}
                            onChange={(e) => setGmailConnectionTestToEmail(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleSendGmailConnectionTest();
                              }
                            }}
                          />
                        </div>
                        <DialogFooter className="gap-2 sm:gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setGmailConnectionTestOpen(false)}
                            disabled={gmailConnectionTestPending}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void handleSendGmailConnectionTest()}
                            disabled={gmailConnectionTestPending}
                          >
                            {gmailConnectionTestPending ? (
                              <>
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                Sending…
                              </>
                            ) : (
                              "Send test"
                            )}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    {/* Reply-To (for campaigns) — after Gmail */}
                    <div className="rounded-xl border bg-card p-4 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Mail className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-semibold">Reply-To (for campaigns)</p>
                          <p className="text-sm text-muted-foreground">
                            Choose where replies to campaign emails go. Used when
                            creating campaigns.
                          </p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <Label>Default Reply-To</Label>
                        <Select
                          value={defaultReplyToType}
                          onValueChange={(v) => {
                            if (v === "none") handleDefaultReplyToChange("none", null);
                            else setDefaultReplyToType(v);
                          }}
                        >
                          <SelectTrigger className="w-full max-w-xs pl-2 text-left">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {planAllowsGoogle && (
                              <SelectItem value="gmail">Gmail</SelectItem>
                            )}
                            <SelectItem value="imap">IMAP</SelectItem>
                          </SelectContent>
                        </Select>
                        {defaultReplyToType === "gmail" && (
                          <div className="space-y-2">
                            <Label>Gmail account</Label>
                            <Select
                              value={defaultReplyToId ?? ""}
                              onValueChange={(v) =>
                                handleDefaultReplyToChange("gmail", v || null)
                              }
                            >
                              <SelectTrigger className="w-full max-w-xs pl-2 text-left">
                                <SelectValue placeholder="Select Gmail account" />
                              </SelectTrigger>
                              <SelectContent>
                                {inboxes
                                  .filter((i) => i.sender_type === "gmail")
                                  .map((inb) => (
                                    <SelectItem key={inb.id} value={inb.id}>
                                      {inb.email}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {defaultReplyToType === "imap" && (
                          <div className="space-y-2">
                            <Label>IMAP account</Label>
                            <Select
                              value={defaultReplyToId ?? ""}
                              onValueChange={(v) =>
                                handleDefaultReplyToChange("imap", v || null)
                              }
                            >
                              <SelectTrigger className="w-full max-w-xs pl-2 text-left">
                                <SelectValue placeholder="Select or add IMAP account" />
                              </SelectTrigger>
                              <SelectContent>
                                {replyToImapConfigs.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.email} ({c.imap_host})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowAddImapDialog(true)}
                              >
                                Add IMAP account
                              </Button>
                              {replyToImapConfigs.map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-center gap-2 rounded-lg border px-3 py-2"
                                >
                                  <span className="text-sm">{c.email}</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => testReplyToImap.mutate(c.id)}
                                    disabled={testReplyToImap.isPending}
                                  >
                                    Test
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="text-destructive transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
                                    onClick={async () => {
                                      const ok = await confirmDialog({
                                        title: "Remove IMAP account",
                                        description: `Remove ${c.email}?`,
                                        variant: "destructive",
                                      });
                                      if (ok) deleteReplyToImap.mutate(c.id);
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <Dialog
                      open={showAddImapDialog}
                      onOpenChange={(open) => {
                        setShowAddImapDialog(open);
                        if (!open) setImapProvider("other");
                      }}
                    >
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add Reply-To IMAP account</DialogTitle>
                          <DialogDescription>
                            Connect an IMAP mailbox to use as Reply-To for campaigns.
                            Replies will be detected from this inbox.
                          </DialogDescription>
                        </DialogHeader>
                        <Card className="border-muted bg-muted/50">
                          <CardContent className="pt-4 pb-4 text-sm text-muted-foreground">
                            IMAP email and password stay the same as your SMTP credentials.
                          </CardContent>
                        </Card>
                        <div className="grid gap-4 py-4">
                          <div className="space-y-2">
                            <Label>Email provider</Label>
                            <Select
                              value={imapProvider}
                              onValueChange={(v) => {
                                setImapProvider(v);
                                const preset = IMAP_PROVIDERS.find((p) => p.id === v);
                                if (preset?.host) {
                                  setImapForm((f) => ({
                                    ...f,
                                    imap_host: preset.host,
                                    imap_port: preset.port,
                                    imap_username: f.imap_username || f.email,
                                  }));
                                } else {
                                  setImapForm((f) => ({
                                    ...f,
                                    imap_host: "",
                                    imap_port: 993,
                                  }));
                                }
                              }}
                            >
                              <SelectTrigger className="w-full pl-2 text-left">
                                <SelectValue placeholder="Choose provider" />
                              </SelectTrigger>
                              <SelectContent>
                                {IMAP_PROVIDERS.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Email</Label>
                            <Input
                              type="email"
                              placeholder="you@example.com"
                              value={imapForm.email}
                              onChange={(e) =>
                                setImapForm((f) => ({
                                  ...f,
                                  email: e.target.value,
                                  imap_username: f.imap_username || e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>IMAP host</Label>
                            <Input
                              placeholder="e.g. imap.gmail.com"
                              value={imapForm.imap_host}
                              onChange={(e) =>
                                setImapForm((f) => ({ ...f, imap_host: e.target.value }))
                              }
                              readOnly={imapProvider !== "other"}
                              className={
                                imapProvider !== "other" ? "bg-muted" : undefined
                              }
                            />
                            {imapProvider !== "other" && (
                              <p className="text-xs text-muted-foreground">
                                Pre-filled for{" "}
                                {IMAP_PROVIDERS.find((p) => p.id === imapProvider)?.name}.
                                Use &quot;Other (custom)&quot; to enter your own.
                              </p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label>IMAP port</Label>
                            <Input
                              type="number"
                              placeholder="993"
                              value={imapForm.imap_port}
                              onChange={(e) =>
                                setImapForm((f) => ({
                                  ...f,
                                  imap_port: parseInt(e.target.value, 10) || 993,
                                }))
                              }
                              readOnly={imapProvider !== "other"}
                              className={
                                imapProvider !== "other" ? "bg-muted" : undefined
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Username</Label>
                            <Input
                              placeholder="Usually your full email address"
                              value={imapForm.imap_username}
                              onChange={(e) =>
                                setImapForm((f) => ({
                                  ...f,
                                  imap_username: e.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Password / App password</Label>
                            <Input
                              type="password"
                              placeholder="••••••••"
                              value={imapForm.imap_password}
                              onChange={(e) =>
                                setImapForm((f) => ({
                                  ...f,
                                  imap_password: e.target.value,
                                }))
                              }
                            />
                            <p className="text-xs text-muted-foreground">
                              Gmail and some providers require an app password instead
                              of your regular password.
                            </p>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setShowAddImapDialog(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleAddImapSubmit}
                            disabled={createReplyToImap.isPending}
                          >
                            {createReplyToImap.isPending ? "Adding…" : "Add"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                      </TabsContent>

                      <TabsContent value="ai" className="space-y-6 p-6 mt-0">
                    <Card id="aiprovider">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="flex items-center gap-2">
                              <Sparkles className="w-5 h-5" />
                              AI Providers
                            </CardTitle>
                            <CardDescription>
                              Configure LLM API keys for AI-powered features
                            </CardDescription>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowLLMForm(!showLLMForm)}
                          >
                            {showLLMForm ? "Cancel" : "Add Provider"}
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {showLLMForm && (
                          <div className="p-4 rounded-lg border space-y-4">
                            <div className="space-y-2">
                              <Label>Provider</Label>
                              <Select
                                value={llmProvider}
                                onValueChange={setLlmProvider}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                  {llmProviders.map((provider) => (
                                    <SelectItem
                                      key={provider.value}
                                      value={provider.value}
                                    >
                                      {provider.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>API Key</Label>
                              <Input
                                type="password"
                                placeholder="Enter API key"
                                value={llmApiKey}
                                onChange={(e) => setLlmApiKey(e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Model Name (Optional)</Label>
                              <Input
                                placeholder={
                                  llmProvider
                                    ? llmProviders.find(
                                        (p) => p.value === llmProvider
                                      )?.defaultModel
                                    : "Model name"
                                }
                                value={llmModelName}
                                onChange={(e) =>
                                  setLlmModelName(e.target.value)
                                }
                              />
                            </div>
                            <Button
                              onClick={handleSaveLLMConfig}
                              disabled={
                                saveLLMConfig.isPending ||
                                !llmProvider ||
                                !llmApiKey
                              }
                              className="w-full"
                            >
                              {saveLLMConfig.isPending
                                ? "Saving..."
                                : "Save Configuration"}
                            </Button>
                          </div>
                        )}

                        <div className="space-y-2">
                          {llmConfigs.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No LLM providers configured yet.
                            </p>
                          ) : (
                            llmConfigs.map((config) => (
                              <div
                                key={config.provider}
                                className="flex items-center justify-between p-3 rounded-lg border"
                              >
                                <div className="flex items-center gap-3">
                                  <Sparkles className="w-5 h-5 text-primary" />
                                  <div>
                                    <p className="font-medium capitalize">
                                      {config.provider}
                                    </p>
                                    {config.model_name && (
                                      <p className="text-xs text-muted-foreground">
                                        Model: {config.model_name}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge className="bg-success text-white">
                                    Configured
                                  </Badge>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-destructive transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() =>
                                      handleDeleteLLMConfig(config.provider)
                                    }
                                    disabled={deleteLLMConfig.isPending}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="mt-6" id="serper">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Search className="w-5 h-5" />
                          Serper (Smart Leads)
                        </CardTitle>
                        <CardDescription>
                          API key for Google search via{" "}
                          <a
                            href="https://serper.dev"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            serper.dev
                          </a>
                          . Used by Smart Leads under Contacts to run web search. Stored encrypted.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {serperSettings?.serper_configured ? (
                            <Badge className="bg-success text-white">Configured</Badge>
                          ) : (
                            <Badge variant="secondary">Not set</Badge>
                          )}
                        </div>
                        <div className="space-y-2 max-w-md">
                          <Label htmlFor="serper-api-key">Serper API key</Label>
                          <Input
                            id="serper-api-key"
                            type="password"
                            autoComplete="off"
                            placeholder={serperSettings?.serper_configured ? "Enter new key to replace" : "Paste API key"}
                            value={serperApiKeyInput}
                            onChange={(e) => setSerperApiKeyInput(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Leave blank and save to clear the stored key. A server Serper fallback may still apply if
                            configured.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            onClick={() => {
                              updateSerperSettings.mutate(
                                { serper_api_key: serperApiKeyInput.trim() || "" },
                                {
                                  onSuccess: () => setSerperApiKeyInput(""),
                                }
                              );
                            }}
                            disabled={updateSerperSettings.isPending}
                          >
                            {updateSerperSettings.isPending ? "Saving…" : "Save Serper key"}
                          </Button>
                          {serperSettings?.serper_configured ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="text-destructive"
                              onClick={async () => {
                                const ok = await confirmDialog({
                                  title: "Remove Serper key",
                                  description: "Remove the stored Serper API key from your account?",
                                  variant: "destructive",
                                });
                                if (!ok) return;
                                updateSerperSettings.mutate({ serper_api_key: "" });
                              }}
                              disabled={updateSerperSettings.isPending}
                            >
                              Remove key
                            </Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>

                      </TabsContent>

                      <TabsContent value="deliverability" className="space-y-6 p-6 mt-0">
                    <Card id="zerobounce">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <ShieldCheck className="w-5 h-5" />
                          ZeroBounce (Smart Leads &amp; Remove Risky Emails)
                        </CardTitle>
                        <CardDescription>
                          <strong>Optional.</strong> API key for{" "}
                          <a
                            href="https://www.zerobounce.net"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            ZeroBounce
                          </a>{" "}
                          email validation. When configured, Smart Leads uses ZeroBounce for stronger mailbox
                          verification and catch‑all detection, and Remove Risky Emails can detect catch‑all domains.
                          Without it, both features fall back to syntax, MX record, and spam-list checks only.
                          Stored encrypted. Requests use ZeroBounce&apos;s US API host by default.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {zerobounceSettings?.zerobounce_configured ? (
                            <Badge className="bg-success text-white">Configured</Badge>
                          ) : (
                            <Badge variant="secondary">Not set</Badge>
                          )}
                        </div>
                        <div className="space-y-2 max-w-md">
                          <Label htmlFor="zerobounce-api-key">ZeroBounce API key</Label>
                          <Input
                            id="zerobounce-api-key"
                            type="password"
                            autoComplete="off"
                            placeholder={
                              zerobounceSettings?.zerobounce_configured ? "Enter new key to replace" : "Paste API key"
                            }
                            value={zerobounceApiKeyInput}
                            onChange={(e) => setZerobounceApiKeyInput(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Leave blank and save to clear the stored key. Without this key, catch‑all detection is
                            unavailable and Smart Leads uses basic checks only.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            onClick={() => {
                              updateZeroBounceSettings.mutate(
                                { zerobounce_api_key: zerobounceApiKeyInput.trim() || "" },
                                {
                                  onSuccess: () => setZerobounceApiKeyInput(""),
                                },
                              );
                            }}
                            disabled={updateZeroBounceSettings.isPending}
                          >
                            {updateZeroBounceSettings.isPending ? "Saving…" : "Save ZeroBounce key"}
                          </Button>
                          {zerobounceSettings?.zerobounce_configured ? (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setZerobounceTestOpen(true);
                                setZerobounceTestResult(null);
                                setZerobounceTestError(null);
                              }}
                            >
                              Test validate email
                            </Button>
                          ) : null}
                          {zerobounceSettings?.zerobounce_configured ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="text-destructive"
                              onClick={async () => {
                                const ok = await confirmDialog({
                                  title: "Remove ZeroBounce key",
                                  description: "Remove the stored ZeroBounce API key? Catch-all detection will be disabled until you add a key again.",
                                  variant: "destructive",
                                });
                                if (!ok) return;
                                updateZeroBounceSettings.mutate({ zerobounce_api_key: "" });
                              }}
                              disabled={updateZeroBounceSettings.isPending}
                            >
                              Remove key
                            </Button>
                          ) : null}
                        </div>
                        <Dialog open={zerobounceTestOpen} onOpenChange={setZerobounceTestOpen}>
                          <DialogContent className="sm:max-w-xl">
                            <DialogHeader>
                              <DialogTitle>Test ZeroBounce validate</DialogTitle>
                              <DialogDescription>
                                Calls <code>https://api.zerobounce.net/v2/validate</code> with your saved key and shows
                                the raw response.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-3">
                              <div className="space-y-1.5">
                                <Label htmlFor="zb-test-email">Email</Label>
                                <Input
                                  id="zb-test-email"
                                  placeholder="name@company.com"
                                  value={zerobounceTestEmail}
                                  onChange={(e) => setZerobounceTestEmail(e.target.value)}
                                />
                              </div>
                              <div className="space-y-1.5 max-w-xs">
                                <Label htmlFor="zb-test-timeout">Timeout seconds (3-60)</Label>
                                <Input
                                  id="zb-test-timeout"
                                  type="number"
                                  min={3}
                                  max={60}
                                  value={zerobounceTestTimeout}
                                  onChange={(e) => setZerobounceTestTimeout(Number(e.target.value) || 15)}
                                />
                              </div>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={zerobounceTestActivityData}
                                    onCheckedChange={(v) => setZerobounceTestActivityData(Boolean(v))}
                                  />
                                  Include activity data
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={zerobounceTestVerifyPlus}
                                    onCheckedChange={(v) => setZerobounceTestVerifyPlus(Boolean(v))}
                                  />
                                  Use Verify+
                                </label>
                              </div>
                              {zerobounceTestError ? (
                                <p className="text-sm text-destructive">{zerobounceTestError}</p>
                              ) : null}
                              {zerobounceTestResult ? (
                                <div className="rounded-md border bg-muted/40 p-3">
                                  <p className="text-xs text-muted-foreground mb-2">Result</p>
                                  <pre className="text-xs whitespace-pre-wrap break-all">
                                    {JSON.stringify(zerobounceTestResult, null, 2)}
                                  </pre>
                                </div>
                              ) : null}
                            </div>
                            <DialogFooter>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setZerobounceTestOpen(false)}
                              >
                                Close
                              </Button>
                              <Button
                                type="button"
                                disabled={zerobounceTestPending}
                                onClick={async () => {
                                  const email = zerobounceTestEmail.trim();
                                  if (!email) {
                                    setZerobounceTestError("Email is required");
                                    return;
                                  }
                                  setZerobounceTestPending(true);
                                  setZerobounceTestError(null);
                                  setZerobounceTestResult(null);
                                  try {
                                    const res = await api.settings.testZeroBounceValidate({
                                      email,
                                      timeout: Math.max(3, Math.min(60, Number(zerobounceTestTimeout) || 15)),
                                      activity_data: zerobounceTestActivityData,
                                      verify_plus: zerobounceTestVerifyPlus,
                                    });
                                    setZerobounceTestResult(res as unknown as Record<string, unknown>);
                                    if (res.ok) toast.success("Validation request sent successfully");
                                    else toast.error(res.error || "Validation request failed");
                                  } catch (e: unknown) {
                                    const message = e instanceof Error ? e.message : "Validation request failed";
                                    setZerobounceTestError(message);
                                    toast.error(message);
                                  } finally {
                                    setZerobounceTestPending(false);
                                  }
                                }}
                              >
                                {zerobounceTestPending ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Validating…
                                  </>
                                ) : (
                                  "Validate now"
                                )}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </CardContent>
                    </Card>

                      </TabsContent>

                      <TabsContent value="other" className="space-y-6 p-6 mt-0">
                    {/* Other integrations — OpenAI first */}
                    {integrations
                      .filter((i) => i.name !== "Gmail" && i.name === "OpenAI")
                      .map((integration, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-2xl" aria-hidden>
                              {integration.icon}
                            </span>
                            <div>
                              <p className="font-semibold">{integration.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {integration.description}
                              </p>
                            </div>
                          </div>
                          {integration.connected ? (
                            <Badge className="bg-success text-white shrink-0">
                              Connected
                            </Badge>
                          ) : (
                            <Button
                              className="shrink-0"
                              onClick={() => {
                                setLlmProvider("openai");
                                setShowLLMForm(true);
                                setTimeout(() => {
                                  document
                                    .getElementById("ai-providers-section")
                                    ?.scrollIntoView({ behavior: "smooth" });
                                }, 100);
                              }}
                            >
                              Connect
                            </Button>
                          )}
                        </div>
                      ))}

                    {/* Other integrations — Slack, Zapier, HubSpot, Salesforce */}
                    {integrations
                      .filter((i) => i.name !== "Gmail" && i.name !== "OpenAI")
                      .map((integration, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-2xl" aria-hidden>
                              {integration.icon}
                            </span>
                            <div>
                              <p className="font-semibold">{integration.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {integration.description}
                              </p>
                            </div>
                          </div>
                          {integration.connected ? (
                            <Button
                              variant="outline"
                              className="text-success shrink-0"
                              disabled
                            >
                              Connected
                            </Button>
                          ) : ["Slack", "Zapier", "HubSpot", "Salesforce"].includes(
                              integration.name
                            ) ? (
                            <Badge
                              variant="secondary"
                              className="flex items-center gap-1 shrink-0"
                            >
                              <Crown className="w-3 h-3 text-amber-500" />
                              On Demand
                            </Badge>
                          ) : (
                            <Button variant="outline" className="shrink-0">
                              Connect
                            </Button>
                          )}
                        </div>
                      ))}

                    <Card className="mt-6">
                      <CardHeader>
                        <CardTitle>Connected Domains</CardTitle>
                        <CardDescription>
                          Manage your verified domains
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {domains.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No domains connected yet.
                          </p>
                        ) : (
                          <div className="max-h-[280px] overflow-y-auto rounded-lg border pr-1 space-y-4">
                            {domains.map((domain) => (
                              <div
                                key={domain.id}
                                className="flex items-center justify-between p-3 rounded-lg border"
                              >
                                <div className="flex items-center gap-3">
                                  <Globe className="w-5 h-5 text-primary" />
                                  <div>
                                    <p className="font-medium">{domain.domain}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      {domain.spf_verified && (
                                        <CheckCircle className="w-3 h-3 text-success" />
                                      )}
                                      {domain.dkim_verified && (
                                        <CheckCircle className="w-3 h-3 text-success" />
                                      )}
                                      {domain.dmarc_verified && (
                                        <CheckCircle className="w-3 h-3 text-success" />
                                      )}
                                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                        Health: {domain.health_score}%
                                        <HealthScoreTooltip />
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <Badge
                                  variant={
                                    domain.status === "verified"
                                      ? "default"
                                      : "secondary"
                                  }
                                >
                                  {domain.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="mt-6">
                      <CardHeader>
                        <CardTitle>Email Inboxes</CardTitle>
                        <CardDescription>
                          Your configured email sending accounts
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {inboxes.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No inboxes configured yet.
                          </p>
                        ) : (
                          <div className="max-h-[280px] overflow-y-auto rounded-lg border pr-1 space-y-4">
                            {inboxes.map((inbox) => (
                              <div
                                key={inbox.id}
                                className="flex items-center justify-between p-3 rounded-lg border"
                              >
                                <div className="flex items-center gap-3">
                                  <Mail className="w-5 h-5 text-primary" />
                                  <div>
                                    <p className="font-medium">{inbox.email}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {inbox.sender_type.toUpperCase()} •{" "}
                                      {inbox.status}
                                    </p>
                                  </div>
                                </div>
                                <Badge
                                  variant={
                                    inbox.status === "ready" ? "default" : "secondary"
                                  }
                                >
                                  {inbox.status}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="mt-6">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Webhook className="w-5 h-5" />
                          Webhooks
                        </CardTitle>
                        <CardDescription>
                          Send real-time email events to your own systems
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <p className="text-sm text-muted-foreground max-w-xl">
                            Configure HTTPS endpoints to receive real-time webhooks when emails are
                            sent, opened, replied, or bounced. Use this to keep your CRM or internal
                            tools in sync.
                          </p>
                          <Button size="sm" onClick={openCreateWebhookDialog}>
                            Add webhook
                          </Button>
                        </div>

                        {webhooksError && (
                          <p className="text-sm text-destructive mb-3">
                            {webhooksError}
                          </p>
                        )}

                        {webhooksLoading && webhooks.length === 0 ? (
                          <div className="space-y-2">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                          </div>
                        ) : webhooks.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No webhooks configured yet. Click{" "}
                            <span className="font-medium">Add webhook</span> to get started.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {webhooks.map((wh) => (
                              <div
                                key={wh.id}
                                className="flex items-start justify-between gap-4 rounded-md border p-3"
                              >
                                <div className="space-y-1">
                                  <p className="text-sm font-medium break-all">
                                    {wh.url}
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {wh.events && wh.events.length > 0 ? (
                                      wh.events.map((ev) => {
                                        const meta = WEBHOOK_EVENTS.find(
                                          (e) => e.id === ev
                                        );
                                        return (
                                          <Badge
                                            key={ev}
                                            variant="outline"
                                            className="text-xs"
                                          >
                                            {meta?.label ?? ev}
                                          </Badge>
                                        );
                                      })
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        No events selected
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openEditWebhookDialog(wh)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteWebhook(wh.id)}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <Dialog open={webhookDialogOpen} onOpenChange={setWebhookDialogOpen}>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>
                                {webhookFormId ? "Edit webhook" : "Add webhook"}
                              </DialogTitle>
                              <DialogDescription>
                                Your endpoint must be an HTTPS URL that responds quickly with a 2xx
                                status code.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                              <div className="space-y-2">
                                <Label htmlFor="webhook-url">Webhook URL</Label>
                                <Input
                                  id="webhook-url"
                                  placeholder="https://your-app.com/api/pigeon-webhooks"
                                  value={webhookFormUrl}
                                  onChange={(e) => setWebhookFormUrl(e.target.value)}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label>Events</Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {WEBHOOK_EVENTS.map((event) => (
                                    <label
                                      key={event.id}
                                      className="flex items-center gap-2 text-sm"
                                    >
                                      <Checkbox
                                        checked={webhookFormEvents.includes(event.id)}
                                        onCheckedChange={() => toggleWebhookEvent(event.id)}
                                      />
                                      <span>{event.label}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <DialogFooter>
                              <Button
                                variant="outline"
                                onClick={() => setWebhookDialogOpen(false)}
                              >
                                Cancel
                              </Button>
                              <Button onClick={handleSaveWebhook} disabled={webhooksLoading}>
                                {webhookFormId ? "Save changes" : "Create webhook"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </CardContent>
                    </Card>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {activeTab === "compliance" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-warning" />
                      Spam Words
                    </CardTitle>
                    <CardDescription>
                      Words that trigger spam filters will be flagged
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Textarea
                      placeholder="Add spam words separated by comma..."
                      value={complianceSpamWords}
                      onChange={(e) => setComplianceSpamWords(e.target.value)}
                      rows={4}
                    />
                    <Button
                      onClick={handleSaveCompliance}
                      disabled={updateSettings.isPending}
                    >
                      {updateSettings.isPending ? "Saving..." : "Save Spam Words"}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Email Limits</CardTitle>
                    <CardDescription>
                      Set safety limits for your campaigns
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Max Links per Email</Label>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={complianceMaxLinks}
                          onChange={(e) =>
                            setComplianceMaxLinks(Number(e.target.value) || 3)
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Max Images per Email</Label>
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={complianceMaxImages}
                          onChange={(e) =>
                            setComplianceMaxImages(Number(e.target.value) || 2)
                          }
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-4 rounded-lg bg-secondary">
                      <div>
                        <p className="font-medium">Require Unsubscribe Link</p>
                        <p className="text-sm text-muted-foreground">
                          Add unsubscribe link to all emails
                        </p>
                      </div>
                      <Switch
                        checked={complianceRequireUnsub}
                        onCheckedChange={setComplianceRequireUnsub}
                      />
                    </div>
                    <Button
                      onClick={handleSaveCompliance}
                      disabled={updateSettings.isPending}
                    >
                      {updateSettings.isPending
                        ? "Saving..."
                        : "Save Settings"}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )}

            {activeTab === "billing" && user && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {showStartPlansCard && (
                  <Card className="relative overflow-hidden border-2 border-amber-200/60 bg-gradient-to-br from-white via-amber-50/40 to-orange-50/30 shadow-lg hover:shadow-2xl transition-all duration-300 dark:border-amber-400/35 dark:bg-gradient-to-br dark:from-[#1a1204] dark:via-[#14110a] dark:to-[#1a0d06] dark:shadow-amber-950/40">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-amber-200/20 to-orange-200/20 rounded-full blur-3xl -z-0 dark:from-amber-500/15 dark:to-orange-500/15" />
                    <div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-orange-200/15 to-amber-200/15 rounded-full blur-2xl -z-0 dark:from-orange-500/12 dark:to-amber-500/12" />
                    <CardHeader className="pb-6 relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-8">
                      <div className="flex items-start gap-4 flex-1">
                        <div className="relative">
                          <div className="absolute inset-0 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl blur-md opacity-60" />
                          <div className="relative bg-gradient-to-br from-amber-400 to-orange-500 p-3 rounded-xl shadow-lg">
                            <Crown className="w-7 h-7 text-white drop-shadow-md" />
                          </div>
                        </div>
                        <div className="flex-1 pt-0.5">
                          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-amber-700 via-orange-600 to-amber-700 bg-clip-text text-transparent mb-2 leading-tight dark:bg-none dark:text-amber-200">
                            {isPendingSubscription
                              ? "Complete Your Upgrade"
                              : "Unlock Premium Features"}
                          </CardTitle>
                          <CardDescription className="text-base leading-relaxed text-gray-600 dark:text-amber-50/90">
                            {isPendingSubscription ? (
                              <>
                                Your subscription is almost ready!
                                <span className="block mt-1 text-amber-700 font-medium dark:text-amber-200">
                                  Complete payment to activate your premium plan.
                                </span>
                              </>
                            ) : (
                              <>
                                Start your{" "}
                                <span className="font-semibold text-amber-700 dark:text-amber-200">
                                  Custom plans
                                </span>{" "}
                                and experience the full power of our platform.
                                <span className="block mt-1 text-sm text-gray-500 dark:text-amber-100/75">
                                  Custom plans • Cancel anytime
                                </span>
                              </>
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      {!isPendingSubscription && (
                        <div className="flex flex-col items-end gap-3 min-w-fit mt-4 md:mt-0">
                          <div className="bg-white/80 backdrop-blur-sm rounded-lg px-4 py-2 border border-amber-200/50 shadow-sm dark:bg-amber-100/10 dark:border-amber-300/30">
                            <label className="flex items-center gap-3 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={billAnnually}
                                onChange={(e) =>
                                  setBillAnnually(e.target.checked)
                                }
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-amber-500 peer-checked:to-orange-500 relative inline-block dark:bg-amber-100/20 dark:after:bg-amber-50 dark:after:border-amber-200/60" />
                              <span className="text-sm font-medium text-gray-700 group-hover:text-amber-700 transition-colors dark:text-amber-100 dark:group-hover:text-amber-200">
                                Bill annually
                                <span className="block text-xs text-amber-600 font-semibold dark:text-amber-300">
                                  Save 17%
                                </span>
                              </span>
                            </label>
                          </div>
                          <Link
                            href={billAnnually ? "/pricing?type=annual" : "/pricing"}
                          >
                            <Button
                              size="lg"
                              className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-600 hover:via-orange-600 hover:to-amber-600 text-white text-base font-bold px-10 py-6 shadow-xl hover:shadow-2xl transition-all duration-300 rounded-xl border-2 border-amber-400/40 hover:border-amber-300 whitespace-nowrap"
                            >
                              Talk to us
                            </Button>
                          </Link>
                        </div>
                      )}
                    </CardHeader>
                    {isPendingSubscription && razorpaySubscription?.short_url && (
                      <CardContent className="pt-0 pb-6 relative z-10">
                        <div className="bg-amber-50/50 backdrop-blur-sm rounded-xl p-5 border border-amber-200/50 dark:bg-amber-100/10 dark:border-amber-300/30">
                          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-end">
                            <Button
                              size="lg"
                              className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white"
                              onClick={() =>
                                window.open(razorpaySubscription.short_url!, "_blank")
                              }
                            >
                              Complete Payment
                            </Button>
                            <Button
                              size="lg"
                              variant="outline"
                              onClick={async () => {
                                const confirmed = await confirmDialog({
                                  title: "Cancel pending subscription",
                                  description:
                                    "This will cancel your pending subscription. You can choose a different plan afterwards.",
                                  confirmLabel: "Cancel subscription",
                                  variant: "destructive",
                                });
                                if (confirmed) handleCancelSubscription();
                              }}
                            >
                              Cancel & Choose Different Plan
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle>Subscription & Billing</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      <div className="p-6 rounded-lg gradient-primary text-white">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-4">
                            <div>
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <Badge className="bg-white/20 text-white text-sm">
                                  {user.plan?.name ?? "Free"} Plan
                                </Badge>
                                {razorpaySubscription?.subscription && (
                                  <Badge
                                    variant="outline"
                                    className={`border-white/30 text-xs ${
                                      razorpaySubscription.subscription.status === "active"
                                        ? "bg-green-500/20 text-white"
                                        : "bg-yellow-500/20 text-white"
                                    }`}
                                  >
                                    {razorpaySubscription.subscription.status ===
                                    "created"
                                      ? "Payment Pending"
                                      : razorpaySubscription.subscription.status ===
                                          "active"
                                        ? "Active"
                                        : razorpaySubscription.subscription.status}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-3xl font-bold mb-1">
                                {user.plan?.price === "Custom"
                                  ? "Custom Pricing"
                                  : user.plan?.price === "0"
                                    ? "Free"
                                    : isIndia
                                      ? `₹${(Number(user.plan?.price ?? "0") * 100).toLocaleString("en-IN")}`
                                      : `$${user.plan?.price ?? "0"}`}
                                {user.plan?.price !== "Custom" &&
                                  user.plan?.price !== "0" && (
                                    <span className="text-lg font-normal opacity-80">
                                      /month
                                    </span>
                                  )}
                              </p>
                            </div>
                            {canClaimFreeTrial && (
                              <div className="rounded-xl border border-amber-300/50 bg-gradient-to-r from-amber-50/95 via-orange-50/90 to-amber-100/90 px-4 py-3 dark:border-amber-300/40 dark:bg-gradient-to-r dark:from-amber-400/15 dark:via-orange-400/10 dark:to-amber-500/15">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                                    Step up to claim your free premium trial
                                  </p>
                                  <Link href="/pricing" className="inline-flex">
                                    <Button
                                      size="sm"
                                      className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white hover:from-amber-600 hover:via-orange-600 hover:to-amber-600"
                                    >
                                      Upgrade
                                    </Button>
                                  </Link>
                                </div>
                              </div>
                            )}
                            {user.usage != null && user.limits != null && (
                              <div className="space-y-2 text-sm">
                                <p className="font-medium opacity-90">
                                  Current Usage
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                  <div className="bg-white/10 rounded px-3 py-2">
                                    <p className="opacity-80 text-xs">Domains</p>
                                    <p className="font-semibold">
                                      {user.usage.domains} /{" "}
                                      {user.limits.max_domains === -1
                                        ? "∞"
                                        : user.limits.max_domains}
                                    </p>
                                  </div>
                                  <div className="bg-white/10 rounded px-3 py-2">
                                    <p className="opacity-80 text-xs">
                                      Active Campaigns
                                    </p>
                                    <p className="font-semibold">
                                      {(user.usage as { active_campaigns?: number })
                                        .active_campaigns ??
                                        (user.usage as { campaigns_active?: number })
                                          .campaigns_active ??
                                        user.usage.campaigns}{" "}
                                      /{" "}
                                      {user.limits.max_campaigns === -1
                                        ? "∞"
                                        : user.limits.max_campaigns}
                                    </p>
                                  </div>
                                  <div className="bg-white/10 rounded px-3 py-2">
                                    <p className="opacity-80 text-xs">
                                      Monthly SMTP emails
                                    </p>
                                    <p className="font-semibold">
                                      {user.limits.max_monthly_smtp_emails === -1
                                        ? `${(user.usage.smtp_emails_month ?? 0).toLocaleString()} / Unlimited`
                                        : `${(user.usage.smtp_emails_month ?? 0).toLocaleString()} / ${user.limits.max_monthly_smtp_emails.toLocaleString()}`}
                                    </p>
                                  </div>
                                  <div className="bg-white/10 rounded px-3 py-2">
                                    <p className="opacity-80 text-xs">
                                      Gmail monthly capacity
                                    </p>
                                    <p className="font-semibold">
                                      {user.plan?.max_google_accounts === -1
                                        ? `${(user.usage.gmail_emails_month ?? 0).toLocaleString()} / Unlimited`
                                        : `${(user.usage.gmail_emails_month ?? 0).toLocaleString()} / ${((user.plan?.max_google_accounts ?? 0) * 50 * 30).toLocaleString()}`}
                                    </p>
                                  </div>
                                </div>
                                <p className="text-[11px] opacity-80 mt-1">
                                  Monthly email usage is calculated per billing period for paid subscriptions (from your billing start date to the next renewal).
                                </p>
                              </div>
                            )}
                            {razorpaySubscription?.subscription && (
                              <div className="space-y-2 text-sm border-t border-white/20 pt-4">
                                <p className="font-medium opacity-90 flex items-center gap-2">
                                  <Calendar className="w-4 h-4" />
                                  Billing Details
                                </p>
                                <div className="space-y-1 opacity-90">
                                  {razorpaySubscription.subscription.billing_cycle && (
                                    <p>
                                      <span className="opacity-70">Billing: </span>
                                      {razorpaySubscription.subscription.billing_cycle ===
                                      "annual"
                                        ? "Annual"
                                        : "Monthly"}
                                    </p>
                                  )}
                                  {razorpaySubscription.subscription.charge_at != null && (
                                    <p className="flex items-center gap-2">
                                      <CreditCard className="w-3.5 h-3.5 opacity-70" />
                                      <span className="opacity-70">
                                        Next charge:{" "}
                                      </span>
                                      <span className="font-medium">
                                        {new Date(
                                          razorpaySubscription.subscription.charge_at * 1000
                                        ).toLocaleDateString(undefined, {
                                          day: "numeric",
                                          month: "short",
                                          year: "numeric",
                                        })}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-3 min-w-[180px]">
                            {isIndia && isPaidSubscription && (
                              <>
                                <div className="space-y-2 pb-3 border-b border-white/20">
                                  <p className="text-xs font-medium opacity-90">
                                    Upgrade Plan
                                  </p>
                                  <Select
                                    value={upgradePlanId}
                                    onValueChange={setUpgradePlanId}
                                  >
                                    <SelectTrigger className="w-full bg-white/10 border-white/20 text-white hover:bg-white/15">
                                      <SelectValue placeholder="Select plan..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {availableUpgradePlans.map((plan) => (
                                        <SelectItem key={plan.id} value={plan.id}>
                                          {plan.name}
                                        </SelectItem>
                                      ))}
                                      {!billingUpgradePlansLoading && availableUpgradePlans.length === 0 && (
                                        <SelectItem value="no-upgrade-plans" disabled>
                                          No upgrade plans available
                                        </SelectItem>
                                      )}
                                    </SelectContent>
                                  </Select>
                                  {upgradePlanId && (
                                    <div className="space-y-2">
                                      <label className="flex items-center gap-2 text-xs text-white/90 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={upgradeAtCycleEnd}
                                          onChange={(e) =>
                                            setUpgradeAtCycleEnd(e.target.checked)
                                          }
                                          className="cursor-pointer"
                                        />
                                        <span>Apply at billing period end</span>
                                      </label>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full bg-white text-primary"
                                        onClick={() =>
                                          handleUpdatePlan(
                                            upgradePlanId,
                                            upgradeAtCycleEnd
                                          )
                                        }
                                      >
                                        Confirm Upgrade
                                      </Button>
                                    </div>
                                  )}
                                </div>
                                <Link href="/pricing" className="block">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20"
                                  >
                                    View All Plans
                                  </Button>
                                </Link>
                                {razorpaySubscription?.short_url && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20"
                                    onClick={() =>
                                      window.open(
                                        razorpaySubscription.short_url!,
                                        "_blank"
                                      )
                                    }
                                  >
                                    Manage Subscription
                                  </Button>
                                )}
                                <div className="space-y-2 pt-3 border-t border-white/20">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full bg-red-500/20 border-red-400/40 text-white hover:bg-red-500/30"
                                    onClick={async () => {
                                      const confirmed = await confirmDialog({
                                        title: "Cancel Subscription",
                                        description: isInTrialPeriod
                                          ? "Your trial will be cancelled. You will not be charged."
                                          : "You will be charged on the due date. After that, your subscription will end and you will be downgraded to the Free plan.",
                                        confirmLabel: "Cancel Subscription",
                                        variant: "destructive",
                                      });
                                      if (confirmed) handleCancelSubscription();
                                    }}
                                  >
                                    Cancel Subscription
                                  </Button>
                                </div>
                              </>
                            )}
                            {!isIndia && isPaidSubscription && (
                              <>
                                <div className="space-y-2 pb-3 border-b border-white/20">
                                  <p className="text-xs font-medium opacity-90">
                                    Upgrade Plan
                                  </p>
                                  <Select
                                    value={upgradePlanId}
                                    onValueChange={setUpgradePlanId}
                                  >
                                    <SelectTrigger className="w-full bg-white/10 border-white/20 text-white hover:bg-white/15">
                                      <SelectValue placeholder="Select plan..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {availableUpgradePlans.map((plan) => (
                                        <SelectItem key={plan.id} value={plan.id}>
                                          {plan.name}
                                        </SelectItem>
                                      ))}
                                      {!billingUpgradePlansLoading && availableUpgradePlans.length === 0 && (
                                        <SelectItem value="no-upgrade-plans" disabled>
                                          No upgrade plans available
                                        </SelectItem>
                                      )}
                                    </SelectContent>
                                  </Select>
                                  {upgradePlanId && (
                                    <div className="space-y-2">
                                      <p className="text-[11px] text-white/80">
                                        Upgrades are applied immediately and the prorated
                                        difference is invoiced now.
                                      </p>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full bg-white text-primary"
                                        onClick={async () => {
                                          try {
                                            await api.billing.lemonSqueezy.updatePlanNow(
                                              upgradePlanId
                                            );
                                            toast.success("Plan upgraded immediately.");
                                            setUpgradePlanId("");
                                            refetchUser();
                                          } catch (e: unknown) {
                                            toast.error(
                                              e instanceof Error
                                                ? e.message
                                                : "Failed to update plan"
                                            );
                                          }
                                        }}
                                      >
                                        Confirm Upgrade Now
                                      </Button>
                                    </div>
                                  )}
                                </div>
                                <Link href="/pricing" className="block">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20"
                                  >
                                    View All Plans
                                  </Button>
                                </Link>
                              </>
                            )}
                            {isIndia && !razorpaySubscription?.subscription && (
                              <Link href="/pricing" className="block">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-full bg-white text-primary"
                                >
                                  View Plans
                                </Button>
                              </Link>
                            )}
                            {!isIndia && (
                              <Link href="/pricing" className="block">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full border-white/60 text-white bg-transparent hover:bg-white hover:text-primary hover:shadow-lg transition-colors"
                                >
                                  View Pricing
                                </Button>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Usage</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {user.usage != null && user.limits != null ? (
                      <>
                        <div>
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span>Domains</span>
                            <span>
                              {user.usage.domains} /{" "}
                              {user.limits.max_domains === -1
                                ? "∞"
                                : user.limits.max_domains}
                            </span>
                          </div>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full gradient-primary rounded-full"
                              style={{
                                width:
                                  user.limits.max_domains === -1 ||
                                  user.limits.max_domains === 0
                                    ? "0%"
                                    : `${Math.min(
                                        100,
                                        (user.usage.domains /
                                          user.limits.max_domains) *
                                          100
                                      )}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span>Active campaigns</span>
                            <span>
                              {(user.usage as { active_campaigns?: number })
                                .active_campaigns ??
                                (user.usage as { campaigns_active?: number })
                                  .campaigns_active ??
                                user.usage.campaigns}{" "}
                              /{" "}
                              {user.limits.max_campaigns === -1
                                ? "∞"
                                : user.limits.max_campaigns}
                            </span>
                          </div>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full gradient-primary rounded-full"
                              style={{
                                width:
                                  user.limits.max_campaigns === -1 ||
                                  user.limits.max_campaigns === 0
                                    ? "0%"
                                    : `${Math.min(
                                        100,
                                        (((user.usage as { active_campaigns?: number })
                                          .active_campaigns ??
                                          (user.usage as { campaigns_active?: number })
                                            .campaigns_active ??
                                          user.usage.campaigns) /
                                          user.limits.max_campaigns) *
                                          100
                                      )}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span>Domain inboxes (SMTP)</span>
                            <span>
                              {(user.usage as { smtp_inboxes?: number })
                                .smtp_inboxes ?? user.usage.inboxes} /{" "}
                              {user.limits.max_subdomains === -1
                                ? "∞"
                                : user.limits.max_subdomains}
                            </span>
                          </div>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full gradient-accent rounded-full"
                              style={{
                                width:
                                  user.limits.max_subdomains === -1 ||
                                  user.limits.max_subdomains === 0
                                    ? "0%"
                                    : `${Math.min(
                                        100,
                                        (((user.usage as { smtp_inboxes?: number })
                                          .smtp_inboxes ?? user.usage.inboxes) /
                                          user.limits.max_subdomains) *
                                          100
                                      )}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span>Max Google accounts</span>
                            <span>
                              {gmailAccountsUsed} /{" "}
                              {user.limits.max_google_accounts === -1
                                ? "∞"
                                : user.limits.max_google_accounts}
                            </span>
                          </div>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full gradient-accent rounded-full"
                              style={{
                                width:
                                  user.limits.max_google_accounts === -1 ||
                                  user.limits.max_google_accounts === 0
                                    ? "0%"
                                    : `${Math.min(100, (gmailAccountsUsed / user.limits.max_google_accounts) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div />
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Loading usage…
                      </p>
                    )}
                  </CardContent>
                </Card>

                {isIndia && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Payment Method</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {razorpaySubscription?.short_url ? (
                        <div className="flex items-center justify-between p-4 rounded-lg border">
                          <div className="flex items-center gap-4">
                            <CreditCard className="w-8 h-8 text-primary" />
                            <div>
                              <p className="font-medium">Managed by Razorpay</p>
                              <p className="text-sm text-muted-foreground">
                                {isPendingSubscription
                                  ? "Complete payment to activate your plan."
                                  : "Use the link below to update your payment method or manage your subscription."}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() =>
                              window.open(
                                razorpaySubscription.short_url!,
                                "_blank"
                              )
                            }
                          >
                            {isPendingSubscription
                              ? "Complete payment"
                              : "Manage subscription"}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Subscribe to a plan above to add a payment method.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {!isIndia && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Payment Method</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {lemonSqueezySubscription?.customer_portal_url ? (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between p-4 rounded-lg border">
                            <div className="flex items-center gap-4">
                              <CreditCard className="w-8 h-8 text-primary" />
                              <div>
                                <p className="font-medium">
                                  Managed by Lemon Squeezy
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  Update your payment method, cancel, or change plan
                                  in the Lemon Squeezy customer portal.
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              onClick={() =>
                                window.open(
                                  "https://app.lemonsqueezy.com/my-orders/login",
                                  "_blank"
                                )
                              }
                            >
                              Manage subscription
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground rounded-md bg-muted/60 p-3 border border-border/60">
                            <strong>Note:</strong> To upgrade or downgrade your plan,
                            manage your subscription from the Lemon Squeezy customer
                            portal using the button above.
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Subscribe to a plan on the Pricing page to add a payment
                          method.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </motion.div>
            )}
          </div>
          <UpgradeModal
            featureKey="inboxes"
            gate={gmailUpgradeOpen ? gmailGate : inboxGate}
            open={gmailUpgradeOpen}
            onOpenChange={setGmailUpgradeOpen}
          />
        </>
      )}

      <HelpLinks
        slugs={[
          "google-client-id-secret-gmail-setup",
          "connect-gmail-app-password-without-oauth",
          "set-up-reply-to-imap-campaign-replies",
          "why-gmail-connection-fails-how-to-fix",
          "redirect-uri-mismatch-fix-google-oauth-errors",
          "configure-compliance-settings-spam-words-links-unsubscribe",
          "set-up-notification-preferences-replies",
          "manage-security-active-sessions",
          "update-billing-subscription",
        ]}
        className="mt-6"
      />
    </div>
    </AppPageShell>
  );
}
