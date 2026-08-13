import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login | Pigeon AI",
  description: "Sign in to your Pigeon AI account to manage campaigns, contacts, and cold email outreach.",
  robots: { index: true, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
