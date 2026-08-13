"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { AuthLoadingScreen } from "@/components/AuthLoadingScreen";
import { AppLayout } from "@/components/layout/AppLayout";
import { SupportBot } from "@/components/support/SupportBot";

export function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isDemo = searchParams?.get("demo") === "1";
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // When demo=1, wait for auth to load from server (cookies/session) - don't redirect immediately
    if (isDemo) return;
    if (!isLoading && !isAuthenticated) {
      const returnTo = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
      const loginUrl = returnTo ? `/login?redirect=${encodeURIComponent(returnTo)}` : "/login";
      router.replace(loginUrl);
    }
  }, [isLoading, isAuthenticated, router, pathname, searchParams, isDemo]);

  if (isLoading) {
    return <AuthLoadingScreen message="Loading..." />;
  }

  if (!isAuthenticated) {
    // When demo=1, keep showing loading instead of redirecting - server may still be setting up demo session
    if (isDemo) {
      return <AuthLoadingScreen message="Loading demo..." />;
    }
    return <AuthLoadingScreen message="Redirecting to login..." />;
  }

  return (
    <>
      <AppLayout>{children}</AppLayout>
      {/* Render support bot only on the client after hydration to avoid React static style issues */}
      {mounted && <SupportBot />}
    </>
  );
}
