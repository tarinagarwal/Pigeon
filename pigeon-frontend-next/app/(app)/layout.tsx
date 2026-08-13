import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthLayoutClient } from "./AuthLayoutClient";
import { AuthLoadingScreen } from "@/components/AuthLoadingScreen";

export const metadata: Metadata = {
  title: {
    default: "Dashboard",
    template: "%s | Pigeon AI",
  },
  description:
    "Manage campaigns, track deliverability, and monitor outreach performance in Pigeon AI.",
  // Authenticated dashboard pages (e.g. /warmup) sit behind auth and only ever
  // render a loading/redirect screen to crawlers, so keep them out of the index.
  robots: { index: false, follow: false },
};

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AuthLoadingScreen message="Loading...." />}>
      <AuthLayoutClient>{children}</AuthLayoutClient>
    </Suspense>
  );
}
