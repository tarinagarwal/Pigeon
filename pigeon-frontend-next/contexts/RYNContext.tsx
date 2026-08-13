"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface RYNUser {
  id: string;
  email: string;
  full_name: string;
  bio?: string;
  status: string;
  credits_balance: number;  // available (released) credits
  credits_held: number;     // earned but under 48-hr hold
  credits_total_earned: number;
  credits_total_spent: number;
  created_at: string;
  updated_at: string;
}

export interface RYNListing {
  id: string;
  owner_id: string;
  email: string;
  note?: string;
  display_name?: string;
  niche?: string;
  description?: string;
  credits_per_use: number;
  daily_receive_limit: number;
  mx_ok: boolean;
  provider: string | null;
  status: string;
  times_rented: number;
  credits_earned: number;
  created_at: string;
  updated_at: string;
}

export interface RYNTransaction {
  id: string;
  user_id: string;
  amount: number;
  type:
    | "earn"
    | "earn_held"
    | "earn_expired"
    | "spend"
    | "bonus"
    | "refund"
    | "withdraw";
  description: string;
  listing_id?: string;
  withdraw_id?: string;
  created_at: string;
}

interface RYNContextValue {
  user: RYNUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string) => Promise<{ verificationRequired?: boolean; email?: string }>;
  verifyEmail: (email: string, otp: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const RYNContext = createContext<RYNContextValue | null>(null);

// Paths that don't require auth. /rent itself is the public landing page.
const RYN_PUBLIC_PATHS = ["/rent/login", "/rent/signup", "/rent/verify", "/rent"];
// Paths that require auth (redirect to login if not authed)
const RYN_PROTECTED_PREFIXES = ["/rent/dashboard", "/rent/emails", "/rent/activity", "/rent/credits", "/rent/withdraw"];

function formatFetchErrorDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: string }).msg);
        }
        return JSON.stringify(item);
      })
      .join(" ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return "";
}

async function rynFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = formatFetchErrorDetail(data.detail) || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

export function RYNProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<RYNUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await rynFetch("/ryn/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setIsLoading(false));
  }, [refreshUser]);

  // Redirect unauthenticated users away from protected /rent pages
  useEffect(() => {
    if (isLoading) return;
    const isProtected = RYN_PROTECTED_PREFIXES.some((p) => pathname?.startsWith(p));
    const isAuthPage = ["/rent/login", "/rent/signup", "/rent/verify"].some((p) => pathname?.startsWith(p));
    if (!user && isProtected) {
      router.replace("/rent/login");
    }
    if (user && isAuthPage) {
      router.replace("/rent/dashboard");
    }
  }, [isLoading, user, pathname, router]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await rynFetch("/ryn/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user);
  }, []);

  const signup = useCallback(
    async (email: string, password: string, fullName: string) => {
      // No session is issued here — the account stays unverified until the
      // emailed code is confirmed via verifyEmail().
      const data = await rynFetch("/ryn/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, full_name: fullName }),
      });
      if (data?.user) setUser(data.user);
      return { verificationRequired: !!data?.verification_required, email: data?.email };
    },
    []
  );

  const verifyEmail = useCallback(async (email: string, otp: string) => {
    const data = await rynFetch("/ryn/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, otp }),
    });
    setUser(data.user);
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    await rynFetch("/ryn/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }, []);

  const logout = useCallback(async () => {
    await rynFetch("/ryn/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    router.push("/rent/login");
  }, [router]);

  return (
    <RYNContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        verifyEmail,
        resendVerification,
        logout,
        refreshUser,
      }}
    >
      {children}
    </RYNContext.Provider>
  );
}

export function useRYN() {
  const ctx = useContext(RYNContext);
  if (!ctx) throw new Error("useRYN must be used inside RYNProvider");
  return ctx;
}

// Standalone fetch helper for pages to call RYN API
export { rynFetch };
