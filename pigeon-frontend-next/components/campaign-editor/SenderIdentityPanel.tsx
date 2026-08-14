"use client";

import Link from "next/link";
import { Globe, Info, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SmtpInboxMultiSelect,
  type SmtpInboxMultiSelectInbox,
} from "@/components/campaigns/SmtpInboxMultiSelect";
import type { CampaignFormData } from "@/lib/campaign-editor/types";
import type { Inbox } from "@/types/api";
import { cn } from "@/lib/utils";

export type SmtpRootOption = {
  rootDomain: string;
  inboxCount: number;
  hasReadyInboxes: boolean;
};

type SenderIdentityPanelProps = {
  campaignData: CampaignFormData;
  setCampaignData: React.Dispatch<React.SetStateAction<CampaignFormData>>;
  handleSenderTypeChange: (next: "gmail" | "smtp") => void;
  gmailInboxes: Inbox[];
  smtpRootDomainOptions: SmtpRootOption[];
  smtpSelectedRootDomains: string[];
  setSmtpSelectedRootDomains: React.Dispatch<React.SetStateAction<string[]>>;
  handleSmtpRootToggle: (root: string, checked: boolean) => void;
  smtpInboxesForSelectedRoots: SmtpInboxMultiSelectInbox[];
  inboxes: Inbox[];
  testEmail: string;
  setTestEmail: (v: string) => void;
  handleSendConnectionTest: () => void | Promise<void>;
  isTestingConnection: boolean;
  /** When using SMTP domain multi-select, prevents auto-reselect after user clears all */
  allowSmtpDomainAutofillRef?: React.MutableRefObject<boolean>;
};

