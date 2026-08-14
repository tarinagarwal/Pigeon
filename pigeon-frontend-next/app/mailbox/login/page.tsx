"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMailbox } from "@/contexts/MailboxContext";
import { toast } from "sonner";

export default function MailboxLoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useMailbox();
  const [showPassword, setShowPassword] = useState(false);
  const [inboxEmail, setInboxEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/mailbox");
    }
  }, [isLoading, isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(inboxEmail.trim(), password);
      router.replace("/mailbox");
    } catch (err) {
      setPassword("");
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || isAuthenticated) {
    return (
      <div className="container max-w-md mx-auto px-4 pt-28 flex justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2">Mailbox sign in</h2>
        <p className="text-muted-foreground">
          Sign in with your mailbox email and password to view and manage emails for this inbox.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="inbox_email">Mailbox email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              id="inbox_email"
              type="email"
              placeholder="inbox@yourdomain.com"
              className="pl-10"
              value={inboxEmail}
              onChange={(e) => setInboxEmail(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/mailbox/forgot-password" className="text-sm text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              className="pl-10 pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>
        <Button
          type="submit"
          className="w-full gradient-primary hover:opacity-90 transition-opacity"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-8">
        First time? Use{" "}
        <Link href="/mailbox/forgot-password" className="text-primary font-medium hover:underline">
          Forgot password?
        </Link>{" "}
        and enter your mailbox email. A set-password link will be sent to the account owner&apos;s email.
      </p>
    </div>
  );
}
