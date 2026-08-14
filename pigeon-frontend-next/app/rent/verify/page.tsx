"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRYN } from "@/contexts/RYNContext";

function VerifyContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { verifyEmail, resendVerification } = useRYN();

  const email = params.get("email") ?? "";
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await verifyEmail(email, otp.trim());
      toast.success("Email verified. Welcome aboard.");
      router.replace("/rent/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not verify that code.");
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendVerification(email);
      setCooldown(60);
      toast.success("New code sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend the code.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--sb-cream))] px-4 py-16">
      <div className="w-full max-w-[440px]">
        <div className="rounded-3xl border-[3px] border-foreground bg-card p-7 shadow-[8px_8px_0_0_hsl(var(--foreground))] sm:p-9">
          <Image
            src="/rent-mark.png"
            alt=""
            width={1129}
            height={957}
            sizes="120px"
            priority
            className="mx-auto h-16 w-auto"
          />
          <h1 className="font-display mt-5 text-center text-2xl font-black text-foreground">
            Check your email
          </h1>
          <p className="mt-2 text-center text-[14px] leading-relaxed text-foreground/70">
            We sent a 6-digit code to{" "}
            <span className="font-semibold text-foreground">{email || "your inbox"}</span>.
          </p>

          <form onSubmit={handleVerify} className="mt-7 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                required
                className="rounded-xl border-[3px] border-foreground text-center text-2xl font-black tracking-[0.4em]"
              />
            </div>

            <Button
              type="submit"
              disabled={submitting || otp.length < 6}
              className="font-display w-full rounded-2xl border-[3px] border-foreground bg-primary py-6 text-[15px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]"
            >
              {submitting ? "Verifying…" : "Verify & continue"}
            </Button>
          </form>

          <p className="mt-5 text-center text-[13.5px] text-foreground/70">
            Didn&apos;t get it?{" "}
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0}
              className="font-semibold text-primary hover:underline disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </p>
        </div>

        <p className="mt-5 text-center text-[13px] text-foreground/60">
          Wrong address?{" "}
          <Link href="/rent/signup" className="font-semibold text-primary hover:underline">
            Sign up again
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RentVerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  );
}
