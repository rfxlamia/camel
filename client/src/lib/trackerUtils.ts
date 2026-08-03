import type { TrackerItem, TrackerVocabulary } from "../types";

/** Status sections follow vocabulary position (fractional ordering). */
export function sortStatusesByPosition(
	statuses: TrackerVocabulary[],
): TrackerVocabulary[] {
	return [...statuses].sort((a, b) => a.position - b.position);
}

/** Items within a section: oldest createdAt first. */
export function sortItemsOldestFirst(items: TrackerItem[]): TrackerItem[] {
	return [...items].sort(
		(a, b) =>
			new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	);
}

export function groupItemsByStatus(
	items: TrackerItem[],
	statuses: TrackerVocabulary[],
): Map<number, TrackerItem[]> {
	const byStatus = new Map<number, TrackerItem[]>();
	for (const status of statuses) {
		byStatus.set(status.id, []);
	}
	for (const item of items) {
		const bucket = byStatus.get(item.status.id);
		if (bucket) bucket.push(item);
	}
	for (const [id, bucket] of byStatus) {
		byStatus.set(id, sortItemsOldestFirst(bucket));
	}
	return byStatus;
}
