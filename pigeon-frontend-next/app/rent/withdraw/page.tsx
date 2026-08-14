"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Lock,
  Clock,
  Banknote,
  Building2,
  Smartphone,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRYN, rynFetch, type RYNTransaction } from "@/contexts/RYNContext";
import RYNShell from "../RYNShell";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MIN_WITHDRAW_CREDITS = 500;
const PLATFORM_FEE_PERCENT = 10;

interface CreditsData {
  credits_balance: number;
  credits_held: number;
  credits_total_earned: number;
  credits_total_spent: number;
  transactions: RYNTransaction[];
}

interface RYNWithdrawRecord {
  id: string;
  user_id: string;
  credits_requested: number;
  credits_fee: number;
  credits_net: number;
  payment_method: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function BalanceCard({ data }: { data: CreditsData }) {
  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="gradient-primary px-6 py-6 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-white/10 -translate-y-1/2 translate-x-1/4" />
        <p className="text-sm text-white/80 mb-1 relative">Available balance</p>
        <div className="flex items-end gap-2 relative">
          <span className="text-5xl font-black tabular-nums">{data.credits_balance.toLocaleString()}</span>
          <span className="text-lg text-white/70 mb-1">credits</span>
        </div>
        {data.credits_held > 0 && (
          <div className="mt-3 inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-lg px-3 py-1.5 text-xs font-medium relative">
            <Lock className="w-3 h-3" />
            {data.credits_held} credits held (pending reply)
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 divide-x">
        <div className="px-4 py-4">
          <p className="text-xs text-muted-foreground">On hold</p>
          <p className="text-base font-bold text-amber-600 dark:text-amber-400 tabular-nums flex items-center gap-1 mt-0.5">
            <Lock className="w-3.5 h-3.5" />
            {data.credits_held.toLocaleString()}
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-xs text-muted-foreground">Total earned</p>
          <p className="text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums flex items-center gap-1 mt-0.5">
            <TrendingUp className="w-3.5 h-3.5" />
            {data.credits_total_earned.toLocaleString()}
          </p>
        </div>
        <div className="px-4 py-4">
          <p className="text-xs text-muted-foreground">Total spent</p>
          <p className="text-base font-bold text-primary dark:text-primary tabular-nums flex items-center gap-1 mt-0.5">
            <TrendingDown className="w-3.5 h-3.5" />
            {data.credits_total_spent.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

const WITHDRAW_STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-400",
  processing: "bg-primary/10 text-primary dark:bg-primary/50 dark:text-primary",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-400",
};

function WithdrawRequestRow({ w }: { w: RYNWithdrawRecord }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-primary/10 text-primary dark:bg-primary dark:text-primary">
        <Banknote className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          Withdrawal · {w.credits_requested} credits
          <span className="text-muted-foreground font-normal">
            {" "}
            (fee {w.credits_fee} → net {w.credits_net})
          </span>
        </p>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
          <Clock className="w-2.5 h-2.5" />
          {new Date(w.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          <span className="inline-flex items-center gap-0.5">
            {w.payment_method === "bank" ? (
              <Building2 className="w-3 h-3" />
            ) : (
              <Smartphone className="w-3 h-3" />
            )}
            {w.payment_method.toUpperCase()}
          </span>
          <span
            className={cn(
              "px-1.5 py-0.5 rounded text-[10px] font-medium capitalize",
              WITHDRAW_STATUS_BADGE[w.status] ?? "bg-muted text-muted-foreground"
            )}
          >
            {w.status}
          </span>
        </p>
      </div>
    </div>
  );
}

function WithdrawCreditsDialog({
  open,
  onOpenChange,
  availableBalance,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  availableBalance: number;
  onSuccess: () => void;
}) {
  const [creditsStr, setCreditsStr] = useState(String(MIN_WITHDRAW_CREDITS));
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "upi">("bank");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [upiId, setUpiId] = useState("");
  const [upiName, setUpiName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const creditsRequested = Math.max(0, parseInt(creditsStr, 10) || 0);
  const fee = Math.ceil((creditsRequested * PLATFORM_FEE_PERCENT) / 100);
  const net = creditsRequested - fee;

  function resetForm() {
    setCreditsStr(String(MIN_WITHDRAW_CREDITS));
    setPaymentMethod("bank");
    setBankAccountHolder("");
    setBankName("");
    setBankAccountNumber("");
    setBankIfsc("");
    setUpiId("");
    setUpiName("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (creditsRequested < MIN_WITHDRAW_CREDITS) {
      toast.error(`Minimum withdrawal is ${MIN_WITHDRAW_CREDITS} credits`);
      return;
    }
    if (creditsRequested > availableBalance) {
      toast.error("Amount exceeds your available balance");
      return;
    }
    const body: Record<string, unknown> = {
      credits_requested: creditsRequested,
      payment_method: paymentMethod,
    };
    if (paymentMethod === "bank") {
      body.bank_account_holder = bankAccountHolder.trim();
      body.bank_name = bankName.trim();
      body.bank_account_number = bankAccountNumber.trim();
      body.bank_ifsc = bankIfsc.trim();
    } else {
      body.upi_id = upiId.trim();
      body.upi_name = upiName.trim();
    }

    setSubmitting(true);
    try {
      await rynFetch("/ryn/withdraw", { method: "POST", body: JSON.stringify(body) });
      toast.success("Withdrawal request submitted");
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Withdraw credits
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Minimum {MIN_WITHDRAW_CREDITS} credits. A {PLATFORM_FEE_PERCENT}% platform fee is deducted from the amount you request; the remainder is the
              estimated payout after approval.
            </p>

            <div className="space-y-2">
              <Label htmlFor="wd-credits">Credits to withdraw</Label>
              <Input
                id="wd-credits"
                type="number"
                min={MIN_WITHDRAW_CREDITS}
                max={availableBalance}
                value={creditsStr}
                onChange={(e) => setCreditsStr(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Available: {availableBalance.toLocaleString()} · Fee (~{fee}) · Net (~{net})
              </p>
            </div>

            <div className="space-y-2">
              <Label>Payout method</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={paymentMethod === "bank" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => setPaymentMethod("bank")}
                >
                  <Building2 className="w-4 h-4" />
                  Bank
                </Button>
                <Button
                  type="button"
                  variant={paymentMethod === "upi" ? "default" : "outline"}
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => setPaymentMethod("upi")}
                >
                  <Smartphone className="w-4 h-4" />
                  UPI
                </Button>
              </div>
            </div>

            {paymentMethod === "bank" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wd-bh">Account holder name</Label>
                  <Input id="wd-bh" value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wd-bn">Bank name</Label>
                  <Input id="wd-bn" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wd-ban">Account number</Label>
                  <Input id="wd-ban" value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wd-ifsc">IFSC</Label>
                  <Input id="wd-ifsc" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value)} required className="font-mono uppercase" />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wd-upi">UPI ID</Label>
                  <Input id="wd-upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} required className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wd-un">Name as on UPI</Label>
                  <Input id="wd-un" value={upiName} onChange={(e) => setUpiName(e.target.value)} required />
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || creditsRequested < MIN_WITHDRAW_CREDITS || creditsRequested > availableBalance}>
              {submitting ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function RYNWithdrawPage() {
  const { user, isLoading, refreshUser } = useRYN();
  const [data, setData] = useState<CreditsData | null>(null);
  const [withdrawals, setWithdrawals] = useState<RYNWithdrawRecord[]>([]);
  const [fetching, setFetching] = useState(true);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    try {
      const [c, w] = await Promise.all([
        rynFetch("/ryn/credits"),
        rynFetch("/ryn/withdraw").catch(() => ({ withdrawals: [] as RYNWithdrawRecord[] })),
      ]);
      setData({
        credits_balance: c.credits_balance,
        credits_held: c.credits_held,
        credits_total_earned: c.credits_total_earned,
        credits_total_spent: c.credits_total_spent,
        transactions: c.transactions ?? [],
      });
      setWithdrawals(w.withdrawals ?? []);
    } catch {
      toast.error("Failed to load");
    } finally {
      setFetching(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleWithdrawSuccess() {
    await load();
    await refreshUser();
  }

  if (isLoading || fetching) {
    return (
      <RYNShell>
        <div className="p-6 max-w-4xl mx-auto space-y-4">
          <div className="h-40 rounded-2xl bg-muted animate-pulse" />
          <div className="h-6 w-48 rounded bg-muted animate-pulse" />
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        </div>
      </RYNShell>
    );
  }

  return (
    <RYNShell>
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-xl font-semibold">Withdrawals</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Request a payout to your bank or UPI. Withdrawal debits and refunds also appear in{" "}
            <Link href="/rent/credits" className="text-primary font-medium hover:underline">
              Credits &amp; Guide → Transaction history
            </Link>
            .
          </p>
        </div>

        {data && <BalanceCard data={data} />}

        {data && (
          <div className="rounded-2xl border bg-card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Banknote className="w-5 h-5 text-primary dark:text-primary" />
                  Request a payout
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Minimum {MIN_WITHDRAW_CREDITS} credits from your <strong>available</strong> balance. Each withdrawal is subject to a{" "}
                  {PLATFORM_FEE_PERCENT}% platform fee. Payouts are reviewed and processed manually after you submit a request.
                </p>
              </div>
              <Button
                type="button"
                className="shrink-0 gap-2"
                onClick={() => setWithdrawOpen(true)}
                disabled={data.credits_balance < MIN_WITHDRAW_CREDITS}
              >
                <Wallet className="w-4 h-4" />
                Request withdrawal
              </Button>
            </div>
            {data.credits_balance < MIN_WITHDRAW_CREDITS && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                You need at least {MIN_WITHDRAW_CREDITS} available credits to withdraw (you have {data.credits_balance}).
              </p>
            )}
            {withdrawals.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Your requests</p>
                <div className="rounded-xl border bg-muted/20 overflow-hidden divide-y">
                  {withdrawals.map((w) => (
                    <WithdrawRequestRow key={w.id} w={w} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <WithdrawCreditsDialog
          open={withdrawOpen}
          onOpenChange={setWithdrawOpen}
          availableBalance={data?.credits_balance ?? 0}
          onSuccess={handleWithdrawSuccess}
        />

        <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <Link href="/rent/credits" className="text-primary font-medium hover:underline">
            Credits &amp; Guide
          </Link>{" "}
          explains holds, earning, and spending — this page is only for cashing out.
        </div>
      </div>
    </RYNShell>
  );
}
