import { BRAND_SUMMARY, SITE_FAQS, type SiteFaq } from "@/lib/site-knowledge";

/** Shared base URL and images for SEO */
export const SITE_NAME = "Pigeon";
export const SITE_NAME_FULL = "Pigeon AI";
export const SITE_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_SITE_URL) ||
  "https://www.pigeon.com";
/** Logo for JSON-LD / schema (Organization, publisher) */
export const LOGO_URL = `${SITE_URL}/logo.png`;
/** OG/Twitter card image */
export const OG_IMAGE = `${SITE_URL}/ogimage.png`;

const ORG_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;

/** JSON-LD Organization — entity clarity for Google and generative AI (GAIO). */
export function getOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    alternateName: [SITE_NAME_FULL, "Pigeon cold email"],
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: LOGO_URL,
    },
    description: BRAND_SUMMARY,
    knowsAbout: [
      "AI email marketing software",
      "Email campaign automation",
      "AI-powered email personalization",
      "Sales email automation",
      "Email marketing for businesses",
      "Lead generation software",
    ],
  };
}

/** JSON-LD WebSite — sitewide context for search and AI answers. */
export function getWebSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: SITE_NAME_FULL,
    alternateName: SITE_NAME,
    url: SITE_URL,
    description: BRAND_SUMMARY,
    inLanguage: "en-US",
    publisher: { "@id": ORG_ID },
  };
}

/** JSON-LD SoftwareApplication — product entity for SaaS / cold email category. */
export function getSoftwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_ID,
    name: SITE_NAME,
    alternateName: SITE_NAME_FULL,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Email Marketing Software",
    operatingSystem: "Web",
    url: SITE_URL,
    description: BRAND_SUMMARY,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free trial available; see pricing page for paid plans",
      url: `${SITE_URL}/features`,
    },
    featureList: [
      "AI email campaign creation and personalization",
      "Automated multi-step email sequences and follow-ups",
      "Email personalization at scale with per-contact AI variations",
      "Inbox placement optimization and reputation management",
      "Unified reply inbox for all campaign responses",
      "Real-time analytics — opens, clicks, replies, and ROI",
    ],
    provider: { "@id": ORG_ID },
  };
}

/** JSON-LD FAQPage — Q&A format preferred by AI answer engines (GAIO / AEO). */
export function getFaqPageJsonLd(faqs: SiteFaq[] = SITE_FAQS) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

/** Homepage WebPage linked to site and product entities. */
export function getHomeWebPageJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/#webpage`,
    url: SITE_URL,
    name: "Best AI Email Marketing Tool to 10× Your Sales | Pigeon",
    description: BRAND_SUMMARY,
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": SOFTWARE_ID },
    publisher: { "@id": ORG_ID },
    inLanguage: "en-US",
  };
}

/** JSON-LD for a single resource/guide article (Article schema). */

export type BlogPostForJsonLd = {
  title?: string;
  excerpt?: string | null;
  featured_image_url?: string | null;
  created_at?: string;
  updated_at?: string | null;
};

/** JSON-LD for a single blog post (BlogPosting schema for Google) */
export function getBlogPostJsonLd(
  post: BlogPostForJsonLd,
  slug: string
) {
  const url = `${SITE_URL}/blog/${encodeURIComponent(slug)}`;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post?.title ?? "Blog Post",
    description: post?.excerpt ?? undefined,
    image: post?.featured_image_url ?? undefined,
    datePublished: post?.created_at ?? undefined,
    dateModified: post?.updated_at ?? post?.created_at ?? undefined,
    url,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    author: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: LOGO_URL,
      },
    },
  };
}
