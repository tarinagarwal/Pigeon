"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import type { Inbox } from "@/types/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

interface MailboxContextType {
  inbox: Inbox | null;
  userId: string | null;
  login: (inboxEmail: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refetchMe: () => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const MailboxContext = createContext<MailboxContextType | undefined>(undefined);

export function MailboxProvider({ children }: { children: ReactNode }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refetchMe = useCallback(async () => {
    try {
      const data = await api.mailbox.getMe();
      setInbox(data.inbox);
      setUserId(data.user_id);
    } catch {
      setInbox(null);
      setUserId(null);
    }
  }, []);

  useEffect(() => {
    const publicPaths = ["/mailbox/login", "/mailbox/forgot-password", "/mailbox/reset-password"];
    const isPublic = publicPaths.some((p) => pathname?.startsWith(p));
    if (!pathname?.startsWith("/mailbox")) {
      setIsLoading(false);
      return;
    }
    if (isPublic) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api.mailbox.getMe();
        if (!cancelled) {
          setInbox(data.inbox);
          setUserId(data.user_id);
        }
      } catch {
        if (!cancelled) {
          setInbox(null);
          setUserId(null);
          router.replace("/mailbox/login");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const login = useCallback(
    async (inboxEmail: string, password: string) => {
      const res = await fetch(`${API_BASE_URL}/auth/mailbox/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbox_email: inboxEmail.trim().toLowerCase(), password }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Invalid mailbox email or password");
      }
      const data = await res.json();
      setInbox(data.inbox);
      setUserId(data.inbox?.user_id ?? null);
      router.replace("/mailbox");
    },
    [router]
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/mailbox/logout`, { method: "POST", credentials: "include" });
    } finally {
      setInbox(null);
      setUserId(null);
      router.replace("/mailbox/login");
    }
  }, [router]);

  const value: MailboxContextType = {
    inbox,
    userId,
    login,
    logout,
    refetchMe,
    isLoading,
    isAuthenticated: !!inbox && !!userId,
  };

  return <MailboxContext.Provider value={value}>{children}</MailboxContext.Provider>;
}

export function useMailbox() {
  const ctx = useContext(MailboxContext);
  if (ctx === undefined) throw new Error("useMailbox must be used within MailboxProvider");
  return ctx;
}
