/**
 * Template body is stored as HTML. These helpers convert between HTML (stored)
 * and plain text (Visual Editor display).
 */

/**
 * Convert HTML to plain text for the Visual Editor.
 * Preserves line breaks from <br>, <p>, </div>, etc.
 */
export function htmlToPlainText(html: string): string {
  if (!html?.trim()) return "";
  const normalized = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<tr>/gi, "\n");
  const div = typeof document !== "undefined" ? document.createElement("div") : null;
  if (div) {
    div.innerHTML = normalized;
    const text = (div.textContent || div.innerText || "").replace(/\r\n/g, "\n").trim();
    return text.replace(/\n{3,}/g, "\n\n");
  }
  // SSR/fallback: strip tags
  return normalized
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Short plain-text preview for collapsed email thread rows (Gmail-style strip). */
export function threadSnippet(html: string | undefined, plainFallback: string): string {
  const raw = html?.trim() ? html : plainFallback;
  const t = htmlToPlainText(raw || "");
  const s = t.replace(/\s+/g, " ").trim();
  if (!s) return "—";
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

/**
 * Convert plain text from Visual Editor to HTML for storage.
 * Escapes HTML and converts newlines to <br>.
 */
export function plainTextToHtml(text: string): string {
  if (!text?.trim()) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped.replace(/\n/g, "<br>\n");
}

/**
 * Detect if a string looks like HTML (has tags).
 * Used to support legacy templates that were stored as plain text.
 */
export function looksLikeHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str?.trim() ?? "");
}

/** Sample values used for template preview (placeholders shown as sample data). */
export const TEMPLATE_PREVIEW_SAMPLE: Record<string, string> = {
  first_name: "John",
  last_name: "Doe",
  /** Same values as snake_case — matches backend EmailService camelCase aliases. */
  firstName: "John",
  lastName: "Doe",
  email: "john.doe@example.com",
  company: "Acme Inc",
  industry: "Technology",
  title: "CEO",
  /** Replaced per send with the real /api/unsubscribe/{email_log_id} URL on the API host. */
  unsubscribe_url: "https://track.example.com/api/unsubscribe/preview-token",
};

/** Sample values for warmup preview — only sender_* and receiver_* (matches backend warmup sends). */
export const WARMUP_PREVIEW_SAMPLE: Record<string, string> = {
  sender_name: "Alex Morgan",
  sender_email: "alex@yourdomain.com",
  senderName: "Alex Morgan",
  senderEmail: "alex@yourdomain.com",
  receiver_name: "John Doe",
  receiver_email: "john.doe@example.com",
  receiverName: "John Doe",
  receiverEmail: "john.doe@example.com",
  first_name: "",
  last_name: "",
  firstName: "",
  lastName: "",
  email: "",
  name: "",
  company: "",
  industry: "",
  title: "",
  inbox_name: "",
  inbox_email: "",
  inboxName: "",
  inboxEmail: "",
};

/**
 * Parse spintax {option1|option2|option3} and pick one option at random.
 * Supports {{placeholder}} inside options (same logic as backend).
 * Used for template preview so Spintax resolves in preview.
 */
export function parseSpintax(text: string): string {
  if (!text?.trim()) return text;
  // Allow content to include {{...}} so {Hi {{company}} | Hello {{company}}} matches
  const spintaxOuter = /\{((?:[^{}]|\{\{[^}]*\}\})*)\}/g;
  const doubleBrace = /\{\{[^}]*\}\}/g;

  let out = text;
  for (let iter = 0; iter < 100; iter++) {
    const next = out.replace(spintaxOuter, (full, content) => {
      if (!content.includes("|")) return full;
      const placeholders: string[] = [];
      const contentSafe = content.replace(doubleBrace, (m: string) => {
        placeholders.push(m);
        return `\x00PH_${placeholders.length - 1}\x00`;
      });
      const options = contentSafe.split("|").map((s: string) => s.trim()).filter(Boolean);
      if (!options.length) return full;
      const chosen = options[Math.floor(Math.random() * options.length)];
      return placeholders.reduce(
        (acc, ph, i) => acc.replace(`\x00PH_${i}\x00`, ph),
        chosen
      );
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Replace {{placeholder}} and {placeholder} in text with the given values map.
 * Applies Spintax first, then placeholders. Keys in values are case-insensitive for replacement.
 * Used for preview with a real contact (e.g. random from selected list).
 */
export function replacePlaceholdersWithValues(text: string, values: Record<string, string>): string {
  if (!text?.trim()) return text;
  const withSpintax = parseSpintax(text);
  let out = withSpintax;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const str = String(value);
    const reDouble = new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, "gi");
    const reSingle = new RegExp(`\\{${escapeRegExp(key)}\\}`, "gi");
    out = out.replace(reDouble, str).replace(reSingle, str);
  }
  return out;
}

/**
 * Replace {{placeholder}} and {placeholder} in text with sample values.
 * Applies Spintax first (so {Hi {{company}}|Hello {{company}}} resolves), then placeholders.
 * Used for template preview when no contact list is selected.
 */
export function replacePlaceholdersWithSample(text: string): string {
  return replacePlaceholdersWithValues(text, TEMPLATE_PREVIEW_SAMPLE);
}

/** Preview warmup subject/body: spintax (random) then merge fields using {@link WARMUP_PREVIEW_SAMPLE}. */
export function replacePlaceholdersWithWarmupSample(text: string): string {
  return replacePlaceholdersWithValues(text, WARMUP_PREVIEW_SAMPLE);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
