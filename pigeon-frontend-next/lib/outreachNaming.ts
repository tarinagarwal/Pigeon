/**
 * Naming convention for outreach templates: {Base} - S{sequence} - V{version}
 * e.g. "Pigeon Outreach - S1 - V1", "Pigeon Outreach - S1 - V2", "Pigeon Outreach - S2 - V1"
 */

import type { EmailTemplate } from "@/types/api";

export const DEFAULT_OUTREACH_BASE = "Outreach";

/** Match name ending with " - S{n} - V{m}" and capture base, S, V */
const OUTREACH_NAME_REGEX = /^(.+?)\s*-\s*S(\d+)\s*-\s*V(\d+)$/;

export interface ParsedOutreachName {
  base: string;
  S: number;
  V: number;
}

/**
 * Parse a template name that follows the outreach pattern.
 * @param name - Full template name
 * @param base - Optional base to validate against (if provided, parsed base must match)
 * @returns Parsed { base, S, V } or null if pattern doesn't match
 */
export function parseOutreachName(
  name: string,
  base?: string
): ParsedOutreachName | null {
  if (!name || typeof name !== "string") return null;
  const trimmed = name.trim();
  const match = trimmed.match(OUTREACH_NAME_REGEX);
  if (!match) return null;
  const parsedBase = match[1].trim();
  const S = parseInt(match[2], 10);
  const V = parseInt(match[3], 10);
  if (base !== undefined && parsedBase !== base.trim()) return null;
  return { base: parsedBase, S, V };
}

/**
 * Get the next template name for the given action.
 * - new_sequence: next step (max S + 1), V = 1
 * - new_version: same step (forSequence or max S), next V for that S
 */
export function getNextTemplateName(
  templates: EmailTemplate[],
  options: {
    base: string;
    action: "new_sequence" | "new_version";
    forSequence?: number;
  }
): string {
  const { base, action, forSequence } = options;
  const parsed = templates
    .map((t) => parseOutreachName(t.name, base))
    .filter((p): p is ParsedOutreachName => p !== null);

  if (action === "new_sequence") {
    const maxS = parsed.length ? Math.max(...parsed.map((p) => p.S)) : 0;
    const nextS = maxS + 1;
    return `${base} - S${nextS} - V1`;
  }

  // new_version
  const targetS =
    forSequence ?? (parsed.length ? Math.max(...parsed.map((p) => p.S)) : 1);
  const versionsForS = parsed.filter((p) => p.S === targetS);
  const maxV = versionsForS.length
    ? Math.max(...versionsForS.map((p) => p.V))
    : 0;
  const nextV = maxV + 1;
  return `${base} - S${targetS} - V${nextV}`;
}

/**
 * Get the next sequence_number for creating a template.
 * - For a new sequence step: max(sequence_number across all templates) + 1
 * - For a new version of an existing step: same sequence_number as that step
 *   (templates with same sequence_number = same step, different versions by name)
 */
export function getNextSequenceNumber(
  templates: EmailTemplate[],
  forVersionOfSequence?: number
): number {
  if (!templates.length) return 1;
  if (forVersionOfSequence !== undefined) {
    const existing = templates.find(
      (t) => t.sequence_number === forVersionOfSequence
    );
    return existing ? existing.sequence_number : forVersionOfSequence;
  }
  const max = Math.max(...templates.map((t) => t.sequence_number ?? 0));
  return max + 1;
}

/**
 * Get the sequence_number that corresponds to step S for a given base.
 * Used when creating a "new version" so we reuse the same sequence_number.
 */
export function getSequenceNumberForStep(
  templates: EmailTemplate[],
  base: string,
  S: number
): number | null {
  const parsed = templates
    .map((t) => ({ template: t, parsed: parseOutreachName(t.name, base) }))
    .filter((x): x is { template: EmailTemplate; parsed: ParsedOutreachName } =>
      x.parsed !== null
    );
  const match = parsed.find((x) => x.parsed.S === S);
  return match ? match.template.sequence_number : null;
}

/**
 * Get template IDs in sequence order (S1, S2, S3...) for a given base.
 * For each step S, the latest version (highest V) is used.
 */
