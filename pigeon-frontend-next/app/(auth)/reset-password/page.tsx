"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      toast.error("Invalid or missing reset link. Request a new one from the forgot password page.");
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to reset password");
      }
      setSuccess(true);
      toast.success("Password updated. You can sign in now.");
      setTimeout(() => router.replace("/login"), 2000);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
            <Lock className="w-7 h-7 text-primary" />
          </div>
          <h2 className="font-display text-3xl font-black mb-2">Password updated</h2>
          <p className="text-muted-foreground">Redirecting you to sign in...</p>
        </div>
        <Link href="/login">
          <Button className="w-full gradient-primary">Sign in</Button>
        </Link>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
        <div className="text-center mb-8">
          <h2 className="font-display text-3xl font-black mb-2">Invalid reset link</h2>
          <p className="text-muted-foreground">This link is invalid or expired. Request a new password reset.</p>
        </div>
        <Link href="/forgot-password">
          <Button className="w-full gradient-primary">Request new link</Button>
        </Link>
        <p className="text-center text-sm text-muted-foreground mt-6">
          <Link href="/login" className="text-primary font-medium hover:underline">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl font-black mb-2">Set new password</h2>
        <p className="text-muted-foreground">Choose a strong password (at least 8 characters).</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              className="rounded-xl border-[3px] border-foreground pl-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <Button type="submit" className="font-display w-full rounded-2xl border-[3px] border-foreground bg-primary py-6 text-[15px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]" disabled={isLoading}>
          {isLoading ? "Updating..." : "Update password"}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-8">
        <Link href="/login" className="text-primary font-medium hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center">Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
