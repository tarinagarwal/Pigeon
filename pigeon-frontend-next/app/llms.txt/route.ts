import { buildLlmsTxt } from "@/lib/site-knowledge";

/** GAIO: machine-readable site summary for LLM crawlers (llmstxt.org). */
export async function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
