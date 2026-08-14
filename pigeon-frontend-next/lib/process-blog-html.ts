import { isExternalUrl } from "@/lib/is-external-url";

const BOT_EXTERNAL_REL = "nofollow noopener noreferrer";

function mergeRelAttribute(attrs: string): string {
  const relMatch = attrs.match(/\brel=["']([^"']*)["']/i);
  if (relMatch) {
    const tokens = new Set(relMatch[1].split(/\s+/).filter(Boolean));
    tokens.add("nofollow");
    tokens.add("noopener");
    tokens.add("noreferrer");
    const merged = [...tokens].join(" ");
    return attrs.replace(relMatch[0], `rel="${merged}"`);
  }
  return `${attrs} rel="${BOT_EXTERNAL_REL}"`;
}

/** Add nofollow to external anchors in CMS HTML for search crawlers only. */
export function processBlogHtml(html: string, isBot: boolean): string {
  if (!isBot) return html;

  return html.replace(/<a\b([^>]*?)>/gi, (fullMatch, attrs: string) => {
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch || !isExternalUrl(hrefMatch[1])) return fullMatch;

    let nextAttrs = mergeRelAttribute(attrs);
    if (!/\btarget=/i.test(nextAttrs)) {
      nextAttrs = `${nextAttrs} target="_blank"`;
    }
    return `<a ${nextAttrs.trim()}>`;
  });
}
