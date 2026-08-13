import { DEFAULT_SCHEDULE_WEEKDAYS, TZ_LABELS } from "./constants";

export function normalizeScheduleWeekdaysFromApi(raw: number[] | undefined | null): number[] {
  if (!raw?.length) return [...DEFAULT_SCHEDULE_WEEKDAYS];
  const valid = Array.from(
    new Set(
      raw
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)
    )
  ).sort((a, b) => a - b);
  return valid.length ? valid : [...DEFAULT_SCHEDULE_WEEKDAYS];
}

/** Normalize API timezone to a value that matches Select options (e.g. Asia/Calcutta -> Asia/Kolkata). */
export function normalizeTimezoneForSelect(tz: string | undefined): string {
  if (!tz || !tz.trim()) return "America/New_York";
  const normalized = tz.trim();
  if (normalized === "Asia/Calcutta") return "Asia/Kolkata";
  const allowed = new Set(Object.keys(TZ_LABELS));
  return allowed.has(normalized) ? normalized : "America/New_York";
}
