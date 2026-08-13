import type { Metadata } from "next";
import { Inter, Rubik, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import {
  SITE_URL,
  getOrganizationJsonLd,
  getWebSiteJsonLd,
  getSoftwareApplicationJsonLd,
} from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import NextTopLoader from "nextjs-toploader";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";

// Self-hosted via next/font — no render-blocking request to fonts.googleapis.com.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// Soft-brutalist pairing: Rubik's rounded terminals keep the heavy display type
// from turning harsh, with Space Grotesk carrying body and UI copy.
const rubik = Rubik({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const defaultTitle = "Best AI Email Marketing Tool to 10× Your Sales | Pigeon";
const defaultDescription =
  "Boost your email marketing with Pigeon. Create AI-powered campaigns, personalize emails, automate follow-ups, improve deliverability, and convert more leads into customers.";
const defaultKeywords =
  "AI email marketing tool, AI email marketing software, AI email campaigns, AI email automation, AI email sender, email marketing platform, personalized email marketing, email campaign automation, AI sales outreach, email marketing for businesses, lead generation software, email marketing automation, AI-powered email campaigns, sales email automation";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: defaultTitle,
    template: "%s | Pigeon AI",
  },
  description: defaultDescription,
  keywords: defaultKeywords,
  authors: [{ name: "Pigeon AI", url: SITE_URL }],
  creator: "Pigeon AI",
  publisher: "Pigeon AI",
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Pigeon AI",
    title: defaultTitle,
    description: defaultDescription,
    images: [
      {
        url: "/ogimage.png",
        width: 1200,
        height: 630,
        alt: "Best AI Email Marketing Tool to 10× Your Sales | Pigeon",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: defaultTitle,
    description: defaultDescription,
    images: ["/ogimage.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  alternates: {
    canonical: SITE_URL,
    types: {
      "text/plain": "/llms.txt",
    },
  },
  category: "technology",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const globalJsonLd = [
    getOrganizationJsonLd(),
    getWebSiteJsonLd(),
    getSoftwareApplicationJsonLd(),
  ];

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${rubik.variable} ${spaceGrotesk.variable} antialiased`}
        suppressHydrationWarning
      >
        <GoogleAnalytics />
        <NextTopLoader color="hsl(199 89% 48%)" />
        <JsonLd data={globalJsonLd} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
