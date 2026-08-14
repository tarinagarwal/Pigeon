"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateInbox, useInboxes } from "@/hooks/useInboxes";
import { useDomains } from "@/hooks/useDomains";
import { toast } from "sonner";
import type { CreateInboxRequest, Domain } from "@/types/api";
import {
  getVerifiedBulkDistributionPool,
  getVerifiedRootDomains,
  normalizeFqdn,
} from "@/lib/domain-tree";
import { countInboxesForDomainPool, pickLeastLoadedDomain } from "@/lib/inbox-domain-balance";
import { AlertCircle, ArrowLeft, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";

const PREFILL_USERNAME_POOL = [
  "sarah", "michael", "laura", "james", "olivia", "daniel", "emma", "william", "sofia", "alexander",
  "noah", "ava", "liam", "isabella", "elijah", "mia", "lucas", "amelia", "mason", "harper",
  "logan", "evelyn", "ethan", "abigail", "jacob", "ella", "henry", "scarlett", "jack", "grace",
  "aiden", "chloe", "samuel", "victoria", "david", "riley", "joseph", "aria", "owen", "lily",
  "john", "zoey", "wyatt", "nora", "matthew", "hannah", "luke", "hazel", "gabriel", "aurora",
  "carter", "penelope", "isaac", "elena", "jayden", "violet", "julian", "stella", "levi", "lucy",
  "grayson", "paisley", "leo", "everly", "lincoln", "anna", "hudson", "caroline", "ezra", "nova",
  "thomas", "genesis", "charles", "emilia", "christopher", "kennedy", "joshua", "samantha", "andrew", "maya",
  "nathan", "willow", "ryan", "kinsley", "adrian", "naomi", "aaron", "eliana", "isaiah", "alice",
  "eli", "madelyn", "adam", "jasmine", "ian", "valentina", "cooper", "serenity", "roman", "athena",
] as const;

function getRandomPrefillUsernames(count: number): string[] {
  return [...PREFILL_USERNAME_POOL].sort(() => Math.random() - 0.5).slice(0, count);
}

const SMTP_PRESETS = [
  {
    id: "gmail",
    name: "Gmail",
    host: "smtp.gmail.com",
    port: "587",
    note: "Use an App Password",
    bg: "bg-red-500",
    label: "G",
  },
  {
    id: "outlook",
    name: "Outlook",
    host: "smtp-mail.outlook.com",
    port: "587",
    note: "Works with Microsoft accounts",
    bg: "bg-primary",
    label: "O",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    host: "smtp.mail.yahoo.com",
    port: "465",
    note: "Requires App Password",
    bg: "bg-primary",
    label: "Y",
  },
  {
    id: "office365",
    name: "Office 365",
    host: "smtp.office365.com",
    port: "587",
    note: "For business Microsoft 365",
    bg: "bg-primary",
    label: "365",
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    host: "smtp.zoho.com",
    port: "587",
    note: "Zoho business email",
    bg: "bg-red-700",
    label: "Z",
  },
  {
    id: "icloud",
    name: "iCloud",
    host: "smtp.mail.me.com",
    port: "587",
    note: "Apple ID required",
    bg: "bg-primary",
    label: "iC",
  },
  {
    id: "aol",
    name: "AOL Mail",
    host: "smtp.aol.com",
    port: "587",
    note: "AOL account credentials",
    bg: "bg-primary",
    label: "AOL",
  },
  {
    id: "protonmail",
    name: "Proton Mail",
    host: "smtp.protonmail.ch",
    port: "587",
    note: "Via Proton Bridge",
    bg: "bg-primary",
    label: "P",
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    host: "smtp.sendgrid.net",
    port: "587",
    note: "Use API key as password",
    bg: "bg-teal-600",
    label: "SG",
  },
  {
    id: "mailgun",
    name: "Mailgun",
    host: "smtp.mailgun.org",
    port: "587",
    note: "Domain + API key",
    bg: "bg-orange-500",
    label: "MG",
  },
  {
    id: "custom",
    name: "Custom",
    host: "",
    port: "587",
    note: "Enter manually",
    bg: "bg-gray-500",
    label: "···",
  },
] as const;

export default function NewInboxPage() {
  const router = useRouter();
  const { user, effectiveUserId } = useAuth();
  const userId = effectiveUserId;
  const confirmDialog = useConfirmDialog();
  const inboxGate = usePlanGate("inboxes");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const [senderType, setSenderType] = useState<"gmail" | "smtp">("smtp");
  const [email, setEmail] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [dailyLimit, setDailyLimit] = useState("50");
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [bulkUsernames, setBulkUsernames] = useState("");

  const [smtpProvider, setSmtpProvider] = useState<"custom" | "pigeon">("pigeon");
  const [smtpPreset, setSmtpPreset] = useState<string>("");

  const hasWarmupPlan = !!(user?.limits?.warmup || user?.plan?.warmup);
  // Default false: user can enable automated warmup when they want (even if plan includes warmup).
  const [autoWarmup, setAutoWarmup] = useState<boolean>(false);
  /** Tiered daily cap on campaign sends while inbox ages (backend enforces). */
  const [campaignRampup, setCampaignRampup] = useState<boolean>(true);

  const createInbox = useCreateInbox();
  const { data: inboxes = [], isLoading: inboxesLoading } = useInboxes(userId);
  const { data: domains, isLoading: domainsLoading } = useDomains();
  const verifiedDomains = useMemo(
    () => (domains ?? []).filter((domain) => domain.status === "verified"),
    [domains]
  );

  /** Apex / main domains only, for bulk SMTP — subdomains are filled via distribution. */
  const verifiedRootDomains = useMemo(
    () => getVerifiedRootDomains(domains ?? []),
    [domains]
  );

  const bulkDistributionPool = useMemo(
    () =>
      selectedDomainId ? getVerifiedBulkDistributionPool(selectedDomainId, domains ?? []) : [],
    [selectedDomainId, domains]
  );

  /** Existing inbox counts per domain in the current bulk pool (for display + least-loaded placement). */
  const bulkExistingInboxCounts = useMemo(
    () => countInboxesForDomainPool(inboxes, bulkDistributionPool),
    [inboxes, bulkDistributionPool]
  );

  useEffect(() => {
    if (mode !== "bulk" || senderType !== "smtp") return;
    if (!selectedDomainId) return;
    if (!verifiedRootDomains.some((d) => d.id === selectedDomainId)) {
      setSelectedDomainId("");
    }
  }, [mode, senderType, selectedDomainId, verifiedRootDomains]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (inboxGate.atLimit) {
      toast.error(inboxGate.upgradeLine || "Your current plan does not allow adding more inboxes.");
      setUpgradeOpen(true);
      return;
    }

    if (mode === "bulk" && senderType === "smtp") {
      if (!selectedDomainId) {
        toast.error("Please select a domain for bulk inbox creation");
        return;
      }
      if (smtpProvider === "custom") {
        toast.error(
          "Custom SMTP is not supported for bulk creation. Each SMTP account requires unique credentials. Please use Pigeon Provider for bulk inbox creation."
        );
        return;
      }

      const usernames = bulkUsernames
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter(Boolean);

      if (usernames.length === 0) {
        toast.error("Please enter at least one username");
        return;
      }

      const pool = getVerifiedBulkDistributionPool(selectedDomainId, domains ?? []);
      if (pool.length === 0) {
        toast.error("No domains available under this root to create inboxes.");
        return;
      }

      try {
        const loadCounts = countInboxesForDomainPool(inboxes, pool);
        for (const line of usernames) {
          const raw = line.trim();
          let targetDomain: Domain;
          let fullEmail: string;

          if (raw.includes("@")) {
            const at = raw.lastIndexOf("@");
            const host = normalizeFqdn(raw.slice(at + 1));
            const match = pool.find((d) => normalizeFqdn(d.domain) === host);
            if (!match) {
              toast.error(
                `Each address must use the selected root or one of its subdomains. Invalid: ${raw}`
              );
              return;
            }
            targetDomain = match;
            fullEmail = raw;
            loadCounts.set(match.id, (loadCounts.get(match.id) ?? 0) + 1);
          } else {
            targetDomain = pickLeastLoadedDomain(pool, loadCounts);
            loadCounts.set(targetDomain.id, (loadCounts.get(targetDomain.id) ?? 0) + 1);
            fullEmail = `${raw}@${targetDomain.domain}`;
          }

          const inboxData: CreateInboxRequest = {
            user_id: userId,
            email: fullEmail,
            sender_type: "smtp",
            daily_limit: Math.min(50, Math.max(1, parseInt(dailyLimit, 10) || 50)),
            auto_warmup: senderType === "smtp" && hasWarmupPlan && !!autoWarmup,
            campaign_rampup: senderType === "smtp" && !!campaignRampup,
            domain_id: targetDomain.id,
            smtp_host: smtpHost || undefined,
            smtp_port: smtpPort ? parseInt(smtpPort) : undefined,
            smtp_username: smtpUsername || undefined,
            smtp_password: smtpPassword || undefined,
            smtp_provider: smtpProvider,
          };
          await createInbox.mutateAsync(inboxData);
        }
        toast.success(
          `Created ${usernames.length} inbox${usernames.length > 1 ? "es" : ""} successfully` +
            (pool.length > 1
              ? ` (balanced across ${pool.length} domains by current inbox load)`
              : "")
        );
        router.push("/inboxes");
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : "Failed to create some inboxes");
      }
      return;
    }

    if (senderType === "smtp") {
      if (!selectedDomainId && !email.includes("@")) {
        toast.error("Please select a domain or enter a full email address");
        return;
      }
      if (smtpProvider === "custom") {
        if (!smtpHost.trim()) {
          toast.error("Please enter SMTP host");
          return;
        }
        if (!smtpPort.trim()) {
          toast.error("Please enter SMTP port");
          return;
        }
        if (!smtpUsername.trim()) {
          toast.error("Please enter SMTP username");
          return;
        }
        if (!smtpPassword.trim()) {
          toast.error("Please enter SMTP password");
          return;
        }
        if (
          email.trim() &&
          smtpUsername.trim() &&
          email.toLowerCase().trim() !== smtpUsername.toLowerCase().trim()
        ) {
          const confirmed = await confirmDialog({
            title: "Email / SMTP mismatch",
            description: `Warning: Your email address (${email.trim()}) doesn't match your SMTP username (${smtpUsername.trim()}).\n\nMost SMTP providers (especially Gmail) will reject emails with this configuration.\n\nDo you want to continue anyway?`,
            variant: "warning",
            confirmLabel: "Continue anyway",
          });
          if (!confirmed) return;
        }
      }
    }

    const inboxData: CreateInboxRequest = {
      user_id: userId,
      email: email.trim(),
      sender_type: senderType,
      daily_limit: Math.min(50, Math.max(1, parseInt(dailyLimit, 10) || 50)),
      auto_warmup: senderType === "smtp" && hasWarmupPlan && !!autoWarmup,
      campaign_rampup: senderType === "smtp" && !!campaignRampup,
    };
    if (senderType === "smtp") {
      inboxData.domain_id = selectedDomainId || undefined;
      inboxData.smtp_host = smtpHost || undefined;
      inboxData.smtp_port = smtpPort ? parseInt(smtpPort) : undefined;
      inboxData.smtp_username = smtpUsername || undefined;
      inboxData.smtp_password = smtpPassword || undefined;
      inboxData.smtp_provider = smtpProvider;
    }

    try {
      await createInbox.mutateAsync(inboxData);
      toast.success("Inbox created successfully");
      router.push("/inboxes");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to create inbox");
    }
  };

  return (
    <div className="space-y-6">
      <UpgradeModal featureKey="inboxes" gate={inboxGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/inboxes">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Create New Inbox</h1>
          <p className="text-muted-foreground">Create one or many email inboxes for sending campaigns</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>Inbox Configuration</CardTitle>
            <CardDescription>Configure your email inbox settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={mode} onValueChange={(v: "single" | "bulk") => setMode(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single inbox</SelectItem>
                    <SelectItem value="bulk">Bulk (multiple inboxes)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sender Type</Label>
                <Select value={senderType} onValueChange={(v: "gmail" | "smtp") => setSenderType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smtp">SMTP (Custom Domain)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {senderType === "smtp" && mode === "single" && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Domain</Label>
                    <Select value={selectedDomainId} onValueChange={setSelectedDomainId} disabled={domainsLoading}>
                      <SelectTrigger>
                        <SelectValue placeholder={domainsLoading ? "Loading domains..." : "Select domain"} />
                      </SelectTrigger>
                      <SelectContent>
                        {domainsLoading ? (
                          <div className="py-2 px-2 text-sm text-muted-foreground">Loading domains...</div>
                        ) : (
                          verifiedDomains.map((domain) => (
                            <SelectItem key={domain.id} value={domain.id}>
                              {domain.domain}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="sales@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  For Gmail/Custom SMTP: Should match your SMTP username to avoid sender rejection.
                </p>

                {smtpProvider === "custom" &&
                  email.trim() &&
                  smtpUsername.trim() &&
                  email.toLowerCase().trim() !== smtpUsername.toLowerCase().trim() && (
                    <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Email/Username Mismatch</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Your email ({email}) doesn&apos;t match SMTP username ({smtpUsername}). Most SMTP
                          providers will reject this. Use Pigeon Provider for domain-level sending.
                        </p>
                      </div>
                    </div>
                  )}

                <div className="space-y-2">
                  <Label>SMTP Provider</Label>
                  <Select
                    value={smtpProvider}
                    onValueChange={(v: "custom" | "pigeon") => setSmtpProvider(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pigeon">Pigeon Provider</SelectItem>
                      <SelectItem value="custom">Custom SMTP</SelectItem>
                    </SelectContent>
                  </Select>
                  {smtpProvider === "pigeon" && (
                    <p className="text-xs text-muted-foreground">
                      Uses the system-wide Pigeon configuration; no credentials required.
                    </p>
                  )}
                </div>

                {smtpProvider === "custom" && (
                  <div className="space-y-5">
                    {/* Provider picker */}
                    <div className="space-y-2">
                      <Label>Email Provider</Label>
                      <p className="text-xs text-muted-foreground">
                        Pick your provider to auto-fill SMTP settings, or choose Custom to enter them manually.
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 pt-1">
                        {SMTP_PRESETS.map((preset) => {
                          const selected = smtpPreset === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setSmtpPreset(preset.id);
                                if (preset.host) {
                                  setSmtpHost(preset.host);
                                  setSmtpPort(preset.port);
                                } else {
                                  setSmtpHost("");
                                  setSmtpPort("587");
                                }
                              }}
                              className={`flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center transition-all hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-ring ${
                                selected
                                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                                  : "border-border bg-background"
                              }`}
                            >
                              <span
                                className={`flex h-8 w-8 items-center justify-center rounded-md ${preset.bg} text-[10px] font-bold text-white`}
                              >
                                {preset.label}
                              </span>
                              <span className="text-xs font-medium leading-tight">{preset.name}</span>
                            </button>
                          );
                        })}
                      </div>
                      {smtpPreset && smtpPreset !== "custom" && (() => {
                        const p = SMTP_PRESETS.find((x) => x.id === smtpPreset);
                        return p ? (
                          <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-2">
                            <span className="font-medium text-foreground">{p.name}:</span> {p.note} — host auto-filled as{" "}
                            <span className="font-mono text-foreground">{p.host}:{p.port}</span>
                          </p>
                        ) : null;
                      })()}
                    </div>

                    {/* SMTP credential fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="smtpHost">SMTP Host</Label>
                        <Input
                          id="smtpHost"
                          placeholder="smtp.example.com"
                          value={smtpHost}
                          onChange={(e) => setSmtpHost(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="smtpPort">SMTP Port</Label>
                        <Input
                          id="smtpPort"
                          type="number"
                          placeholder="587"
                          value={smtpPort}
                          onChange={(e) => setSmtpPort(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpUsername">SMTP Username</Label>
                      <Input
                        id="smtpUsername"
                        placeholder="your-email@example.com"
                        value={smtpUsername}
                        onChange={(e) => setSmtpUsername(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpPassword">SMTP Password</Label>
                      <Input
                        id="smtpPassword"
                        type="password"
                        placeholder="Enter SMTP password or App Password"
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}

              </div>
            )}

            {senderType === "smtp" && mode === "bulk" && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label>Main domain (root)</Label>
                  <Select value={selectedDomainId} onValueChange={setSelectedDomainId} disabled={domainsLoading}>
                    <SelectTrigger>
                      <SelectValue placeholder={domainsLoading ? "Loading domains..." : "Select main domain"} />
                    </SelectTrigger>
                    <SelectContent>
                      {domainsLoading ? (
                        <div className="py-2 px-2 text-sm text-muted-foreground">Loading domains...</div>
                      ) : verifiedRootDomains.length === 0 ? (
                        <div className="py-2 px-2 text-sm text-muted-foreground">No root domains yet</div>
                      ) : (
                        verifiedRootDomains.map((domain) => (
                          <SelectItem key={domain.id} value={domain.id}>
                            {domain.domain}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choose your apex domain. Plain usernames are assigned across the root and subdomains under it,
                    preferring domains with the{" "}
                    <span className="font-medium">fewest existing inboxes</span> (counts update as this batch is
                    created).
                  </p>
                  {selectedDomainId && bulkDistributionPool.length > 0 && (
                    <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-2">
                      {inboxesLoading ? (
                        "Loading current inbox counts…"
                      ) : (
                        <>
                          <span className="font-medium text-foreground">{bulkDistributionPool.length}</span> domain
                          {bulkDistributionPool.length !== 1 ? "s" : ""} — existing inboxes:{" "}
                          {bulkDistributionPool
                            .map((d) => `${d.domain} (${bulkExistingInboxCounts.get(d.id) ?? 0})`)
                            .join(", ")}
                          . New plain lines fill the least-loaded domains first.
                        </>
                      )}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>SMTP Provider</Label>
                  <Select
                    value={smtpProvider}
                    onValueChange={(v: "custom" | "pigeon") => setSmtpProvider(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pigeon">⭐ Pigeon Provider (Recommended)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pigeon Provider works best with easy setup and managed SendGrid delivery.
                  </p>
                  {smtpProvider === "pigeon" && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Uses the system-wide Pigeon configuration; no credentials required.
                    </p>
                  )}
                </div>


                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="bulkUsernames">Usernames / Emails</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setBulkUsernames(getRandomPrefillUsernames(10).join("\n"))}
                    >
                      Prefill 10
                    </Button>
                  </div>
                  <textarea
                    id="bulkUsernames"
                    className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder={
                      "One username per line:\n\nsarah\nmichael\nlaura\n\nor comma separated:\nsarah, michael, laura"
                    }
                    value={bulkUsernames}
                    onChange={(e) => setBulkUsernames(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter one username per line to auto-assign across your domains, or use full addresses (must match
                    the selected root or a subdomain). Prefer real-person style names for deliverability.
                  </p>
                </div>
              </div>
            )}

            {senderType === "gmail" && (
              <div className="space-y-2 p-4 rounded-lg bg-muted/50 border">
                <Label>Gmail Account</Label>
                <p className="text-sm text-muted-foreground">
                  Gmail inboxes are created by connecting your Gmail account in Settings.
                </p>
              </div>
            )}

            {senderType === "smtp" && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="dailyLimit">Daily Sending Limit</Label>
                  <Input
                    id="dailyLimit"
                    type="number"
                    min={1}
                    max={50}
                    placeholder="50"
                    value={dailyLimit}
                    onChange={(e) => {
                      const v = e.target.value === "" ? "" : parseInt(e.target.value, 10);
                      if (v === "") {
                        setDailyLimit("");
                        return;
                      }
                      const num = Number.isNaN(v) ? 50 : Math.min(50, Math.max(1, v));
                      setDailyLimit(String(num));
                    }}
                  />
                  <p className="text-sm text-muted-foreground">
                We recommend keeping it between 20–40 for best deliverability.
              </p>
              <p className="text-xs text-muted-foreground/90 border-l-2 border-muted pl-2">
                Note: Maximum is 50 emails per day per inbox.
              </p>
                </div>

                <div className="space-y-4">

                  <div className="space-y-2">
                    <Label>Campaign volume ramp-up</Label>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="flex-1 pr-3">
                        <p className="text-sm font-medium">Gradual campaign sends toward your daily goal</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Applies to outreach campaigns only. Each tier uses a share of your daily sending goal (20% → 40% →
                          60% → 80%) until you reach the full limit by the last phase.
                        </p>
                      </div>
                      <Switch
                        checked={campaignRampup}
                        onCheckedChange={(checked) => setCampaignRampup(!!checked)}
                        disabled={createInbox.isPending}
                        aria-label="Toggle campaign ramp-up"
                      />
                    </div>
                    {campaignRampup && (
                      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1.5">
                        <p className="font-medium text-foreground">
                          Preview (based on goal{" "}
                          {Math.min(50, Math.max(1, parseInt(String(dailyLimit), 10) || 50))} / day)
                        </p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {(() => {
                            const goal = Math.min(50, Math.max(1, parseInt(String(dailyLimit), 10) || 50));
                            const fracs = [0.2, 0.4, 0.6, 0.8] as const;
                            const labels = [
                              "Days 1–7",
                              "Days 8–14",
                              "Days 15–21",
                              "Day 22 onward",
                            ] as const;
                            return labels.map((label, i) => (
                              <li key={label}>
                                {label}: up to {Math.min(goal, Math.max(1, Math.round(goal * fracs[i])))} / day
                              </li>
                            ));
                          })()}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Auto warmup</Label>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-yellow-500" />
                        <div>
                          <p className="text-sm font-medium">Enable automated warmup</p>
                          <p className="text-xs text-muted-foreground">
                            Gradually ramps up sending volume for this inbox to boost your domain&apos;s email reputation.
                          </p>
                          {!hasWarmupPlan && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Your current plan doesn&apos;t include warmup.{" "}
                              <Link href="/pricing" className="font-semibold text-primary underline-offset-2 hover:underline">
                                Upgrade your plan
                              </Link>{" "}
                              to enable auto warmup.
                            </p>
                          )}
                        </div>
                      </div>
                      <Switch
                        checked={autoWarmup}
                        onCheckedChange={(checked) => setAutoWarmup(!!checked)}
                        disabled={!hasWarmupPlan || createInbox.isPending}
                        aria-label="Toggle auto warmup"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="outline" asChild disabled={createInbox.isPending}>
              <Link href="/inboxes">Cancel</Link>
            </Button>
            <div className="space-y-1">
              <Button type="submit" disabled={createInbox.isPending || senderType === "gmail"}>
                {createInbox.isPending ? "Creating..." : "Create Inbox"}
              </Button>
              {senderType === "gmail" && (
                <p className="text-xs text-muted-foreground">
                  Gmail inboxes are connected from{" "}
                  <Link href="/settings?tab=integrations" className="text-primary hover:underline">
                    Settings → Integrations
                  </Link>
                  .
                </p>
              )}
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
