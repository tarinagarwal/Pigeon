"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, KeyRound } from "lucide-react";
import Link from "next/link";
import { useUpdateInbox, useSetInboxMailboxPassword } from "@/hooks/useInboxes";
import { toast } from "sonner";
import type { Inbox } from "@/types/api";

interface InboxSettingsDialogProps {
  inbox: Inbox;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function InboxSettingsDialog({ inbox, open, onOpenChange, onSuccess }: InboxSettingsDialogProps) {
  const [email, setEmail] = useState(inbox.email);
  const [smtpHost, setSmtpHost] = useState(inbox.smtp_host || "");
  const [smtpPort, setSmtpPort] = useState(inbox.smtp_port?.toString() || "587");
  const [smtpUsername, setSmtpUsername] = useState(inbox.smtp_username || "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpProvider, setSmtpProvider] = useState<"custom" | "pigeon">(
    (inbox.smtp_provider === "sendgrid" || inbox.smtp_provider === "pigeon" ? "pigeon" : (inbox.smtp_provider as "custom" | "pigeon") || "custom")
  );
  const [dailyLimit, setDailyLimit] = useState(String(Math.min(50, inbox.daily_limit ?? 50)));
  const [campaignRampup, setCampaignRampup] = useState<boolean>(!!inbox.campaign_rampup);
  const [senderNameOverride, setSenderNameOverride] = useState((inbox.sender_name || "").trim());
  const [mailboxLoginPassword, setMailboxLoginPassword] = useState("");
  const [mailboxLoginPasswordConfirm, setMailboxLoginPasswordConfirm] = useState("");

  const updateInbox = useUpdateInbox();
  const setMailboxPassword = useSetInboxMailboxPassword();

  useEffect(() => {
    setEmail(inbox.email);
    setSmtpHost(inbox.smtp_host || "");
    setSmtpPort(inbox.smtp_port?.toString() || "587");
    setSmtpUsername(inbox.smtp_username || "");
    setSmtpProvider(inbox.smtp_provider === "sendgrid" || inbox.smtp_provider === "pigeon" ? "pigeon" : (inbox.smtp_provider as "custom" | "pigeon") || "custom");
    setDailyLimit(String(Math.min(50, inbox.daily_limit ?? 50)));
    setSmtpPassword("");
    setCampaignRampup(!!inbox.campaign_rampup);
    setSenderNameOverride((inbox.sender_name || "").trim());
    setMailboxLoginPassword("");
    setMailboxLoginPasswordConfirm("");
  }, [inbox]);

  const formatRampStartedAt = (value?: string) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d);
  };

  const computeRampTierAndCap = () => {
    if (!campaignRampup) return null;

    // Backend uses: campaign_rampup_started_at OR inbox.created_at as fallback.
    const startRaw = inbox.campaign_rampup_started_at || inbox.created_at;
    const start = startRaw ? new Date(startRaw) : null;
    if (!start || Number.isNaN(start.getTime())) return null;

    const nowMs = Date.now();
    const startMs = start.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const daysSinceStart = Math.max(0, Math.floor((nowMs - startMs) / dayMs));

    const goal = Math.min(50, Math.max(1, inbox.daily_limit ?? 50));
    const fracs = [0.2, 0.4, 0.6, 0.8] as const;
    const tiers = [
      { label: "Days 1–7", maxDays: 6, frac: fracs[0] },
      { label: "Days 8–14", maxDays: 13, frac: fracs[1] },
      { label: "Days 15–21", maxDays: 20, frac: fracs[2] },
      { label: "Day 22 onward", maxDays: Infinity, frac: fracs[3] },
    ] as const;

    const tierIdx = tiers.findIndex((t) => daysSinceStart <= t.maxDays);
    const tier = tiers[Math.max(0, tierIdx)];
    const cap = Math.min(goal, Math.max(1, Math.round(goal * tier.frac)));

    return {
      daysSinceStart,
      tierLabel: tier.label,
      capPerDay: cap,
      dailyGoal: goal,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    try {
      const updateData: Record<string, unknown> = {
        user_id: inbox.user_id,
        sender_type: inbox.sender_type,
        email: email.trim(),
        sender_name: senderNameOverride.trim(),
        daily_limit: Math.min(50, Math.max(1, parseInt(dailyLimit, 10) || 50)),
      };

      if (inbox.sender_type === "smtp") {
        updateData.smtp_provider = smtpProvider;

        updateData.campaign_rampup = !!campaignRampup;

        if (smtpProvider === "custom") {
          if (!smtpHost.trim()) {
            toast.error("Please enter SMTP host");
            return;
          }
          updateData.smtp_host = smtpHost.trim();
          updateData.smtp_port = parseInt(smtpPort) || 587;
          updateData.smtp_username = smtpUsername.trim();
          if (smtpPassword) {
            updateData.smtp_password = smtpPassword;
          }
        } else if (smtpProvider !== "pigeon") {
          if (smtpPassword) {
            updateData.smtp_password = smtpPassword;
          }
        }
      }

      await updateInbox.mutateAsync({
        inboxId: inbox.id,
        data: updateData as Parameters<typeof updateInbox.mutateAsync>[0]["data"],
      });

      toast.success("Inbox settings updated successfully");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to update inbox settings");
    }
  };

  const handleSaveMailboxLoginPassword = async () => {
    const p = mailboxLoginPassword.trim();
    const c = mailboxLoginPasswordConfirm.trim();
    if (p.length < 8) {
      toast.error("Mailbox login password must be at least 8 characters");
      return;
    }
    if (p !== c) {
      toast.error("Passwords do not match");
      return;
    }
    try {
      await setMailboxPassword.mutateAsync({ inboxId: inbox.id, password: p });
      setMailboxLoginPassword("");
      setMailboxLoginPasswordConfirm("");
    } catch {
      /* toast from hook */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Inbox Settings</DialogTitle>
            <DialogDescription>Update settings for {inbox.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {inbox.sender_type === "smtp" &&
              smtpProvider === "custom" &&
              email.trim() &&
              smtpUsername.trim() &&
              email.toLowerCase().trim() !== smtpUsername.toLowerCase().trim() && (
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Email/Username Mismatch</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Your email address ({email}) doesn&apos;t match your SMTP username ({smtpUsername}). Most
                      SMTP providers (especially Gmail) will reject emails if these don&apos;t match. Consider setting
                      the email to match your SMTP username, or use Pigeon Provider for domain-level sending.
                    </p>
                  </div>
                </div>
              )}

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="sales@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={updateInbox.isPending}
              />
              <p className="text-xs text-muted-foreground">
                For Gmail/Custom SMTP: This should match your SMTP username to avoid sender rejection errors.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="senderNameOverride">Sender name override</Label>
              <Input
                id="senderNameOverride"
                type="text"
                placeholder="Leave blank to use automatic name"
                value={senderNameOverride}
                onChange={(e) => setSenderNameOverride(e.target.value)}
                disabled={updateInbox.isPending}
              />
              <p className="text-xs text-muted-foreground">
                If set, this manual value is used for <code>{"{{inbox_name}}"}</code> and sender display name.
              </p>
              <p className="text-xs text-muted-foreground">
                Automatic (current computation):{" "}
                <span className="font-medium text-foreground">
                  {inbox.auto_sender_name || "Team Wellwishers"}
                </span>
              </p>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium">Mailbox web login</p>
                  <p className="text-xs text-muted-foreground">
                    Set the password used to sign in at the standalone mailbox view (separate from SMTP or Gmail app
                    passwords).{" "}
                    <Link href="/mailbox/login" className="text-primary underline-offset-4 hover:underline">
                      Open mailbox login
                    </Link>
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="mailboxLoginPassword">New password</Label>
                  <Input
                    id="mailboxLoginPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={mailboxLoginPassword}
                    onChange={(e) => setMailboxLoginPassword(e.target.value)}
                    disabled={setMailboxPassword.isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mailboxLoginPasswordConfirm">Confirm password</Label>
                  <Input
                    id="mailboxLoginPasswordConfirm"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    value={mailboxLoginPasswordConfirm}
                    onChange={(e) => setMailboxLoginPasswordConfirm(e.target.value)}
                    disabled={setMailboxPassword.isPending}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full sm:w-auto"
                disabled={
                  setMailboxPassword.isPending ||
                  mailboxLoginPassword.trim().length < 8 ||
                  mailboxLoginPassword !== mailboxLoginPasswordConfirm
                }
                onClick={handleSaveMailboxLoginPassword}
              >
                {setMailboxPassword.isPending ? "Saving…" : "Save mailbox login password"}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dailyLimit">Daily Limit</Label>
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
                disabled={updateInbox.isPending}
              />
              <p className="text-sm text-muted-foreground">We recommend keeping it between 30–45 for best deliverability.</p>
              <p className="text-xs text-muted-foreground/90 border-l-2 border-muted pl-2">
                Note: Maximum is 50 emails per day per inbox. No one can exceed this limit.
              </p>
            </div>

            {inbox.sender_type === "smtp" && (
              <>
                <div className="space-y-2">
                  <Label>Campaign volume ramp-up</Label>
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="flex-1 pr-3">
                      <p className="text-sm font-medium">Gradual campaign sends toward your daily goal</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Applies to outreach campaigns only. Each tier uses a share of your daily sending goal until you reach the full limit.
                      </p>
                    </div>
                    <Switch
                      checked={campaignRampup}
                      onCheckedChange={(checked) => setCampaignRampup(!!checked)}
                      disabled={updateInbox.isPending}
                      aria-label="Toggle campaign ramp-up"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ramp-up started at:{" "}
                    <span className="font-medium text-foreground">
                      {formatRampStartedAt(inbox.campaign_rampup_started_at) ?? "Not started"}
                    </span>
                    {campaignRampup ? null : <span className="text-muted-foreground"> (disabled)</span>}
                  </p>

                  {(() => {
                    const ramp = computeRampTierAndCap();
                    if (!ramp) {
                      return (
                        <p className="text-xs text-muted-foreground">
                          Current progress: <span className="font-medium text-foreground">—</span>
                        </p>
                      );
                    }
                    return (
                      <p className="text-xs text-muted-foreground">
                        Current ramp: <span className="font-medium text-foreground">{ramp.tierLabel}</span>{" "}
                        (Day {ramp.daysSinceStart + 1} since start). Current cap:{" "}
                        <span className="font-medium text-foreground">
                          {ramp.capPerDay} / day
                        </span>{" "}
                        (goal {ramp.dailyGoal} / day).
                      </p>
                    );
                  })()}
                </div>

                <div className="space-y-2">
                  <Label>SMTP Provider</Label>
                  <Select
                    value={smtpProvider}
                    onValueChange={(v: "custom" | "pigeon") => setSmtpProvider(v)}
                    disabled={updateInbox.isPending}
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
                      Uses Pigeon&apos;s SendGrid configuration; no SMTP credentials are required here.
                    </p>
                  )}
                </div>

                {smtpProvider === "custom" && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="smtpHost">SMTP Host</Label>
                        <Input
                          id="smtpHost"
                          placeholder="smtp.example.com"
                          value={smtpHost}
                          onChange={(e) => setSmtpHost(e.target.value)}
                          disabled={updateInbox.isPending}
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
                          disabled={updateInbox.isPending}
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
                        disabled={updateInbox.isPending}
                      />
                      <p className="text-xs text-muted-foreground">
                        Usually your full email address (e.g., contact@domain.com for Gmail)
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpPassword">SMTP Password</Label>
                      <Input
                        id="smtpPassword"
                        type="password"
                        placeholder="Leave empty to keep existing password"
                        value={smtpPassword}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                        disabled={updateInbox.isPending}
                      />
                      <p className="text-xs text-muted-foreground">Only fill this if you want to change the password</p>
                    </div>
                  </>
                )}

              </>
            )}

            {inbox.sender_type === "gmail" && (
              <div className="p-4 rounded-lg bg-secondary">
                <p className="text-sm text-muted-foreground">
                  This is a Gmail inbox. OAuth credentials are managed through Settings → Integrations.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateInbox.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={updateInbox.isPending}>
              {updateInbox.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
