"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const USER_KEY = "auth_user";

export function ImpersonateClient({ token }: { token: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token?.trim()) {
      setError("Missing impersonation token");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/impersonate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
          credentials: "include",
        });

        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.detail || "Invalid or expired token");
          return;
        }

        const data = await res.json();
        if (data.user) {
          sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        }
        router.replace("/dashboard");
      } catch (err) {
        if (!cancelled) setError("Failed to sign in. Please try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-center text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => router.push("/login")}>
          Go to Login
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-muted-foreground">Signing you in…</p>
    </div>
  );
}