export function SenderIdentityPanel({
  campaignData,
  setCampaignData,
  handleSenderTypeChange,
  gmailInboxes,
  smtpRootDomainOptions,
  smtpSelectedRootDomains,
  setSmtpSelectedRootDomains,
  handleSmtpRootToggle,
  smtpInboxesForSelectedRoots,
  inboxes,
  testEmail,
  setTestEmail,
  handleSendConnectionTest,
  isTestingConnection,
  allowSmtpDomainAutofillRef,
}: SenderIdentityPanelProps) {
  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex gap-3 pt-4 sm:pt-5">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Name your campaign and choose senders</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You can change these later. Pick accounts that match your audience—fewer, well-warmed inboxes often perform
              better than many cold ones.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Campaign name</CardTitle>
          <CardDescription>For your dashboard and reports only—recipients won&apos;t see this name.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <Label htmlFor="name" className="sr-only">
            Campaign name
          </Label>
          <Input
            id="name"
            placeholder="e.g. Q1 product launch — design leads"
            value={campaignData.name}
            onChange={(e) => setCampaignData({ ...campaignData, name: e.target.value })}
            className="h-11 text-base"
            autoComplete="off"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who sends the emails?</CardTitle>
          <CardDescription>
            Gmail uses connected Google accounts. Domain uses verified SMTP inboxes on your own domains.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleSenderTypeChange("gmail")}
              className={cn(
                "flex flex-col gap-2 rounded-xl border-2 p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                campaignData.senderType === "gmail"
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-primary/35 hover:bg-muted/40"
              )}
              aria-pressed={campaignData.senderType === "gmail"}
            >
              <div className="flex w-full items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background shadow-sm">
                  <Mail className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <span className="font-semibold">Gmail</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                OAuth-connected Google Workspace or Gmail inboxes.
              </p>
            </button>
            <button
              type="button"
              onClick={() => handleSenderTypeChange("smtp")}
              className={cn(
                "flex flex-col gap-2 rounded-xl border-2 p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                campaignData.senderType === "smtp"
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-primary/35 hover:bg-muted/40"
              )}
              aria-pressed={campaignData.senderType === "smtp"}
            >
              <div className="flex w-full items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background shadow-sm">
                  <Globe className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <span className="font-semibold">Domain (SMTP)</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your verified domain inboxes and DNS-authenticated sending.
              </p>
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-base font-medium">
                {campaignData.senderType === "gmail" ? "Gmail accounts" : "Domains & inboxes"}
              </Label>
              {campaignData.senderType === "gmail" && gmailInboxes.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs font-medium"
                  onClick={() => {
                    const allSelected = gmailInboxes.every((inbox) => campaignData.senderIds.includes(inbox.id));
                    const nextSenderIds = allSelected ? [] : gmailInboxes.map((i) => i.id);
                    const effectiveCount = nextSenderIds.length || 1;
                    setCampaignData((prev) => ({
                      ...prev,
                      senderIds: nextSenderIds,
                      enableRotation: nextSenderIds.length > 1,
                      dailyLimit: prev.dailyLimitTouched ? prev.dailyLimit : effectiveCount * 50,
                    }));
                  }}
                >
                  {gmailInboxes.every((inbox) => campaignData.senderIds.includes(inbox.id)) &&
                  campaignData.senderIds.length > 0
                    ? "Deselect All"
                    : "Select All"}
                </Button>
              )}
              {campaignData.senderType === "smtp" &&
                smtpRootDomainOptions.filter((option) => option.hasReadyInboxes).length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() => {
                      const all = smtpRootDomainOptions
                        .filter((option) => option.hasReadyInboxes)
                        .map((option) => option.rootDomain);
                      const allOn = all.length > 0 && all.every((r) => smtpSelectedRootDomains.includes(r));
                      if (allOn) {
                        allowSmtpDomainAutofillRef && (allowSmtpDomainAutofillRef.current = false);
                        setSmtpSelectedRootDomains([]);
                        setCampaignData((cd) => ({
                          ...cd,
                          senderIds: [],
                          enableRotation: false,
                          dailyLimit: cd.dailyLimitTouched ? cd.dailyLimit : 50,
                        }));
                      } else {
                        allowSmtpDomainAutofillRef && (allowSmtpDomainAutofillRef.current = true);
                        setSmtpSelectedRootDomains([...all]);
                      }
                    }}
                  >
                    {smtpRootDomainOptions.filter((option) => option.hasReadyInboxes).length > 0 &&
                    smtpRootDomainOptions
                      .filter((option) => option.hasReadyInboxes)
                      .every((option) => smtpSelectedRootDomains.includes(option.rootDomain))
                      ? "Clear all"
                      : "Select all"}
                  </Button>
                )}
            </div>

            {campaignData.senderType === "gmail" ? (
              <>
                {gmailInboxes.length > 0 ? (
                  <div className="space-y-4">
                    <p className="text-xs font-medium text-muted-foreground">
                      {(() => {
                        const selectedCount = gmailInboxes.filter((i) => campaignData.senderIds.includes(i.id)).length;
                        if (selectedCount === 0) return "Select at least one account to send from";
                        return `${selectedCount} of ${gmailInboxes.length} account${gmailInboxes.length > 1 ? "s" : ""} selected`;
                      })()}
                    </p>
                    <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-border/80 bg-muted/15 p-2">
                      {gmailInboxes.map((inbox) => {
                        const checked = campaignData.senderIds.includes(inbox.id);
                        return (
                          <label
                            key={inbox.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
                              checked
                                ? "border-primary/35 bg-primary/5 shadow-sm"
                                : "border-transparent bg-background/80 hover:border-border hover:bg-muted/40"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...campaignData.senderIds, inbox.id]
                                  : campaignData.senderIds.filter((id) => id !== inbox.id);
                                const effectiveCount = next.length || 1;
                                setCampaignData((prev) => ({
                                  ...prev,
                                  senderIds: next,
                                  enableRotation: next.length > 1,
                                  dailyLimit: prev.dailyLimitTouched ? prev.dailyLimit : effectiveCount * 50,
                                }));
                              }}
                              className="h-4 w-4 rounded border-input"
                            />
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" aria-hidden />
                            <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{inbox.email}</span>
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {inbox.sent_today}/50 today
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Smaller lists often do better with fewer sending accounts—spread only when volume and reputation
                        support it.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/25 px-4 py-8 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <Mail className="h-6 w-6 text-muted-foreground" aria-hidden />
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">No Gmail inboxes connected</p>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Connect Google in Integrations or add accounts from Inbox Accounts.
                    </p>
                    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/settings?tab=integrations">Integrations</Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/inboxes">Inbox accounts</Link>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Choose which root domains participate. We&apos;ll list ready SMTP inboxes for those domains next.
                  </p>
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border border-border/80 bg-muted/15 p-2">
                    {smtpRootDomainOptions.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">No domains connected yet.</p>
                    ) : (
                      smtpRootDomainOptions.map((option) => {
                        const checked = smtpSelectedRootDomains.includes(option.rootDomain);
                        return (
                          <label
                            key={option.rootDomain}
                            className={cn(
                              "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                              !option.hasReadyInboxes && "cursor-not-allowed opacity-60",
                              checked
                                ? "border-primary/35 bg-primary/5 shadow-sm"
                                : option.hasReadyInboxes
                                  ? "cursor-pointer border-transparent bg-background/80 hover:border-border hover:bg-muted/40"
                                  : "border-transparent bg-background/70"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!option.hasReadyInboxes}
                              onChange={(e) => handleSmtpRootToggle(option.rootDomain, e.target.checked)}
                              className="h-4 w-4 rounded border-input"
                            />
                            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <span className="text-sm font-medium">{option.rootDomain}</span>
                              <p className="text-[11px] text-muted-foreground">
                                {option.hasReadyInboxes
                                  ? `${option.inboxCount} ready inbox${option.inboxCount !== 1 ? "es" : ""}`
                                  : "No ready inboxes yet"}
                              </p>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                  {smtpRootDomainOptions.some((option) => option.hasReadyInboxes === false) && (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                      Some domains are disabled because they don&apos;t have ready SMTP inboxes.{" "}
                      <Link href="/inboxes" className="font-medium text-primary underline-offset-4 hover:underline">
                        Add inboxes
                      </Link>{" "}
                      to enable them.
                    </p>
                  )}
                </div>

                {smtpSelectedRootDomains.length > 0 && (
                  <SmtpInboxMultiSelect
                    inboxes={smtpInboxesForSelectedRoots}
                    selectedIds={campaignData.senderIds}
                    onSelectionChange={(ids) => {
                      setCampaignData((prev) => {
                        const effectiveCount = ids.length || 1;
                        return {
                          ...prev,
                          senderIds: ids,
                          enableRotation: ids.length > 1,
                          dailyLimit: prev.dailyLimitTouched ? prev.dailyLimit : effectiveCount * 50,
                        };
                      });
                    }}
                  />
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {((campaignData.senderType === "gmail" && gmailInboxes.length > 0) ||
        (campaignData.senderType === "smtp" && smtpSelectedRootDomains.length > 0)) && (
        <Card className="border-dashed border-border/80 bg-muted/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Send a test email</CardTitle>
            <CardDescription>Optional—verify delivery before you launch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="campaign-test-email"
                type="email"
                placeholder="you@example.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="h-11 flex-1"
              />
              <Button
                type="button"
                onClick={handleSendConnectionTest}
                disabled={isTestingConnection || !testEmail.trim() || campaignData.senderIds.length === 0}
                className="h-11 shrink-0 px-6 sm:whitespace-nowrap"
              >
                {isTestingConnection ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send test"
                )}
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {campaignData.senderType === "gmail"
                ? campaignData.senderIds.length > 0
                  ? (() => {
                      const firstInbox = inboxes.find(
                        (i) => i.sender_type === "gmail" && i.id === campaignData.senderIds[0]
                      );
                      const fromEmail = firstInbox?.email ?? "selected account";
                      return campaignData.senderIds.length === 1
                        ? `Sends from ${fromEmail}`
                        : `Sends from your first selected account (${fromEmail})`;
                    })()
                  : "Select at least one Gmail account to send a test."
                : campaignData.senderIds.length > 0
                  ? "Sends from your first selected SMTP inbox."
                  : "Select at least one inbox to send a test."}
            </p>
          </CardContent>
        </Card>
      )}

      {campaignData.senderIds.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sender rotation</CardTitle>
            <CardDescription>When multiple accounts send, choose how we pick the next sender.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <Label htmlFor="sender-rotation" className="sr-only">
              Sender rotation strategy
            </Label>
            <Select
              value={campaignData.senderRotation}
              onValueChange={(value: "round_robin" | "random") =>
                setCampaignData({ ...campaignData, senderRotation: value })
              }
            >
              <SelectTrigger id="sender-rotation" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="round_robin"
                  className="data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground [&[data-highlighted]_span]:!text-primary-foreground"
                >
                  <div className="flex flex-col items-start py-1">
                    <span className="font-medium">Round Robin</span>
                    <span className="text-xs text-muted-foreground">Cycle through senders evenly</span>
                  </div>
                </SelectItem>
                <SelectItem
                  value="random"
                  className="data-[highlighted]:bg-primary data-[highlighted]:text-primary-foreground [&[data-highlighted]_span]:!text-primary-foreground"
                >
                  <div className="flex flex-col items-start py-1">
                    <span className="font-medium">Random</span>
                    <span className="text-xs text-muted-foreground">Pick senders randomly</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
