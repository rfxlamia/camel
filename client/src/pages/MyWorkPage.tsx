import { AlertTriangle, ClipboardList, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api";
import MyWorkList from "../components/my-work/MyWorkList";
import MyWorkToolbar from "../components/my-work/MyWorkToolbar";
import { orderMyWorkItems } from "../lib/myWorkOrdering";
import {
	MY_WORK_PAGE_SIZE,
	paginateMyWorkItems,
	searchMyWorkCandidates,
} from "../lib/myWorkSearch";
import {
	filterMyWorkItems,
	parseMyWorkViewState,
	serializeMyWorkViewState,
} from "../lib/myWorkUtils";
import type { WorkItemSource } from "../types";
import type {
	MyWorkItem,
	MyWorkListResponse,
	MyWorkWorkspace,
} from "../types/myWork";

interface LoadedPage {
	items: MyWorkItem[];
	page: number;
	pageCount: number;
	total: number;
	hasPrevious: boolean;
	hasNext: boolean;
}

interface LoadError {
	kind: "auth" | "transient";
	message: string;
}

interface AllPageCache {
	key: string;
	pages: Map<number, MyWorkListResponse>;
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

function classifyLoadError(error: unknown): LoadError {
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

function requestFilters(view: ReturnType<typeof parseMyWorkViewState>) {
	return {
		...(view.workspaceId === "" ? {} : { workspaceId: view.workspaceId }),
		...(view.source === "" ? {} : { source: view.source }),
	};
}

function applyPresentationFilters(
	items: MyWorkItem[],
	view: ReturnType<typeof parseMyWorkViewState>,
): MyWorkItem[] {
	return items.filter(
		(item) =>
			(view.workspaceId === "" || item.workspaceId === view.workspaceId) &&
			(view.source === "" || item.source === view.source),
	);
}

/** Global, route-driven personal work list. It never reads the active workspace. */
export default function MyWorkPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const view = useMemo(
		() => parseMyWorkViewState(searchParams),
		[searchParams],
	);
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

	const viewKey = `${view.scope}|${view.q}|${view.workspaceId}|${view.source}`;

	const updateView = useCallback(
		(
			patch: Partial<typeof view>,
			{ resetPage = true }: { resetPage?: boolean } = {},
		) => {
			const next = { ...view, ...patch };
			if (resetPage) next.page = 1;
			setSearchParams(serializeMyWorkViewState(next), { replace: true });
		},
		[setSearchParams, view],
	);

	const loadData = useCallback(
		async ({ fresh = false }: { fresh?: boolean } = {}) => {
			const requestView = viewRef.current;
			const requestViewKey = `${requestView.scope}|${requestView.q}|${requestView.workspaceId}|${requestView.source}`;
			const seq = ++loadSeqRef.current;
			setLoading(true);
			setLoadError(null);
			// A request is an all-or-nothing boundary. Never leave old rows on
			// screen while a personal response is being replaced.
			setLoaded(null);

			try {
				let response: MyWorkListResponse;
				if (requestView.scope === "active") {
					response = await api.listActiveMyWorkCandidates({
						...requestFilters(requestView),
						limit: MY_WORK_PAGE_SIZE,
						maxPages: 20,
					});
				} else {
					if (fresh || allCacheRef.current.key !== requestViewKey) {
						allCacheRef.current = { key: requestViewKey, pages: new Map() };
					}
					const cache = allCacheRef.current;
					let pageResponse: MyWorkListResponse | undefined;
					let cursor: string | null = null;
					let resolvedPage = 1;

					for (let page = 1; page <= requestView.page; page += 1) {
						pageResponse = cache.pages.get(page);
						if (!pageResponse) {
							pageResponse = await api.listMyWork({
								scope: "all",
								...requestFilters(requestView),
								...(requestView.q ? { q: requestView.q } : {}),
								...(cursor ? { cursor } : {}),
								limit: MY_WORK_PAGE_SIZE,
							});
							if (seq !== loadSeqRef.current) return;
							cache.pages.set(page, pageResponse);
						}
						resolvedPage = page;
						if (page === requestView.page || !pageResponse.nextCursor) break;
						cursor = pageResponse.nextCursor;
					}
					response = pageResponse ?? { items: [], nextCursor: null };
					// The API's cursor is a continuation signal, not a rendered page
					// count. It remains attached to this page for the next navigation.
					const ordered = orderMyWorkItems(
						applyPresentationFilters(response.items, requestView),
					);
					if (seq !== loadSeqRef.current) return;
					setLoaded({
						items: ordered,
						page: resolvedPage,
						pageCount: response.nextCursor ? resolvedPage + 1 : resolvedPage,
						total: ordered.length,
						hasPrevious: resolvedPage > 1,
						hasNext: Boolean(response.nextCursor),
					});
					setWorkspaceOptions(mergeWorkspaceOptions([], ordered));
					return;
				}

				const activeItems = filterMyWorkItems(
					applyPresentationFilters(response.items, requestView),
					"active",
				);
				const ordered = orderMyWorkItems(activeItems);
				const visibleItems = requestView.q
					? searchMyWorkCandidates(ordered, requestView.q, { limit: 50 })
					: ordered;
				const page = paginateMyWorkItems(visibleItems, viewRef.current.page);
				if (seq !== loadSeqRef.current) return;
				activeCandidatesRef.current = {
					key: requestViewKey,
					items: visibleItems,
				};
				setLoaded(page);
				setWorkspaceOptions(mergeWorkspaceOptions([], activeItems));
			} catch (error) {
				if (seq !== loadSeqRef.current) return;
				setLoaded(null);
				setLoadError(classifyLoadError(error));
			} finally {
				if (seq === loadSeqRef.current) setLoading(false);
			}
		},
		[],
	);

	useEffect(() => {
		const viewChanged = loadedViewKeyRef.current !== viewKey;
		const allPageChanged =
			view.scope === "all" && loadedAllPageRef.current !== view.page;
		if (viewChanged || allPageChanged) {
			loadedViewKeyRef.current = viewKey;
			if (view.scope === "all") loadedAllPageRef.current = view.page;
			void loadData();
		}
	}, [loadData, view.page, view.scope, viewKey]);

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
	}, [loadData]);

	const handlePageChange = useCallback(
		(page: number) => {
			if (
				view.scope === "active" &&
				activeCandidatesRef.current?.key === viewKey
			) {
				setLoaded(paginateMyWorkItems(activeCandidatesRef.current.items, page));
			}
			updateView({ page }, { resetPage: false });
		},
		[updateView, view.scope, viewKey],
	);

	const isEmpty = !loading && !loadError && loaded?.items.length === 0;
	const scopeCount = view.scope === "active" ? loaded?.total : undefined;

	return (
		<div className="min-h-full bg-neutral-100">
			<MyWorkToolbar
				scope={view.scope}
				q={view.q}
				workspaceId={view.workspaceId}
				source={view.source}
				workspaces={workspaceOptions}
				activeCount={scopeCount}
				loading={loading}
				onScopeChange={(scope) => updateView({ scope })}
				onQueryChange={(q) => updateView({ q })}
				onWorkspaceChange={(workspaceId) => updateView({ workspaceId })}
				onSourceChange={(source: WorkItemSource | "") => updateView({ source })}
				onRefresh={() => void loadData({ fresh: true })}
			/>

			{loading ? (
				<LoadingState />
			) : loadError ? (
				<ErrorState
					error={loadError}
					onRetry={() => void loadData({ fresh: true })}
				/>
			) : isEmpty ? (
				<EmptyResult
					scope={view.scope}
					query={view.q}
					onShowAll={() => updateView({ scope: "all" })}
				/>
			) : loaded ? (
				<MyWorkList
					items={loaded.items}
					scope={view.scope}
					page={loaded.page}
					pageCount={loaded.pageCount}
					hasPrevious={loaded.hasPrevious}
					hasNext={loaded.hasNext}
					onPageChange={handlePageChange}
				/>
			) : null}
		</div>
	);
}