export function getTemplateIdsInSequenceOrder(
  templates: EmailTemplate[],
  baseName: string
): string[] {
  const withParsed = templates
    .map((t) => ({ template: t, parsed: parseOutreachName(t.name, baseName) }))
    .filter(
      (x): x is { template: EmailTemplate; parsed: ParsedOutreachName } =>
        x.parsed !== null
    );
  if (withParsed.length === 0) return [];
  // Sort by S ascending, then by V descending (prefer latest version per step)
  withParsed.sort((a, b) => {
    if (a.parsed.S !== b.parsed.S) return a.parsed.S - b.parsed.S;
    return b.parsed.V - a.parsed.V;
  });
  // One template per step (first = highest V for that S after sort)
  const seenS = new Set<number>();
  const result: string[] = [];
  for (const { template, parsed } of withParsed) {
    if (seenS.has(parsed.S)) continue;
    seenS.add(parsed.S);
    result.push(template.id);
  }
  return result;
}

/**
 * Build a short summary of existing sequences/variations for the LLM so it knows what is already created.
 * e.g. "S1-V1, S1-V2, S2-V1. Steps present: 1, 2. Next follow-up would be S3; for add_variants suggest V2 for S2."
 */
export function buildExistingSequencesSummary(
  templates: EmailTemplate[],
  baseName: string,
  templateIds?: string[]
): string {
  const ids = templateIds ?? templates.map((t) => t.id);
  const parsed = ids
    .map((id) => {
      const t = templates.find((x) => x.id === id);
      const p = t ? parseOutreachName(t.name, baseName) : null;
      return p ? { S: p.S, V: p.V } : null;
    })
    .filter((p): p is { S: number; V: number } => p !== null);
  if (parsed.length === 0) return "None yet.";
  const sorted = [...parsed].sort((a, b) => (a.S !== b.S ? a.S - b.S : a.V - b.V));
  const labels = sorted.map(({ S, V }) => `S${S}-V${V}`).join(", ");
  const steps = [...new Set(parsed.map((p) => p.S))].sort((a, b) => a - b);
  const stepsStr = steps.join(", ");
  const nextS = steps.length > 0 ? Math.max(...steps) + 1 : 1;
  const byStep = new Map<number, number[]>();
  for (const { S, V } of parsed) {
    if (!byStep.has(S)) byStep.set(S, []);
    if (!byStep.get(S)!.includes(V)) byStep.get(S)!.push(V);
  }
  const stepsNeedingVariant = steps.filter((S) => (byStep.get(S)?.length ?? 0) < 2);
  let hint = `Steps present: ${stepsStr}. Next follow-up would be S${nextS}.`;
  if (stepsNeedingVariant.length > 0) {
    hint += ` For add_variants, suggest adding V2 for step(s): ${stepsNeedingVariant.map((s) => `S${s}`).join(", ")}.`;
  }
  return `${labels}. ${hint}`;
}

export type EmailSequenceEntry = { template_id: string; delay_days: number };

/**
 * Build campaign email_sequence from template IDs so that templates are grouped by step (S).
 * Same step (e.g. S4-V1 and S4-V2) get the same delay_days so they appear as variants of one follow-up, not as separate steps.
 * @param templateIds - IDs in any order (will be grouped by parsed S from template name)
 * @param templates - Full template list to resolve id -> name
 * @param followUpDelay - Delay in days for step 2, 3, ... (step 1 always has delay 0)
 */
export function buildEmailSequenceByStep(
  templateIds: string[],
  templates: EmailTemplate[],
  followUpDelay: number
): EmailSequenceEntry[] {
  const byStep = new Map<number, string[]>();
  let hasParsed = false;
  for (const tid of templateIds) {
    if (!tid) continue;
    const t = templates.find((x) => x.id === tid);
    const parsed = t ? parseOutreachName(t.name) : null;
    if (parsed) {
      hasParsed = true;
      if (!byStep.has(parsed.S)) byStep.set(parsed.S, []);
      byStep.get(parsed.S)!.push(tid);
    } else {
      byStep.set(1, [...(byStep.get(1) ?? []), tid]);
    }
  }
  if (!hasParsed || byStep.size === 0) {
    return templateIds.filter(Boolean).map((tid, i) => ({
      template_id: tid,
      delay_days: i === 0 ? 0 : followUpDelay,
    }));
  }
  const sortedSteps = Array.from(byStep.keys()).sort((a, b) => a - b);
  const result: EmailSequenceEntry[] = [];
  for (const S of sortedSteps) {
    const delay = S <= 1 ? 0 : (S - 1) * followUpDelay;
    for (const tid of byStep.get(S)!) {
      result.push({ template_id: tid, delay_days: delay });
    }
  }
  return result;
}
