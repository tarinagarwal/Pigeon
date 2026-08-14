import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parse a server ISO date string. If no timezone is present, treat as UTC
 * so "X ago" is calculated correctly against the user's local "now".
 */
export function parseDateFromServer(isoString: string): Date {
  if (!isoString) return new Date();
  const s = String(isoString).trim();
  const hasTz = s.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(s);
  return new Date(hasTz ? s : s + "Z");
}
