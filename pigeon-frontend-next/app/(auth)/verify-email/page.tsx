"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { AuthLoadingScreen } from "@/components/AuthLoadingScreen";

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email") ?? "";
  const { verifyEmail, resendVerification, isAuthenticated, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState(emailParam);
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    setEmail((prev) => (emailParam && !prev ? emailParam : prev));
  }, [emailParam]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  if (authLoading || isAuthenticated) {
    return <AuthLoadingScreen message="Loading...." />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !code.trim()) {
      toast.error("Please enter your email and the verification code.");
      return;
    }
    setIsLoading(true);
    try {
      await verifyEmail(email.trim(), code.trim());
      toast.success("Email verified. Redirecting...");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || !email.trim()) return;
    setIsLoading(true);
    try {
      await resendVerification(email.trim());
      toast.success("Verification code sent. Check your email.");
      setResendCooldown(60);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to resend");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
          <Mail className="w-7 h-7 text-primary" />
        </div>
        <h2 className="font-display text-3xl font-black mb-2">Verify your email</h2>
        <p className="text-muted-foreground">We sent a 6-digit code to your email. Enter it below.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Email is taken from URL (?email=...) and kept in state; hidden from user */}
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
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        <Button type="submit" className="font-display w-full rounded-2xl border-[3px] border-foreground bg-primary py-6 text-[15px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]" disabled={isLoading || code.trim().length < 6}>
          {isLoading ? "Verifying..." : "Verify email"}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Didn&apos;t receive the code?{" "}
          <button type="button" onClick={handleResend} disabled={resendCooldown > 0 || isLoading} className="text-primary font-medium hover:underline disabled:opacity-50">
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
          </button>
        </p>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-8">
        <Link href="/login" className="text-primary font-medium hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen message="Loading...." />}>
      <VerifyEmailForm />
    </Suspense>
  );
}
