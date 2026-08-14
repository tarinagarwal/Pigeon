"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function MailboxForgotPasswordPage() {
  const [inboxEmail, setInboxEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inboxEmail.trim()) {
      toast.error("Please enter your mailbox email.");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/mailbox/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox_email: inboxEmail.trim().toLowerCase() }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to send reset link");
      }
      setSent(true);
      toast.success("If this mailbox exists, a set/reset password link has been sent to the account owner's email.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
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
          <h2 className="text-3xl font-bold mb-2">Check the account owner&apos;s email</h2>
          <p className="text-muted-foreground">
            If a mailbox exists for {inboxEmail}, we sent a set/reset password link to the account owner&apos;s email.
            Check that inbox (and spam folder).
          </p>
        </div>
        <Link href="/mailbox/login">
          <Button variant="outline" className="w-full">Back to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-md pt-28 pb-16">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-2">Set or reset mailbox password</h2>
        <p className="text-muted-foreground">
          Enter your mailbox email. We&apos;ll send a set/reset password link to the account owner&apos;s email so you can set or reset the password for this mailbox.
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
        <Button
          type="submit"
          className="w-full gradient-primary hover:opacity-90 transition-opacity"
          disabled={isLoading}
        >
          {isLoading ? "Sending..." : "Send set/reset link"}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground mt-8">
        <Link href="/mailbox/login" className="text-primary font-medium hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
