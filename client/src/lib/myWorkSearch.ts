import Fuse from "fuse.js";
import type { MyWorkItem } from "../types/myWork";

export const MY_WORK_SEARCH_KEYS = ["key", "title", "description"] as const;
export const MY_WORK_SEARCH_THRESHOLD = 0.45;
export const DEFAULT_MY_WORK_SEARCH_LIMIT = 50;

export interface MyWorkSearchOptions {
	limit?: number;
	threshold?: number;
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isFinite(limit) || limit < 1) {
		return DEFAULT_MY_WORK_SEARCH_LIMIT;
	}
	return Math.min(DEFAULT_MY_WORK_SEARCH_LIMIT, Math.floor(limit));
}

/**
 * Rank only the server-provided candidate window for presentation. This helper
 * deliberately has no request, membership, or authorization boundary.
 */
export function searchMyWorkItems(
	items: MyWorkItem[],
	query: string,
	options: MyWorkSearchOptions = {},
): MyWorkItem[] {
	const limit = normalizeLimit(options.limit);
	const normalizedQuery = query.trim();
	if (!normalizedQuery) return items.slice(0, limit);

	const fuse = new Fuse(items, {
		keys: [...MY_WORK_SEARCH_KEYS],
		threshold: options.threshold ?? MY_WORK_SEARCH_THRESHOLD,
		ignoreLocation: true,
		shouldSort: true,
		includeScore: true,
	});
	return fuse
		.search(normalizedQuery, { limit })
		.sort((a, b) => {
			const scoreDifference = (a.score ?? 1) - (b.score ?? 1);
			return scoreDifference !== 0 ? scoreDifference : a.refIndex - b.refIndex;
		})
		.map((result) => result.item);
}

/** Explicit name for callers searching an already bounded All-scope window. */
export function searchMyWorkCandidates(
	candidateItems: MyWorkItem[],
	query: string,
	options: MyWorkSearchOptions = {},
): MyWorkItem[] {
	return searchMyWorkItems(candidateItems, query, options);
}
