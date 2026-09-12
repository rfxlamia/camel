import { AlertTriangle, ClipboardList, RotateCcw } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import MyWorkList from "../components/my-work/MyWorkList";
import MyWorkToolbar from "../components/my-work/MyWorkToolbar";
import { useBoard } from "../context/BoardContext";
import type {
	LoadError,
	LoadedPage,
} from "../components/my-work/useMyWorkData";
import { useMyWorkData } from "../components/my-work/useMyWorkData";
import type { MyWorkViewState } from "../lib/myWorkUtils";
import {
	parseMyWorkViewState,
	serializeMyWorkViewState,
} from "../lib/myWorkUtils";
import type { WorkItemSource } from "../types";

type SearchParamSetter = ReturnType<typeof useSearchParams>[1];
/** Global, route-driven personal work list. It never reads the active workspace. */
export default function MyWorkPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const view = useMemo(
		() => parseMyWorkViewState(searchParams),
		[searchParams],
	);
	const {
		loaded,
		loading,
		loadError,
		workspaceOptions,
		loadData,
		handlePageChange: setLoadedPage,
	} = useMyWorkData(view);
	const { updateView, handlePageChange } = useMyWorkViewActions(
		view,
		setSearchParams,
		setLoadedPage,
	);
	return (
		<div className="min-h-full bg-neutral-100">
			<MyWorkToolbar
				scope={view.scope}
				q={view.q}
				workspaceId={view.workspaceId}
				source={view.source}
				workspaces={workspaceOptions}
				activeCount={view.scope === "active" ? loaded?.total : undefined}
				loading={loading}
				onScopeChange={(scope) => updateView({ scope })}
				onQueryChange={(q) => updateView({ q })}
				onWorkspaceChange={(workspaceId) => updateView({ workspaceId })}
				onSourceChange={(source: WorkItemSource | "") => updateView({ source })}
				onRefresh={() => void loadData({ fresh: true })}
			/>
			<MyWorkContent
				loaded={loaded}
				loading={loading}
				loadError={loadError}
				scope={view.scope}
				query={view.q}
				onRetry={() => void loadData({ fresh: true })}
				onShowAll={() => updateView({ scope: "all" })}
				onPageChange={handlePageChange}
			/>
		</div>
	);
}
function useMyWorkViewActions(
	view: MyWorkViewState,
	setSearchParams: SearchParamSetter,
	setLoadedPage: (page: number) => void,
) {
	const updateView = useCallback(
		(
			patch: Partial<MyWorkViewState>,
			{ resetPage = true }: { resetPage?: boolean } = {},
		) => {
			const next = { ...view, ...patch };
			if (resetPage) next.page = 1;
			setSearchParams(serializeMyWorkViewState(next), { replace: true });
		},
		[setSearchParams, view],
	);
	const handlePageChange = useCallback(
		(page: number) => {
			setLoadedPage(page);
			updateView({ page }, { resetPage: false });
		},
		[setLoadedPage, updateView],
	);
	return { updateView, handlePageChange };
}
interface MyWorkContentProps {
	loaded: LoadedPage | null;
	loading: boolean;
	loadError: LoadError | null;
	scope: MyWorkViewState["scope"];
	query: string;
	onRetry: () => void;
	onShowAll: () => void;
	onPageChange: (page: number) => void;
}
function MyWorkContent({
	loaded,
	loading,
	loadError,
	scope,
	query,
	onRetry,
	onShowAll,
	onPageChange,
}: MyWorkContentProps) {
	if (loading) return <LoadingState />;
	if (loadError) {
		return loadError.kind === "auth" ? (
			<SessionErrorState />
		) : (
			<TransientErrorState error={loadError} onRetry={onRetry} />
		);
	}
	if (loaded?.items.length === 0) {
		return <EmptyResult scope={scope} query={query} onShowAll={onShowAll} />;
	}
	if (!loaded) return null;
	return (
		<MyWorkList
			items={loaded.items}
			scope={scope}
			page={loaded.page}
			pageCount={loaded.pageCount}
			hasPrevious={loaded.hasPrevious}
			hasNext={loaded.hasNext}
			onPageChange={onPageChange}
		/>
	);
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
function SessionErrorState() {
	const { logout } = useBoard();
	const handleSignIn = useCallback(async () => {
		await logout();
		window.location.assign("/login");
	}, [logout]);

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
			<button
				type="button"
				onClick={() => void handleSignIn()}
				className="mt-4 inline-flex h-9 items-center rounded-md bg-primary-600 px-3 font-medium text-sm text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none"
			>
				Sign in again
			</button>
		</div>
	);
}
function TransientErrorState({
	error,
	onRetry,
}: {
	error: LoadError;
	onRetry: () => void;
}) {
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
				className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 font-medium text-primary-700 text-sm shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none"
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
	scope: MyWorkViewState["scope"];
	query: string;
	onShowAll: () => void;
}) {
	return query ? (
		<SearchEmptyResult scope={scope} query={query} onShowAll={onShowAll} />
	) : (
		<ScopeEmptyResult scope={scope} onShowAll={onShowAll} />
	);
}
function SearchEmptyResult({
	scope,
	query,
	onShowAll,
}: {
	scope: MyWorkViewState["scope"];
	query: string;
	onShowAll: () => void;
}) {
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
					className="mt-4 inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3 font-medium text-primary-700 text-sm shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none"
				>
					Search all work
				</button>
			)}
		</div>
	);
}
function ScopeEmptyResult({
	scope,
	onShowAll,
}: {
	scope: MyWorkViewState["scope"];
	onShowAll: () => void;
}) {
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
					className="mt-4 inline-flex h-9 items-center rounded-md bg-primary-600 px-3 font-medium text-sm text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none"
				>
					View all work
				</button>
			)}
		</div>
	);
}
