"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Mail, Lock, Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRYN } from "@/contexts/RYNContext";
import { toast } from "sonner";

export default function RYNLoginPage() {
  const { login, isLoading } = useRYN();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      toast.success("Welcome back!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--sb-cream))] px-4 py-14 sm:py-20">
    <div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16">
      <aside className="hidden lg:block">
        <span className="font-display inline-block rounded-full border-[3px] border-foreground bg-[hsl(var(--sb-butter))] px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.1em] text-foreground">
          Rent &amp; Earn
        </span>
        <h2 className="font-display mt-6 text-4xl font-black leading-[0.98] text-foreground">
          Idle inboxes,
          <span className="mt-2 block">
            <span className="inline-block rounded-2xl border-[3px] border-foreground bg-primary px-3 py-0.5 text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))]">
              earning credits.
            </span>
          </span>
        </h2>
        <div className="mt-9 flex flex-col gap-4">
          {[
            { p: "peach", t: "List what you own", d: "Verify an address, set its daily receive cap, and it starts earning." },
            { p: "mint", t: "One credit per use", d: "Held 48 hours, then released. Refunded to the sender if there is no engagement." },
            { p: "lilac", t: "Cash out", d: "Withdraw to bank or UPI once you clear 500 credits." },
          ].map((f) => (
            <div
              key={f.t}
              className="rounded-2xl border-[3px] border-foreground p-5 shadow-[5px_5px_0_0_hsl(var(--foreground))]"
              style={{ background: `hsl(var(--sb-${f.p}))` }}
            >
              <p className="font-display text-[15px] font-black text-foreground">{f.t}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-foreground/70">{f.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-7 text-[13px] text-foreground/60">Separate from your main Pigeon account.</p>
      </aside>


      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute top-1/2 -left-40 h-72 w-72 rounded-full bg-primary/[0.07] blur-3xl" />
      </div>

      <div className="w-full max-w-[440px] space-y-6 rounded-3xl border-[3px] border-foreground bg-card p-7 shadow-[8px_8px_0_0_hsl(var(--foreground))] sm:p-9">
        {/* Header */}
        <div className="text-center space-y-3">
          <Image
            src="/rent-mark.png"
            alt=""
            width={1129}
            height={957}
            sizes="140px"
            priority
            className="h-20 w-auto mx-auto"
          />
          <div>
            <h1 className="font-display text-2xl font-black">Welcome back</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Sign in to manage your listings, credits and payouts
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9 pr-9"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="font-display w-full rounded-2xl border-[3px] border-foreground bg-primary py-6 text-[15px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/rent/signup" className="text-primary hover:underline font-medium">
            Create a free account
          </Link>
        </p>

        <div className="rounded-2xl border border-border bg-muted/30 p-5">
          <p className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-primary">
            What you get
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {[
              "List email addresses you own and earn credits when they are rented",
              "Spend credits to reach other members' verified inboxes",
              "Withdraw earnings to a bank account or UPI",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-[13.5px] text-muted-foreground leading-relaxed">
                <Check className="w-3.5 h-3.5 mt-1 shrink-0 text-primary" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[12.5px] text-muted-foreground">
            This account is separate from your main{" "}
            <Link href="/" className="text-primary hover:underline">Pigeon</Link> login.
          </p>
        </div>
      </div>
    </div>
    </div>
  );
}