"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Please enter your email.");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to send reset link");
      }
      setSent(true);
      toast.success("If an account exists, we sent a reset link to your email.");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
            <Mail className="w-7 h-7 text-primary" />
          </div>
          <h2 className="font-display text-3xl font-black mb-2">Check your email</h2>
          <p className="text-muted-foreground">
            If an account exists for {email}, we sent a password reset link. Check your inbox and spam folder.
          </p>
        </div>
        <Link href="/login">
          <Button variant="outline" className="font-display w-full rounded-2xl border-[3px] border-foreground bg-primary py-6 text-[15px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]">Back to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl font-black mb-2">Forgot password?</h2>
        <p className="text-muted-foreground">Enter your email and we&apos;ll send you a reset link.</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              placeholder="name@company.com"
              className="rounded-xl border-[3px] border-foreground pl-10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>
        <Button type="submit" className="font-display w-full rounded-2xl border-[3px] border-foreground bg-primary py-6 text-[15px] font-bold text-primary-foreground shadow-[5px_5px_0_0_hsl(var(--foreground))] transition-transform hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_hsl(var(--foreground))]" disabled={isLoading}>
          {isLoading ? "Sending..." : "Send reset link"}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-8">
        <Link href="/login" className="text-primary font-medium hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
