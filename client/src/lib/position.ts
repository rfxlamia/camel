/** Fractional positioning — mirrors server/src/core/position.ts */

export const POSITION_GAP = 1024;

export const MIN_SPACING = 1e-9;

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
