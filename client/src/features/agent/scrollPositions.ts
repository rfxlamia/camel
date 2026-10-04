// Module-level scroll position store — persists across mounts in the same session.
// Capped at 50 entries to prevent unbounded growth across long sessions.
export const savedScrollPositions = new Map<string, number>();
export function saveScrollPosition(key: string, value: number) {
	if (!savedScrollPositions.has(key) && savedScrollPositions.size >= 50) {
		// Evict the oldest entry
		savedScrollPositions.delete(
			savedScrollPositions.keys().next().value as string,
		);
	}
	savedScrollPositions.set(key, value);
}
