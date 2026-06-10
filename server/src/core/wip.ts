/**
 * WIP limit enforcement — the core kanban rule: a column with a limit
 * cannot accept more cards than the limit allows.
 */

export interface WipCheckInput {
  /** Number of cards currently in the target column. */
  currentCount: number;
  /** The column's WIP limit; null means unlimited. */
  wipLimit: number | null;
  /** True when the card already lives in the target column (reorder). */
  isSameColumn: boolean;
}

export interface WipCheckResult {
  allowed: boolean;
  reason: "ok" | "wip_limit_reached";
}

export function checkWipLimit(input: WipCheckInput): WipCheckResult {
  const { currentCount, wipLimit, isSameColumn } = input;
  // Reordering within a column never changes its card count.
  if (isSameColumn || wipLimit === null || currentCount < wipLimit) {
    return { allowed: true, reason: "ok" };
  }
  return { allowed: false, reason: "wip_limit_reached" };
}

/** UI status for a column header: under, at, or over its limit. */
export type WipStatus = "unlimited" | "under" | "at" | "over";

export function wipStatus(count: number, wipLimit: number | null): WipStatus {
  if (wipLimit === null) return "unlimited";
  if (count < wipLimit) return "under";
  if (count === wipLimit) return "at";
  return "over";
}
