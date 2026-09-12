import { api } from "../../api";
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
	};
	workspaceOptions: MyWorkWorkspace[];
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

export function myWorkViewKey(view: MyWorkViewState): string {
	return `${view.scope}|${view.q}|${view.workspaceId}|${view.source}`;
}

function mergeWorkspaceOptions(
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
			response = await api.listMyWork({
				scope: "all",
				...requestFilters(view),
				...(view.q ? { q: view.q } : {}),
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
	const ordered = orderMyWorkItems(activeItems);
	const visibleItems = view.q
		? searchMyWorkCandidates(ordered, view.q, { limit: 50 })
		: ordered;
	return {
		loaded: paginateMyWorkItems(visibleItems, page),
		workspaceOptions: mergeWorkspaceOptions([], activeItems),
		activeCandidates: visibleItems,
	};
}

function prepareAllPage(
	response: MyWorkListResponse,
	view: MyWorkViewState,
	page: number,
): PreparedPage {
	const ordered = orderMyWorkItems(
		applyPresentationFilters(response.items, view),
	);
	return {
		loaded: {
			items: ordered,
			page,
			pageCount: response.nextCursor ? page + 1 : page,
			total: ordered.length,
			hasPrevious: page > 1,
			hasNext: Boolean(response.nextCursor),
		},
		workspaceOptions: mergeWorkspaceOptions([], ordered),
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
