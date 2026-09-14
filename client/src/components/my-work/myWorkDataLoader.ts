import { api } from "../../api";
import {
	projectMyWorkListItems,
	reconcileMyWorkMutations,
} from "../../lib/myWorkMutationReconciliation";
import {
	MY_WORK_PAGE_SIZE,
	paginateMyWorkItems,
	searchMyWorkCandidates,
} from "../../lib/myWorkSearch";
import {
	filterMyWorkItems,
	type MyWorkViewState,
	orderMyWorkItems,
} from "../../lib/myWorkUtils";
import type {
	MyWorkItem,
	MyWorkListResponse,
	MyWorkWorkspace,
} from "../../types/myWork";

export interface AllPageCache {
	key: string;
	pages: Map<number, MyWorkListResponse>;
}

export interface PreparedPage {
	loaded: {
		items: MyWorkItem[];
		page: number;
		pageCount: number;
		total: number;
		hasPrevious: boolean;
		hasNext: boolean;
		candidateSetIncomplete?: boolean;
	};
	workspaceOptions: MyWorkWorkspace[];
	workspaceItems: MyWorkItem[];
	activeCandidates?: MyWorkItem[];
}

interface MutableRef<T> {
	current: T;
}

function requestFilters(view: MyWorkViewState) {
	return {
		...(view.workspaceId === "" ? {} : { workspaceId: view.workspaceId }),
		...(view.source === "" ? {} : { source: view.source }),
	};
}

function applyPresentationFilters(
	items: MyWorkItem[],
	view: MyWorkViewState,
): MyWorkItem[] {
	return items.filter(
		(item) =>
			(view.workspaceId === "" || item.workspaceId === view.workspaceId) &&
			(view.source === "" || item.source === view.source),
	);
}

export function myWorkSearchQuery(view: MyWorkViewState): string {
	return view.q.trim();
}

export function myWorkViewKey(view: MyWorkViewState): string {
	return `${view.scope}|${myWorkSearchQuery(view)}|${view.workspaceId}|${view.source}`;
}

/**
 * Key for the data request. For the Active scope the server does not receive the
 * search query, so query-only changes must not trigger a refetch. For All scope
 * the query is part of the server request and therefore belongs in the key.
 */
export function myWorkRequestKey(view: MyWorkViewState): string {
	return view.scope === "active"
		? `${view.scope}|${view.workspaceId}|${view.source}`
		: myWorkViewKey(view);
}

/** Identity of an in-flight load. Active page is client-side; All page is not. */
export function myWorkLoadIdentity(view: MyWorkViewState): string {
	const key = myWorkRequestKey(view);
	return view.scope === "all" ? `${key}|${view.page}` : key;
}

export function activeLoadedPage(
	items: MyWorkItem[],
	view: MyWorkViewState,
	candidateSetIncomplete = false,
): PreparedPage["loaded"] {
	const query = myWorkSearchQuery(view);
	const visibleItems = query
		? searchMyWorkCandidates(items, query, { limit: 50 })
		: items;
	return {
		...paginateMyWorkItems(visibleItems, view.page),
		candidateSetIncomplete,
	};
}

export function mergeWorkspaceOptions(
	previous: MyWorkWorkspace[],
	items: MyWorkItem[],
): MyWorkWorkspace[] {
	const byId = new Map(previous.map((workspace) => [workspace.id, workspace]));
	for (const item of items) byId.set(item.workspaceId, item.workspace);
	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function loadActiveResponse(view: MyWorkViewState) {
	return api.listActiveMyWorkCandidates({
		...requestFilters(view),
		limit: MY_WORK_PAGE_SIZE,
		maxPages: 20,
	});
}

async function loadAllResponse(
	view: MyWorkViewState,
	cache: AllPageCache,
	isCurrent: () => boolean,
): Promise<{ response: MyWorkListResponse; page: number } | null> {
	let response: MyWorkListResponse | undefined;
	let cursor: string | null = null;
	let resolvedPage = 1;

	for (let page = 1; page <= view.page; page += 1) {
		response = cache.pages.get(page);
		if (!response) {
			const searchQuery = myWorkSearchQuery(view);
			response = await api.listMyWork({
				scope: "all",
				...requestFilters(view),
				...(searchQuery ? { q: searchQuery } : {}),
				...(cursor ? { cursor } : {}),
				limit: MY_WORK_PAGE_SIZE,
			});
			if (!isCurrent()) return null;
			cache.pages.set(page, response);
		}
		resolvedPage = page;
		if (page === view.page || !response.nextCursor) break;
		cursor = response.nextCursor;
	}

	return {
		response: response ?? { items: [], nextCursor: null },
		page: resolvedPage,
	};
}

function prepareActivePage(
	response: MyWorkListResponse,
	view: MyWorkViewState,
	page: number,
): PreparedPage {
	const activeItems = filterMyWorkItems(
		applyPresentationFilters(response.items, view),
		"active",
	);
	reconcileMyWorkMutations(activeItems);
	const ordered = orderMyWorkItems(
		projectMyWorkListItems(activeItems, "active"),
	);
	return {
		loaded: activeLoadedPage(
			ordered,
			{ ...view, page },
			Boolean(response.nextCursor),
		),
		workspaceOptions: mergeWorkspaceOptions([], activeItems),
		workspaceItems: activeItems,
		activeCandidates: ordered,
	};
}

function prepareAllPage(
	response: MyWorkListResponse,
	view: MyWorkViewState,
	page: number,
): PreparedPage {
	const filtered = applyPresentationFilters(response.items, view);
	reconcileMyWorkMutations(filtered);
	const ordered = orderMyWorkItems(projectMyWorkListItems(filtered, "all"));
	return {
		loaded: {
			items: ordered,
			page,
			pageCount: response.nextCursor ? page + 1 : page,
			total: ordered.length,
			hasPrevious: page > 1,
			hasNext: Boolean(response.nextCursor),
		},
		workspaceOptions: mergeWorkspaceOptions([], filtered),
		workspaceItems: filtered,
	};
}

export interface LoadRequestContext {
	requestView: MyWorkViewState;
	requestViewKey: string;
	fresh: boolean;
	currentPage: () => number;
	allCacheRef: MutableRef<AllPageCache>;
	isCurrent: () => boolean;
}

export async function loadMyWorkRequest({
	requestView,
	requestViewKey,
	fresh,
	currentPage,
	allCacheRef,
	isCurrent,
}: LoadRequestContext): Promise<PreparedPage | null> {
	if (requestView.scope === "active") {
		const response = await loadActiveResponse(requestView);
		return isCurrent()
			? prepareActivePage(response, requestView, currentPage())
			: null;
	}
	if (fresh || allCacheRef.current.key !== requestViewKey) {
		allCacheRef.current = { key: requestViewKey, pages: new Map() };
	}
	const allPage = await loadAllResponse(
		requestView,
		allCacheRef.current,
		isCurrent,
	);
	return allPage && isCurrent()
		? prepareAllPage(allPage.response, requestView, allPage.page)
		: null;
}
