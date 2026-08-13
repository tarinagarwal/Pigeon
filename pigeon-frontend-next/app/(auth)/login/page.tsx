"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, ArrowRight, ShieldCheck, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { AuthLoadingScreen } from "@/components/AuthLoadingScreen";

function getSafeRedirect(redirect: string | null): string {
  if (!redirect || typeof redirect !== "string") return "/dashboard";
  const path = redirect.trim();
  if (path.startsWith("/") && !path.startsWith("//")) return path;
  return "/dashboard";
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, verify2FA, resend2FA, isAuthenticated, isLoading: authLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [show2FAStep, setShow2FAStep] = useState(false);
  const [twoFaToken, setTwoFaToken] = useState("");
  const [twoFACode, setTwoFACode] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      const redirect = searchParams?.get("redirect");
      router.replace(getSafeRedirect(redirect ?? null));
    }
  }, [authLoading, isAuthenticated, router, searchParams]);

  useEffect(() => {
    const raw = searchParams?.get("email");
    if (raw) {
      try {
        setEmail(decodeURIComponent(raw).trim());
      } catch {
        setEmail(raw.trim());
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Only show the loading screen once we know the user is authenticated (a
  // redirect is in flight). During the initial unknown auth state we still
  // render the form so the page ships an <h1> in its HTML.
  if (isAuthenticated) {
    return <AuthLoadingScreen message="Loading..." />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const redirect = searchParams?.get("redirect");
      const result = await login(email, password, rememberMe, getSafeRedirect(redirect ?? null));
      if (result?.requires2FA && result?.twoFaToken) {
        setTwoFaToken(result.twoFaToken);
        setShow2FAStep(true);
        toast.success("Check your email for the verification code");
      } else if (result?.requiresEmailVerification && result?.email) {
        router.replace(`/verify-email?email=${encodeURIComponent(result.email)}`);
        toast.info("Please verify your email to continue");
      } else {
        toast.success("Logged in successfully");
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFaToken || twoFACode.trim().length < 6) {
      toast.error("Please enter the 6-digit code");
      return;
    }
    setIsLoading(true);
    try {
      const redirect = searchParams?.get("redirect");
      await verify2FA(twoFaToken, twoFACode.trim(), getSafeRedirect(redirect ?? null));
      toast.success("Logged in successfully");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Invalid code");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend2FA = async () => {
    if (resendCooldown > 0) return;
    setIsLoading(true);
    try {
      await resend2FA(twoFaToken);
      toast.success("A new code has been sent to your email");
      setResendCooldown(60);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to resend code");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setShow2FAStep(false);
    setTwoFaToken("");
    setTwoFACode("");
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl pt-20 pb-20">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_460px] gap-12 lg:gap-16 items-start">
      <aside className="hidden lg:block pt-2">
        <p className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-primary">
          Cold email, without the guesswork
        </p>
        <h2 className="font-display mt-4 text-3xl font-black leading-[1.1] text-foreground text-balance">
          Every mailbox warmed. Every reply in one place.
        </h2>
        <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
          Pigeon runs your sequences across the inboxes you already own, keeps them
          out of spam, and puts every reply in a single thread view.
        </p>
        <ul className="mt-8 flex flex-col gap-4">
          {[
            { t: "Warm-up that looks human", d: "Multi-turn threads with pairing risk scoring, not blast-and-hope." },
            { t: "Send from your own inboxes", d: "Gmail, Outlook or any SMTP host. No per-seat pricing." },
            { t: "Deliverability handled", d: "SPF, DKIM and DMARC written straight to your DNS provider." },
            { t: "Replies, not just opens", d: "A unified inbox with reply detection across every mailbox." },
          ].map((f) => (
            <li key={f.t} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
              <span>
                <span className="block text-[14.5px] font-bold text-foreground">{f.t}</span>
                <span className="block text-[13.5px] text-muted-foreground leading-relaxed">{f.d}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[13px] text-muted-foreground">
          MIT licensed and self-hostable —{" "}
          <Link href="/features" className="text-primary hover:underline">see everything included</Link>.
        </p>
      </aside>

      <div className="w-full rounded-3xl border-[3px] border-foreground bg-card p-7 shadow-[8px_8px_0_0_hsl(var(--foreground))] sm:p-8">
      {show2FAStep ? (
        <>
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
              <ShieldCheck className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-display text-3xl font-black mb-2">Two-factor authentication</h2>
            <p className="text-muted-foreground">Enter the 6-digit code sent to your email to complete sign in.</p>
          </div>
          <form onSubmit={handleVerify2FA} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="code">Verification code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="text-center text-lg tracking-[0.5em] font-mono"
                maxLength={6}
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <Button type="submit" className="font-display w-full rounded-2xl border-[3px] border-foreground bg-primary py-6 text-[15px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]" disabled={isLoading || twoFACode.trim().length < 6}>
              {isLoading ? "Verifying..." : "Verify & sign in"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Didn&apos;t receive the code?{" "}
              <button type="button" onClick={handleResend2FA} disabled={resendCooldown > 0 || isLoading} className="text-primary font-medium hover:underline disabled:opacity-50 disabled:cursor-not-allowed">
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
              </button>
            </p>
            <Button type="button" variant="ghost" className="font-display w-full rounded-2xl border-[3px] border-foreground bg-card py-6 text-[15px] font-bold text-foreground shadow-[4px_4px_0_0_hsl(var(--foreground))]" onClick={handleBackToLogin} disabled={isLoading}>
              Back to sign in
            </Button>
          </form>
        </>
      ) : (
        <>
          <div className="text-center mb-8">
            <h1 className="font-display text-3xl font-black mb-2">Welcome back</h1>
            <p className="text-muted-foreground">Sign in to continue to your dashboard</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input id="email" type="email" placeholder="name@company.com" className="rounded-xl border-[3px] border-foreground pl-10" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="rounded-xl border-[3px] border-foreground pl-10 pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="remember" checked={rememberMe} onCheckedChange={(v) => setRememberMe(!!v)} />
              <Label htmlFor="remember" className="text-sm font-normal">Remember me for 30 days</Label>
            </div>
            <Button type="submit" className="font-display w-full rounded-2xl border-[3px] border-foreground bg-primary py-6 text-[15px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign in"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </form>
        </>
      )}
      {/* Accounts are provisioned by the team, so make the two ways to reach us unmissable. */}
      <div className="mt-10 rounded-3xl border-[3px] border-foreground bg-[hsl(var(--sb-butter))] p-6 shadow-[6px_6px_0_0_hsl(var(--foreground))]">
        <p className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-primary">
          Need an account?
        </p>
        <p className="mt-2.5 text-[14.5px] text-foreground/85 leading-relaxed">
          Pigeon accounts are set up by our team — there&rsquo;s no self-serve sign-up. Reach out and
          we&rsquo;ll get you sending the same day.
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          <a
            href="mailto:tarinagarwal@gmail.com?subject=Pigeon%20account%20request"
            className="group flex items-center gap-3 rounded-2xl border-[3px] border-foreground bg-card px-4 py-3 shadow-[4px_4px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">Email</span>
              <span className="block truncate text-[14.5px] font-semibold text-foreground group-hover:text-primary">
                tarinagarwal@gmail.com
              </span>
            </span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </a>

          <a
            href="https://wa.me/919352023583"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 rounded-2xl border-[3px] border-foreground bg-card px-4 py-3 shadow-[4px_4px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <MessageCircle className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">WhatsApp</span>
              <span className="block truncate text-[14.5px] font-semibold text-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                +91 93520 23583
              </span>
            </span>
            <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-8">
        🔒 Your data is protected with enterprise-grade encryption
      </p>
      </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        // useSearchParams suspends during prerender, so this fallback is the
        // server-rendered HTML — keep the <h1> here for SEO and accessibility.
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
          <div className="text-center mb-8">
            <h1 className="font-display text-3xl font-black mb-2">Welcome back</h1>
            <p className="text-muted-foreground">Sign in to continue to your dashboard</p>
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
