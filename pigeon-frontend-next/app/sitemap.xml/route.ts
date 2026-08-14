/**
 * Serve sitemap XML: static pages + published blog posts from MongoDB.
 * No dependency on backend API.
 */


const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.pigeon.com").replace(
  /\/$/,
  ""
);

const SITEMAP_STATIC: Array<[
string, string, string]> = [
  ["/", "weekly", "1.0"],
  ["/features", "monthly", "0.9"],
  ["/pricing", "weekly", "0.9"],
  ["/contact", "monthly", "0.8"],
  ["/login", "monthly", "0.6"],
  ["/login", "monthly", "0.8"],
  ["/forgot-password", "yearly", "0.4"],
  ["/campaign-replies", "monthly", "0.6"],

];




function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">',
  ];

  for (const [path, changefreq, priority] of [
    ...SITEMAP_STATIC,
  ]) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(`${SITE_URL}${path}`)}</loc>`);
    lines.push(`    <lastmod>${today}</lastmod>`);
    lines.push(`    <changefreq>${changefreq}</changefreq>`);
    lines.push(`    <priority>${priority}</priority>`);
    lines.push("  </url>");
  }


  lines.push("</urlset>");
  const xml = lines.join("\n");

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
