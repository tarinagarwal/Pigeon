"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const DEMO_STORAGE_KEY = "demo_mode";

/**
 * When user lands on any auth page (signup, login, etc.) with demo mode in storage
 * (e.g. from a reload during/after the interactive demo), clear demo and redirect to signup.
 */
export function AuthDemoGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { clearDemoUser } = useAuth();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(DEMO_STORAGE_KEY) === "1") {
      clearDemoUser();
      if (pathname !== "/login") {
        router.replace("/login");
      }
    }
  }, [pathname, clearDemoUser, router]);

  return <>{children}</>;
}
