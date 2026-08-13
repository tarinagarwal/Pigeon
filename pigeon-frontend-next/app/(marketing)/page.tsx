import type { Metadata } from "next";
import {
  HomeHero,
  HowItWorks,
  CapabilityGrid,
  HomeFaq,
  HomeClosing,
} from "@/components/landing";
import { JsonLd } from "@/components/seo/JsonLd";
import { getFaqPageJsonLd, getHomeWebPageJsonLd, SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Email marketing isn't dead. The way you do it is. | Pigeon (open source)",
  description:
    "Mass blasts are dead — and the fix isn't infrastructure, personalization, servers, or warm-up. Pigeon is the open-source outbound platform with every feature the paid tools charge for, plus a social-first 'aware email' layer that earns recognition before touchpoint two.",
  keywords: [
    "open source email marketing",
    "open source cold email",
    "email marketing is dead",
    "cold email deliverability",
    "email warm-up alternative",
    "aware email",
    "social-first outbound",
    "self-hosted email outreach",
    "cold email platform comparison",
    "AI email marketing tool",
    "outbound GTM platform",
    "Pigeon",
  ],
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Email marketing isn't dead. The way you do it is. | Pigeon",
    description:
      "The open-source outbound platform. Every feature the paid tools charge for — plus a social-first 'aware email' layer. Mass blasts are over; familiarity is the lever.",
    url: SITE_URL,
    type: "website",
  },
};

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <JsonLd data={[getHomeWebPageJsonLd(), getFaqPageJsonLd()]} />
      <HomeHero />
      <HowItWorks />
      <CapabilityGrid />
      <HomeFaq />
      <HomeClosing />
    </div>
  );
}
