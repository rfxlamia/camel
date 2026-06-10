/**
 * Fractional positioning: cards/columns are ordered by a float position.
 * Inserting between two items takes the midpoint, so no reindexing is
 * needed on every move.
 */

export const POSITION_GAP = 1024;

/** Minimum distance between two positions before a rebalance is required. */
export const MIN_SPACING = 1e-9;

/**
 * Compute the position for an item inserted between `before` and `after`.
 * Either side may be null when inserting at the start/end of a list.
 */
export function positionBetween(
  before: number | null,
  after: number | null,
): number {
  if (before === null && after === null) return POSITION_GAP;
  if (before === null) return (after as number) - POSITION_GAP;
  if (after === null) return before + POSITION_GAP;
  if (after - before < MIN_SPACING) {
    throw new RangeError("positions too close: rebalance required");
  }
  return (before + after) / 2;
}

/** Map a target index in an ordered list of positions to (before, after). */
export function neighborsAt(
  positions: number[],
  index: number,
): { before: number | null; after: number | null } {
  const clamped = Math.max(0, Math.min(index, positions.length));
  return {
    before: clamped > 0 ? positions[clamped - 1] : null,
    after: clamped < positions.length ? positions[clamped] : null,
  };
}

/** Evenly respaced positions for a list of `count` items. */
export function rebalance(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * POSITION_GAP);
}
