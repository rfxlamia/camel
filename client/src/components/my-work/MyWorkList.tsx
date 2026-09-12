import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import {
	MY_WORK_PAGE_SIZE,
	paginateMyWorkItems,
	searchMyWorkCandidates,
} from "../../lib/myWorkSearch";
import {
	deriveMyWorkGroups,
	type MyWorkStatusGroup,
} from "../../lib/myWorkStatus";
import {
	filterMyWorkItems,
	type MyWorkViewState,
	orderMyWorkItems,
} from "../../lib/myWorkUtils";
import type {
	MyWorkItem,
	MyWorkListResponse,
	MyWorkScope,
	MyWorkWorkspace,
} from "../../types/myWork";
import MyWorkRow from "./MyWorkRow";

export interface LoadedPage {
	items: MyWorkItem[];
	page: number;
	pageCount: number;
	total: number;
	hasPrevious: boolean;
	hasNext: boolean;
}

export interface LoadError {
	kind: "auth" | "transient";
	message: string;
}

interface AllPageCache {
	key: string;
	pages: Map<number, MyWorkListResponse>;
}

interface AllPageLoad {
	response: MyWorkListResponse;
	page: number;
}

interface PreparedPage {
	loaded: LoadedPage;
	workspaceOptions: MyWorkWorkspace[];
	activeCandidates?: MyWorkItem[];
}

function isSessionError(error: unknown): boolean {
	if (error === null || typeof error !== "object") return false;
	const candidate = error as { status?: number; code?: string };
	return (
		candidate.status === 401 ||
		candidate.code === "unauthorized" ||
		candidate.code === "auth_required" ||
		candidate.code === "session_expired" ||
		candidate.code === "not_authenticated"
	);
}

export function classifyLoadError(error: unknown): LoadError {
	if (isSessionError(error)) {
		return {
			kind: "auth",
			message: "Your session has expired. Sign in again to see your work.",
		};
	}
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message) {
			return { kind: "transient", message };
		}
	}
	return {
		kind: "transient",
		message: "Couldn't load your work. Check your connection and try again.",
	};
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

