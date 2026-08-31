/** Compute added/removed numeric IDs between two sets (dedupes `next`). */
export function diffIds(
	prev: number[],
	next: number[],
): { added: number[]; removed: number[] } {
	const unique = [...new Set(next)];
	const prevSet = new Set(prev);
	const nextSet = new Set(unique);
	return {
		added: unique.filter((id) => !prevSet.has(id)),
		removed: prev.filter((id) => !nextSet.has(id)),
	};
}