function mergeWorkspaceOptions(
	previous: MyWorkWorkspace[],
	items: MyWorkItem[],
): MyWorkWorkspace[] {
	const byId = new Map(previous.map((workspace) => [workspace.id, workspace]));
	for (const item of items) {
		byId.set(item.workspaceId, item.workspace);
	}
	return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function LoadingState() {
	return (
		<div
			data-testid="my-work-loading"
			className="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-7"
			aria-label="Loading your work"
		>
			<div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
				{[0, 1, 2, 3, 4].map((index) => (
					<div
						key={index}
						className="flex items-center gap-3 border-neutral-200 border-b px-4 py-4 last:border-b-0"
					>
						<div className="h-8 w-8 animate-pulse rounded-md bg-neutral-200 motion-reduce:animate-none" />
						<div className="min-w-0 flex-1 space-y-2">
							<div className="h-3 w-1/4 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none" />
							<div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100 motion-reduce:animate-none" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function ErrorState({
	error,
	onRetry,
}: {
	error: LoadError;
	onRetry: () => void;
}) {
	if (error.kind === "auth") {
		return (
			<div
				data-testid="my-work-session-error"
				className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center md:px-6"
			>
				<AlertTriangle size={22} className="text-warning-500" aria-hidden />
				<h2 className="mt-3 font-semibold text-neutral-900 text-base">
					Your session has expired
				</h2>
				<p role="alert" className="mt-1 max-w-sm text-neutral-600 text-sm">
					Sign in again to see your assigned work.
				</p>
				<Link
					to="/login"
					className="mt-4 inline-flex h-9 items-center rounded-md bg-primary-600 px-3 font-medium text-sm text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Sign in again
				</Link>
			</div>
		);
	}

	return (
		<div
			data-testid="my-work-error"
			role="alert"
			className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center md:px-6"
		>
			<RotateCcw size={22} className="text-neutral-400" aria-hidden />
			<h2 className="mt-3 font-semibold text-neutral-900 text-base">
				Couldn't load your work
			</h2>
			<p className="mt-1 max-w-sm text-neutral-600 text-sm">
				{error.message === ""
					? "Check your connection and try again."
					: error.message}
			</p>
			<button
				type="button"
				onClick={onRetry}
				className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 font-medium text-primary-700 text-sm shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				Try again
			</button>
		</div>
	);
}

function EmptyResult({
	scope,
	query,
	onShowAll,
}: {
	scope: "active" | "all";
	query: string;
	onShowAll: () => void;
}) {
	if (query) {
		return (
			<div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center md:px-6">
				<ClipboardList size={22} className="text-neutral-400" aria-hidden />
				<h2 className="mt-3 font-semibold text-neutral-900 text-base">
					No work matches “{query}”
				</h2>
				<p className="mt-1 max-w-sm text-neutral-600 text-sm">
					Try a different search or clear the filters.
				</p>
				{scope === "active" && (
					<button
						type="button"
						onClick={onShowAll}
						className="mt-4 inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 font-medium text-primary-700 text-sm shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Search all work
					</button>
				)}
			</div>
		);
	}

	return (
		<div
			data-testid={
				scope === "active" ? "my-work-empty-active" : "my-work-empty-all"
			}
			className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center md:px-6"
		>
			<ClipboardList size={22} className="text-neutral-400" aria-hidden />
			<h2 className="mt-3 font-semibold text-neutral-900 text-base">
				{scope === "active"
					? "Nothing active right now"
					: "No assigned work yet"}
			</h2>
			<p className="mt-1 max-w-sm text-neutral-600 text-sm">
				{scope === "active"
					? "Completed and canceled work is still available in your full history."
					: "Assigned Board cards and Tracker items will appear here."}
			</p>
			{scope === "active" && (
				<button
					type="button"
					onClick={onShowAll}
					className="mt-4 inline-flex h-9 items-center rounded-md bg-primary-600 px-3 font-medium text-sm text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					View all work
				</button>
			)}
		</div>
	);
}
