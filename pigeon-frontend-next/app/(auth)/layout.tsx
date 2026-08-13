import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AuthDemoGuard } from "@/components/auth/AuthDemoGuard";

export const metadata: Metadata = {
  title: "Pigeon AI – Sign in",
  description: "Sign in or sign up to manage your cold email campaigns and improve deliverability.",
  robots: { index: true, follow: true },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <div className="flex-1">
        <AuthDemoGuard>{children}</AuthDemoGuard>
      </div>
      <Footer />
    </div>
  );
}
