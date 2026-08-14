"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Coins,
  Handshake,
  Info,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import {
  useWarmupNetworkContacts,
  useCreateWarmupNetworkContact,
  useSendWarmupNetworkVerifyOtp,
  useDeleteWarmupNetworkContact,
  useWarmupSharedPoolState,
  useUpdateWarmupSharedPoolEnrollment,
  useUpdateWarmupNetworkSettings,
  type WarmupNetworkContactItem,
} from "@/hooks/useWarmup";
import { usePlanGate } from "@/hooks/usePlanGate";
import { UpgradeModal } from "@/components/UpgradeModal";
import { Skeleton } from "@/components/ui/skeleton";

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

function formatTransactionLabel(reason: string) {
  switch (reason) {
    case "credits_topup":
      return "Top-up";
    case "shared_pool_send":
      return "Sent (awaiting response)";
    case "shared_pool_rental_income":
      return "Earned — email engaged";
    case "shared_pool_send_refund":
      return "Refunded — no engagement";
    default:
      return reason.replaceAll("_", " ");
  }
}

function formatDelta(delta: number) {
  return `${delta > 0 ? "+" : ""}${delta}`;
}

export default function WarmupNetworkPage() {
  const warmupGate = usePlanGate("warmup");
  const confirmDialog = useConfirmDialog();
  const { user, refetchUser } = useAuth();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addStep, setAddStep] = useState<1 | 2>(1);
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [verifyProvider, setVerifyProvider] = useState<string | null>(null);
  const [topupPending, setTopupPending] = useState(false);

  const { data, isLoading, refetch } = useWarmupNetworkContacts(!warmupGate.atLimit);
  const updateNetworkSettings = useUpdateWarmupNetworkSettings();
  const [dailyLimitInput, setDailyLimitInput] = useState(20);

  useEffect(() => {
    const v = data?.settings?.contact_daily_limit;
    if (v != null) setDailyLimitInput(v);
  }, [data?.settings?.contact_daily_limit]);
  const {
    data: sharedPoolData,
    isLoading: sharedPoolLoading,
    refetch: refetchSharedPool,
  } = useWarmupSharedPoolState(!warmupGate.atLimit);
  const {
    data: topupConfig,
    isLoading: topupConfigLoading,
    refetch: refetchTopupConfig,
  } = useQuery({
    queryKey: ["credit-topup-config"],
    queryFn: () => api.billing.credits.getTopupConfig(),
    enabled: !warmupGate.atLimit,
  });

  const contacts: WarmupNetworkContactItem[] = data?.contacts ?? [];
  const createContact = useCreateWarmupNetworkContact();
  const sendVerify = useSendWarmupNetworkVerifyOtp();
  const deleteContact = useDeleteWarmupNetworkContact();
  const updateEnrollment = useUpdateWarmupSharedPoolEnrollment();

  const eligibility = sharedPoolData?.contributor.eligibility;
  const credits = sharedPoolData?.credits;
  const marketplace = sharedPoolData?.marketplace;
  const transactions = sharedPoolData?.transactions ?? [];

  const resetAddDialog = () => {
    setAddStep(1);
    setNewEmail("");
    setNewLabel("");
    setOtpInput("");
    setVerifyProvider(null);
  };

  const handleSendVerifyCode = () => {
    const email = newEmail.trim();
    if (!email) return;
    sendVerify.mutate(email, {
      onSuccess: (data) => {
        toast.success(data.message || `Verification code sent to ${email}`);
        setVerifyProvider(data.provider ?? null);
        setAddStep(2);
      },
    });
  };

  const handleConfirmAddContact = () => {
    if (otpInput.trim().length !== 6) {
      toast.error("Enter the 6-digit verification code");
      return;
    }
    createContact.mutate(
      {
        email: newEmail.trim(),
        label: newLabel.trim() || undefined,
        otp: otpInput.trim(),
      },
      {
        onSuccess: () => {
          setAddOpen(false);
          resetAddDialog();
          refetchSharedPool();
        },
      }
    );
  };

  const handleSaveDailyLimit = () => {
    let n = Math.round(Number(dailyLimitInput));
    if (Number.isNaN(n)) n = 20;
    n = Math.min(100, Math.max(1, n));
    setDailyLimitInput(n);
    updateNetworkSettings.mutate({ contact_daily_limit: n });
  };

  const handleDelete = async (id: string, email: string) => {
    const ok = await confirmDialog({
      title: "Remove contact",
      description: `Remove ${email} from your My Network?`,
      variant: "destructive",
    });
    if (ok) {
      deleteContact.mutate(id, {
        onSuccess: () => {
          refetchSharedPool();
        },
      });
    }
  };

  const loadRazorpayScript = (): Promise<void> => {
    if (typeof window !== "undefined" && (window as unknown as { Razorpay?: unknown }).Razorpay) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Razorpay"));
      document.body.appendChild(s);
    });
  };

  const handleTopup = async () => {
    if (!topupConfig?.provider_configured) {
      toast.error("Payment gateway is not configured yet.");
      return;
    }

    setTopupPending(true);
    try {
      if (topupConfig.is_india) {
        const order = await api.billing.credits.createRazorpayOrder();
        await loadRazorpayScript();
        const Razorpay = (window as unknown as {
          Razorpay: new (opts: unknown) => { open: () => void };
        }).Razorpay;
        new Razorpay({
          key: order.key_id,
          amount: order.amount,
          currency: order.currency,
          name: "Pigeon",
          description: `${order.credits} warmup credits`,
          order_id: order.order_id,
          prefill: {
            email: user?.email ?? "",
            name: `${user?.first_name ?? ""} ${user?.last_name ?? ""}`.trim(),
          },
          handler: async (response: RazorpayResponse) => {
            try {
              await api.billing.credits.verifyRazorpayOrder({
                order_id: response.razorpay_order_id,
                payment_id: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              });
              await Promise.all([refetchSharedPool(), refetchTopupConfig(), refetchUser()]);
              toast.success("900 credits added successfully");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed to verify payment");
            } finally {
              setTopupPending(false);
            }
          },
          modal: {
            ondismiss: () => setTopupPending(false),
          },
          theme: {
            color: "#111827",
          },
        }).open();
        return;
      }

      const result = await api.billing.credits.createLemonCheckout();
      window.location.assign(result.checkout_url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start top-up");
      setTopupPending(false);
    }
  };

  if (warmupGate.atLimit) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/warmup">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">My Network</h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              My Network is available on plans that include inbox warmup.
            </p>
            <Button onClick={() => setUpgradeOpen(true)}>Upgrade plan</Button>
          </CardContent>
        </Card>
        <UpgradeModal featureKey="warmup" gate={warmupGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UpgradeModal featureKey="warmup" gate={warmupGate} open={upgradeOpen} onOpenChange={setUpgradeOpen} />

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/warmup">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6" />
              My Network
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage your own contacts and the shared contact pool credits marketplace.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch();
              refetchSharedPool();
              refetchTopupConfig();
            }}
            disabled={isLoading || sharedPoolLoading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            size="sm"
            className="gradient-primary"
            onClick={() => {
              resetAddDialog();
              setAddOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add contact
          </Button>
        </div>
      </div>

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="py-3 px-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            <strong className="font-medium text-foreground">Shared contact pool:</strong> you can now
            rent your verified warmup network into the pool and earn credits when other users warm up
            against it. Users who draw from the pool spend credits; contributors with eligible contacts earn
            credits back.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Credits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sharedPoolLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <div>
                  <p className="text-3xl font-semibold">{credits?.balance ?? user?.credits_balance ?? 0}</p>
                  <p className="text-sm text-muted-foreground">
                    1 shared contact send = {credits?.cost_per_send ?? 1} credit
                  </p>
                </div>
                {(credits?.credits_held ?? 0) > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">On hold</p>
                      <p className="text-xs text-muted-foreground">Pending reply — refunded after 48h if no response</p>
                    </div>
                    <span className="text-sm font-semibold text-amber-600">{credits?.credits_held ?? 0}</span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg border p-2">
                    <p className="font-medium">{credits?.total_purchased ?? 0}</p>
                    <p className="text-muted-foreground text-xs">Purchased</p>
                  </div>
                  <div className="rounded-lg border p-2">
                    <p className="font-medium">{credits?.total_earned ?? 0}</p>
                    <p className="text-muted-foreground text-xs">Earned</p>
                  </div>
                  <div className="rounded-lg border p-2">
                    <p className="font-medium">{credits?.total_spent ?? 0}</p>
                    <p className="text-muted-foreground text-xs">Spent</p>
                  </div>
                </div>
                <Button className="w-full" onClick={handleTopup} disabled={topupPending || topupConfigLoading}>
                  <Coins className="h-4 w-4 mr-2" />
                  {topupPending
                    ? "Opening checkout..."
                    : `Top up ${topupConfig?.amount.display ?? "credits"} for ${topupConfig?.credits ?? 900} credits`}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Handshake className="h-4 w-4" />
              Pool Marketplace
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sharedPoolLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold">{marketplace?.active_contributors ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Active contributors</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold">{marketplace?.available_contacts ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Pool contacts</p>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">Use shared contacts</p>
                      <p className="text-sm text-muted-foreground">
                        Warm up using other users&apos; real networks.
                      </p>
                    </div>
                    <Badge variant={marketplace?.can_use_shared_pool ? "default" : "secondary"}>
                      {marketplace?.can_use_shared_pool ? "Ready" : "Needs credits"}
                    </Badge>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4" />
              Rent Your Network
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sharedPoolLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="rounded-lg border p-3">
                  <p className="font-medium">
                    {sharedPoolData?.contributor.enabled ? "Live in pool" : "Not enrolled"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Earn {credits?.reward_per_rental ?? 1} credit each time your rented network is used.
                  </p>
                </div>
                <Button
                  className="w-full"
                  variant={sharedPoolData?.contributor.enabled ? "outline" : "default"}
                  disabled={
                    updateEnrollment.isPending ||
                    (!sharedPoolData?.contributor.enabled &&
                      (!eligibility?.qualifies || (credits?.balance ?? user?.credits_balance ?? 0) <= 0))
                  }
                  onClick={() =>
                    updateEnrollment.mutate(!(sharedPoolData?.contributor.enabled ?? false), {
                      onSuccess: async () => {
                        await Promise.all([refetchSharedPool(), refetchUser()]);
                      },
                    })
                  }
                >
                  {updateEnrollment.isPending
                    ? "Saving..."
                    : sharedPoolData?.contributor.enabled
                      ? "Disable renting"
                      : "Enable renting"}
                </Button>
                {!eligibility?.qualifies && (
                  <p className="text-xs text-amber-600">
                    Need at least 15 contacts with an 80% Gmail and 20% Outlook mix before enabling.
                  </p>
                )}
                {(credits?.balance ?? user?.credits_balance ?? 0) <= 0 && !sharedPoolData?.contributor.enabled && (
                  <p className="text-xs text-amber-600">
                    Top up credits first to enable renting in the shared pool.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Eligibility for shared pool</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sharedPoolLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold">{eligibility?.total_contacts ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Total contacts</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold">{eligibility?.gmail_contacts ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Gmail</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold">{eligibility?.outlook_contacts ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Outlook</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-2xl font-semibold">{eligibility?.other_contacts ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Other</p>
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">Rule check</p>
                    <Badge variant={eligibility?.qualifies ? "default" : "secondary"}>
                      {eligibility?.qualifies ? "Eligible" : "Not eligible"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Eligibility is based on Gmail and Outlook only (other domains are ignored). You need at
                    least {eligibility?.required_total_contacts ?? 15} of those, with at least{" "}
                    {eligibility?.required_gmail_contacts_at_minimum ?? 12} Gmail and{" "}
                    {eligibility?.required_outlook_contacts_at_minimum ?? 3} Outlook, in an ~80/20 mix for
                    your current Gmail+Outlook count.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Mix among Gmail+Outlook: {Math.round((eligibility?.gmail_share ?? 0) * 100)}% Gmail and{" "}
                    {Math.round((eligibility?.outlook_share ?? 0) * 100)}% Outlook.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent credit activity</CardTitle>
          </CardHeader>
          <CardContent>
            {sharedPoolLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No credit activity yet.</p>
            ) : (
              <div className="space-y-2">
                {transactions.slice(0, 6).map((txn) => (
                  <div key={txn.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">{formatTransactionLabel(txn.reason)}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(txn.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={`text-sm font-semibold ${txn.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {formatDelta(txn.delta)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Daily receive limit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground max-w-2xl">
            Maximum warmup emails each contact can receive per rolling 24 hours, counted across all of your
            warming inboxes and shared contact pool sends that use your network. Default is 20; allowed range is
            1–100.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="network-daily-limit">Emails per contact / 24h</Label>
              <Input
                id="network-daily-limit"
                type="number"
                min={1}
                max={100}
                className="w-32"
                value={dailyLimitInput}
                onChange={(e) => setDailyLimitInput(Number(e.target.value))}
              />
            </div>
            <Button
              type="button"
              onClick={handleSaveDailyLimit}
              disabled={updateNetworkSettings.isPending || isLoading}
            >
              {updateNetworkSettings.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Contacts ({contacts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12">
                        <div className="flex flex-col items-center gap-4">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                            <Users className="h-6 w-6 text-muted-foreground" />
                          </div>
                          <div className="text-center space-y-1">
                            <p className="text-sm font-medium text-foreground">No contacts yet</p>
                            <p className="text-xs text-muted-foreground max-w-xs">
                              Add at least 15 real inboxes if you want to rent this network into the shared pool.
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    contacts.map((c, i) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>{c.email}</TableCell>
                        <TableCell className="text-muted-foreground">{c.label || "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(c.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDelete(c.id, c.email)}
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetAddDialog();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {addStep === 1 ? "Add contact" : "Verify ownership"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-2">
                {addStep === 1 ? (
                  <>
                    <p>
                      We run the same checks as Rent Your Network: valid MX, reputation screening, and supported
                      provider. Then we email a 6-digit code to prove you control the address.
                    </p>
                    <p>
                      For shared pool eligibility, your Gmail and Outlook addresses should follow roughly an 80/20
                      mix; other providers in this list do not affect that check.
                    </p>
                  </>
                ) : (
                  <p>Enter the code sent to the address below, then save the contact.</p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {addStep === 1 && (
            <div className="space-y-4 py-1">
              <div className="space-y-2">
                <Label htmlFor="new-email">Email address</Label>
                <Input
                  id="new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="contact@example.com"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSendVerifyCode()}
                />
                <p className="text-xs text-muted-foreground">
                  You must be able to read the inbox — that&apos;s how we verify ownership.
                </p>
              </div>
            </div>
          )}

          {addStep === 2 && (
            <div className="space-y-4 py-1">
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-700 text-sm">
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="font-medium text-emerald-700 dark:text-emerald-300 truncate">{newEmail}</span>
              </div>
              {verifyProvider ? (
                <p className="text-xs text-muted-foreground">
                  Detected provider:{" "}
                  <span className="font-medium text-foreground capitalize">{verifyProvider}</span>
                </p>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="contact-otp">Verification code</Label>
                <Input
                  id="contact-otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                  className="tracking-widest text-center text-lg font-mono"
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={handleSendVerifyCode}
                    disabled={sendVerify.isPending || !newEmail.trim()}
                    className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {sendVerify.isPending ? "Sending…" : "Resend code"}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => {
                      setAddStep(1);
                      setOtpInput("");
                      setVerifyProvider(null);
                    }}
                  >
                    Use a different email
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-label">
                  Label <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="new-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Colleague, Team"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            {addStep === 1 ? (
              <Button
                type="button"
                onClick={handleSendVerifyCode}
                disabled={sendVerify.isPending || !newEmail.trim()}
              >
                {sendVerify.isPending ? "Checking…" : "Send code"}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleConfirmAddContact}
                disabled={createContact.isPending || otpInput.length !== 6}
              >
                {createContact.isPending ? "Adding…" : "Add contact"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
