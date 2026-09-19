import Fuse from "fuse.js";
import type { MyWorkItem } from "../shared/myWorkTypes";

export const MY_WORK_PAGE_SIZE = 50;

export interface MyWorkPage<T> {
	items: T[];
	page: number;
	pageSize: number;
	pageCount: number;
	total: number;
	hasPrevious: boolean;
	hasNext: boolean;
}

function positiveInteger(value: number, fallback: number): number {
	return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

/** Paginate a finite, already-authorized client result without mutating it. */
export function paginateMyWorkItems<T>(
	items: T[],
	page: number,
	pageSize = MY_WORK_PAGE_SIZE,
): MyWorkPage<T> {
	const safePageSize = Math.min(
		MY_WORK_PAGE_SIZE,
		positiveInteger(pageSize, MY_WORK_PAGE_SIZE),
	);
	const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
	const safePage = Math.min(pageCount, positiveInteger(page, 1));
	const start = (safePage - 1) * safePageSize;
	return {
		items: items.slice(start, start + safePageSize),
		page: safePage,
		pageSize: safePageSize,
		pageCount,
		total: items.length,
		hasPrevious: safePage > 1,
		hasNext: safePage < pageCount,
	};
}

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
