/**
 * Compliance check helpers using user settings (spam words, max links, max images, unsubscribe).
 * Used by Templates and Campaigns to validate content before save/send.
 */

export type ComplianceSettings = {
  spam_words?: string;
  max_links_per_email?: number;
  max_images_per_email?: number;
  require_unsubscribe_link?: boolean;
};

export type ComplianceResult = {
  linkCount: number;
  linkMax: number;
  linkOk: boolean;
  imageCount: number;
  imageMax: number;
  imageOk: boolean;
  spamWordsFound: string[];
  spamOk: boolean;
  hasUnsubscribe: boolean;
  unsubscribeOk: boolean;
  allOk: boolean;
};

const DEFAULT_MAX_LINKS = 3;
const DEFAULT_MAX_IMAGES = 2;

/** Count URLs in text (http/https) */
export function countLinks(text: string): number {
  if (!text || typeof text !== "string") return 0;
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi);
  return matches ? matches.length : 0;
}

/** Count image references: <img ...> or markdown ![alt](url) */
export function countImages(text: string): number {
  if (!text || typeof text !== "string") return 0;
  let count = 0;
  count += (text.match(/<img\s[^>]*>/gi) || []).length;
  count += (text.match(/!\[[^\]]*\]\s*\([^)]+\)/g) || []).length;
  return count;
}

/** Parse spam words string into list of lowercased tokens */
export function getSpamWordsList(spamWords: string | undefined): string[] {
  if (!spamWords || typeof spamWords !== "string") return [];
  return spamWords
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

/** Find which spam words appear in text (case-insensitive) */
export function findSpamWordsInText(text: string, spamList: string[]): string[] {
  if (!text || !spamList.length) return [];
  const lower = text.toLowerCase();
  return spamList.filter((word) => {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "i");
    return re.test(lower);
  });
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove spam words from text (whole-word match, case-insensitive). Replaces with space to avoid gluing words; collapses extra spaces, preserves newlines. */
export function removeSpamWordsFromText(text: string, spamList: string[]): string {
  if (!text || typeof text !== "string") return text;
  if (!spamList.length) return text;
  let out = text;
  for (const word of spamList) {
    if (!word) continue;
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
    out = out.replace(re, " ");
  }
  return out.replace(/  +/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/** Check if text contains an unsubscribe-style link or phrase */
export function hasUnsubscribeLink(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  if (/\{\{?\s*unsubscribe_url\s*\}?\}/i.test(text)) return true;
  const lower = text.toLowerCase();
  return (
    /\bunsubscribe\b/i.test(lower) ||
    /\bopt[- ]?out\b/i.test(lower) ||
    /unsubscribe\s*<\/?a/i.test(lower) ||
    /href\s*=\s*["'][^"']*unsubscribe/i.test(lower)
  );
}

/** Strip HTML tags for text analysis */
function stripHtml(html: string): string {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** Check if body has a greeting-like start and a sign-off (reduces spam risk). */
export function hasGreetingAndSignature(body: string): boolean {
  if (!body || typeof body !== "string") return false;
  const text = stripHtml(body);
  const first = text.slice(0, 120).toLowerCase();
  const rest = text.slice(120).toLowerCase();
  const greetings = /\b(hi|hello|hey|dear|greetings|good morning|good afternoon)\b/i;
  const signoffs = /\b(best|regards|thanks|thank you|cheers|sincerely|kind regards|talk soon)\b/i;
  const hasGreeting = greetings.test(first);
  const hasSignoff = signoffs.test(rest) || /\{\{.*\}\}/.test(text);
  return hasGreeting && (hasSignoff || text.length < 200);
}

/** Run full compliance check on content (subject + body combined). */
export function runComplianceCheck(
  content: string,
  compliance: ComplianceSettings | undefined
): ComplianceResult {
  const linkMax = compliance?.max_links_per_email ?? DEFAULT_MAX_LINKS;
  const imageMax = compliance?.max_images_per_email ?? DEFAULT_MAX_IMAGES;
  const requireUnsub = compliance?.require_unsubscribe_link ?? false;
  const spamList = getSpamWordsList(compliance?.spam_words);

  const linkCount = countLinks(content);
  const imageCount = countImages(content);
  const spamWordsFound = findSpamWordsInText(content, spamList);
  const hasUnsubscribe = hasUnsubscribeLink(content);

  const linkOk = linkCount <= linkMax;
  const imageOk = imageCount <= imageMax;
  const spamOk = spamWordsFound.length === 0;
  const unsubscribeOk = !requireUnsub || hasUnsubscribe;
  const allOk = linkOk && imageOk && spamOk && unsubscribeOk;

  return {
    linkCount,
    linkMax,
    linkOk,
    imageCount,
    imageMax,
    imageOk,
    spamWordsFound: [...spamWordsFound],
    spamOk,
    hasUnsubscribe,
    unsubscribeOk,
    allOk,
  };
}
