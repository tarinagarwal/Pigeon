/** Shared helpers for Rent Your Network admin UI. */

export function rynDailyLimitLabel(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return `${value}/day`;
  }
  return "—";
}

export function rynProviderLabel(raw: string | undefined | null): string {
  const s = (raw ?? "").trim().toLowerCase();
  return s || "";
}
