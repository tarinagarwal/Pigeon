export type PaginationItem = number | "ellipsis";

/**
 * Builds page numbers with ellipsis when the list would get long.
 * - 4 or fewer pages: show every page
 * - 5+ pages: first, last, neighbors around current, with … for gaps
 */
export function getPaginationItems(current: number, total: number): PaginationItem[] {
  if (total <= 1) return total === 1 ? [1] : [];
  if (total <= 4) return Array.from({ length: total }, (_, i) => i + 1);

  if (current <= 2) {
    return [1, 2, 3, "ellipsis", total];
  }

  if (current >= total - 1) {
    return [1, "ellipsis", total - 2, total - 1, total];
  }

  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}