function myWorkViewKey(view: MyWorkViewState): string {
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
): Promise<AllPageLoad | null> {
	let pageResponse: MyWorkListResponse | undefined;
	let cursor: string | null = null;
	let resolvedPage = 1;

	for (let page = 1; page <= view.page; page += 1) {
		pageResponse = cache.pages.get(page);
		if (!pageResponse) {
			pageResponse = await api.listMyWork({
				scope: "all",
				...requestFilters(view),
				...(view.q ? { q: view.q } : {}),
				...(cursor ? { cursor } : {}),
				limit: MY_WORK_PAGE_SIZE,
			});
			if (!isCurrent()) return null;
			cache.pages.set(page, pageResponse);
		}
		resolvedPage = page;
		if (page === view.page || !pageResponse.nextCursor) break;
		cursor = pageResponse.nextCursor;
	}

	return {
		response: pageResponse ?? { items: [], nextCursor: null },
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

interface LoadRequestContext {
	requestView: MyWorkViewState;
	requestViewKey: string;
	fresh: boolean;
	currentPage: () => number;
	allCacheRef: ReturnType<typeof useMyWorkDataState>["allCacheRef"];
	isCurrent: () => boolean;
}

async function loadRequest({
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

function useMyWorkDataState(view: MyWorkViewState) {
	const [loaded, setLoaded] = useState<LoadedPage | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<LoadError | null>(null);
	const [workspaceOptions, setWorkspaceOptions] = useState<MyWorkWorkspace[]>(
		[],
	);
	const loadSeqRef = useRef(0);
	const viewRef = useRef(view);
	viewRef.current = view;
	const loadedViewKeyRef = useRef<string | null>(null);
	const loadedAllPageRef = useRef<number | null>(null);
	const visibilityWasHiddenRef = useRef(
		typeof document !== "undefined" ? document.hidden : false,
	);
	const allCacheRef = useRef<AllPageCache>({ key: "", pages: new Map() });
	const activeCandidatesRef = useRef<{
		key: string;
		items: MyWorkItem[];
	} | null>(null);
	return {
		loaded,
		setLoaded,
		loading,
		setLoading,
		loadError,
		setLoadError,
		workspaceOptions,
		setWorkspaceOptions,
		loadSeqRef,
		viewRef,
		loadedViewKeyRef,
		loadedAllPageRef,
		visibilityWasHiddenRef,
		allCacheRef,
		activeCandidatesRef,
		view,
		viewKey: myWorkViewKey(view),
	};
}

type MyWorkDataState = ReturnType<typeof useMyWorkDataState>;

function useMyWorkLoader({
	setLoaded,
	setLoading,
	setLoadError,
	setWorkspaceOptions,
	loadSeqRef,
	viewRef,
	allCacheRef,
	activeCandidatesRef,
}: MyWorkDataState) {
	return useCallback(
		async ({ fresh = false }: { fresh?: boolean } = {}) => {
			const requestView = viewRef.current;
			const requestViewKey = myWorkViewKey(requestView);
			const seq = ++loadSeqRef.current;
			const isCurrent = () => seq === loadSeqRef.current;
			setLoading(true);
			setLoadError(null);
			setLoaded(null);
			try {
				const prepared = await loadRequest({
					requestView,
					requestViewKey,
					fresh,
					currentPage: () => viewRef.current.page,
					allCacheRef,
					isCurrent,
				});
				if (!prepared || !isCurrent()) return;
				if (prepared.activeCandidates) {
					activeCandidatesRef.current = {
						key: requestViewKey,
						items: prepared.activeCandidates,
					};
				}
				setLoaded(prepared.loaded);
				setWorkspaceOptions(prepared.workspaceOptions);
			} catch (error) {
				if (!isCurrent()) return;
				setLoaded(null);
				setLoadError(classifyLoadError(error));
			} finally {
				if (isCurrent()) setLoading(false);
			}
		},
		[
			activeCandidatesRef,
			allCacheRef,
			loadSeqRef,
			setLoaded,
			setLoading,
			setLoadError,
			setWorkspaceOptions,
			viewRef,
		],
	);
}

function useMyWorkEffects(
	{
		view,
		viewKey,
		loadedViewKeyRef,
		loadedAllPageRef,
		visibilityWasHiddenRef,
	}: MyWorkDataState,
	loadData: ReturnType<typeof useMyWorkLoader>,
) {
	useEffect(() => {
		const viewChanged = loadedViewKeyRef.current !== viewKey;
		const allPageChanged =
			view.scope === "all" && loadedAllPageRef.current !== view.page;
		if (!viewChanged && !allPageChanged) return;
		loadedViewKeyRef.current = viewKey;
		if (view.scope === "all") loadedAllPageRef.current = view.page;
		void loadData();
	}, [
		loadData,
		view.page,
		view.scope,
		viewKey,
		loadedViewKeyRef,
		loadedAllPageRef,
	]);

	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.hidden) {
				visibilityWasHiddenRef.current = true;
				return;
			}
			if (!visibilityWasHiddenRef.current) return;
			visibilityWasHiddenRef.current = false;
			void loadData({ fresh: true });
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", onVisibilityChange);
	}, [loadData, visibilityWasHiddenRef]);
}

function useMyWorkPageChange({
	view,
	viewKey,
	activeCandidatesRef,
	setLoaded,
}: MyWorkDataState) {
	return useCallback(
		(page: number) => {
			if (
				view.scope === "active" &&
				activeCandidatesRef.current?.key === viewKey
			) {
				setLoaded(paginateMyWorkItems(activeCandidatesRef.current.items, page));
			}
		},
		[activeCandidatesRef, setLoaded, view.scope, viewKey],
	);
}

/** Personal request state for the route-driven page; it never reads BoardContext. */
export function useMyWorkData(view: MyWorkViewState) {
	const state = useMyWorkDataState(view);
	const loadData = useMyWorkLoader(state);
	useMyWorkEffects(state, loadData);
	const handlePageChange = useMyWorkPageChange(state);
	return {
		loaded: state.loaded,
		loading: state.loading,
		loadError: state.loadError,
		workspaceOptions: state.workspaceOptions,
		loadData,
		handlePageChange,
	};
}

export interface MyWorkListProps {
	items: MyWorkItem[];
	scope?: MyWorkScope;
	page: number;
	pageCount?: number;
	hasPrevious?: boolean;
	hasNext?: boolean;
	onPageChange: (page: number) => void;
	onSelect?: (item: MyWorkItem) => void;
}

const GROUP_ORDER: MyWorkStatusGroup[] = [
	"backlog",
	"started",
	"completed",
	"canceled",
	"other",
];

const GROUP_LABELS: Record<MyWorkStatusGroup, string> = {
	backlog: "Backlog",
	started: "In progress",
	completed: "Done",
	canceled: "Canceled",
	other: "Other",
};

const GROUP_DOT_CLASSES: Record<MyWorkStatusGroup, string> = {
	backlog: "bg-primary-400",
	started: "bg-warning-500",
	completed: "bg-success-500",
	canceled: "bg-error-500",
	other: "bg-primary-400",
};

function GroupSection({
	group,
	items,
	onSelect,
}: {
	group: MyWorkStatusGroup;
	items: MyWorkItem[];
	onSelect?: (item: MyWorkItem) => void;
}) {
	return (
		<section
			data-testid={`my-work-group-${group}`}
			aria-labelledby={`my-work-group-label-${group}`}
		>
			<div className="flex items-center gap-2 border-primary-200 border-b bg-neutral-100/80 px-4 py-2.5 md:px-5">
				<span
					className={`h-2 w-2 rounded-full ${GROUP_DOT_CLASSES[group]}`}
					aria-hidden
				/>
				<h2
					id={`my-work-group-label-${group}`}
					className="font-semibold text-neutral-700 text-xs uppercase tracking-wide"
				>
					{GROUP_LABELS[group]}
				</h2>
				<span className="text-neutral-500 text-xs tabular-nums">
					{items.length}
				</span>
			</div>
			<ul className="divide-y divide-neutral-200/80">
				{items.map((item) => (
					<MyWorkRow
						key={`${item.workspaceId}:${item.source}:${item.key}`}
						item={item}
						onSelect={onSelect}
					/>
				))}
			</ul>
		</section>
	);
}

function PaginationControls({
	page,
	pageCount,
	hasPrevious,
	hasNext,
	onPageChange,
}: Pick<Required<MyWorkListProps>, "page" | "pageCount" | "onPageChange"> &
	Partial<Pick<MyWorkListProps, "hasPrevious" | "hasNext">>) {
	const previous = hasPrevious ?? page > 1;
	const next = hasNext ?? page < pageCount;
	return (
		<nav
			className="mt-4 flex items-center justify-between gap-3"
			aria-label="My Work pages"
		>
			<button
				type="button"
				aria-label="Previous page"
				disabled={!previous}
				onClick={() => onPageChange(Math.max(1, page - 1))}
				className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-neutral-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400"
			>
				<ChevronLeft size={14} aria-hidden />
				Previous
			</button>
			<span className="text-neutral-600 text-xs tabular-nums">
				Page {page}
				{pageCount > 1 ? ` of ${pageCount}` : ""}
			</span>
			<button
				type="button"
				aria-label="Next page"
				disabled={!next}
				onClick={() => onPageChange(page + 1)}
				className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-primary-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400"
			>
				Next
				<ChevronRight size={14} aria-hidden />
			</button>
		</nav>
	);
}

/** Grouped, paginated presentation for an already-authorized response. */
export default function MyWorkList({
	items,
	scope = "all",
	page,
	pageCount = 1,
	hasPrevious = page > 1,
	hasNext = page < pageCount,
	onPageChange,
	onSelect,
}: MyWorkListProps) {
	const groups = deriveMyWorkGroups(items, scope);
	const visibleGroups = GROUP_ORDER.filter((group) => groups[group].length > 0);
	const showPagination = hasPrevious || hasNext || pageCount > 1;

	return (
		<div className="mx-auto max-w-6xl px-4 pb-8 md:px-6">
			<div className="overflow-hidden rounded-md border border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
				{visibleGroups.map((group) => (
					<GroupSection
						key={group}
						group={group}
						items={groups[group]}
						onSelect={onSelect}
					/>
				))}
			</div>
			{showPagination && (
				<PaginationControls
					page={page}
					pageCount={pageCount}
					hasPrevious={hasPrevious}
					hasNext={hasNext}
					onPageChange={onPageChange}
				/>
			)}
		</div>
	);
}
