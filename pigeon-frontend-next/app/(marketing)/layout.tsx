import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Best AI Email Marketing Tool to 10× Your Sales | Pigeon",
  description:
    "Boost your email marketing with Pigeon. Create AI-powered campaigns, personalize emails, automate follow-ups, improve deliverability, and convert more leads into customers.",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing-root min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
