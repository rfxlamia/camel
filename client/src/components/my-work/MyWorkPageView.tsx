import { ClipboardList, RotateCcw } from "lucide-react";
import type { MyWorkDetailSelection } from "../../lib/myWorkNavigation";
import type { MyWorkViewState } from "../../lib/myWorkUtils";
import type { WorkItemSource } from "../../types";
import type { MyWorkItem, MyWorkWorkspace } from "../../types/myWork";
import MyWorkDetailSheet from "./MyWorkDetailSheet";
import MyWorkList, { SessionErrorState } from "./MyWorkList";
import MyWorkToolbar from "./MyWorkToolbar";
import { ToolbarIntro } from "./MyWorkToolbarParts";
import { useDelayedLoading } from "./useDelayedLoading";
import type { LoadError, LoadedPage } from "./useMyWorkData";

type MyWorkViewUpdate = (
	patch: Partial<MyWorkViewState>,
	options?: { resetPage?: boolean },
) => void;

export interface MyWorkPageViewProps {
	view: MyWorkViewState;
	detailSelection: MyWorkDetailSelection | null;
	loaded: LoadedPage | null;
	loading: boolean;
	loadError: LoadError | null;
	workspaceOptions: MyWorkWorkspace[];
	updateView: MyWorkViewUpdate;
	handlePageChange: (page: number) => void;
	onRefresh: () => void;
	onRetry: () => void;
	onSelect: (item: MyWorkItem) => void;
	onCloseDetail: () => void;
	detailRefreshToken: number;
}

export function MyWorkPageView(props: MyWorkPageViewProps) {
	const {
		view,
		loaded,
		loading,
		loadError,
		workspaceOptions,
		updateView,
		handlePageChange,
		onRefresh,
		onRetry,
		onSelect,
	} = props;
	return (
		<div className="min-h-full bg-neutral-100">
			<div className="mx-auto max-w-6xl px-4 pt-5 pb-8 md:px-6 md:pt-7">
				<ToolbarIntro loading={loading} onRefresh={onRefresh} />
				<div className="mt-4 rounded-md border border-neutral-200 bg-white">
					<MyWorkToolbar
						scope={view.scope}
						q={view.q}
						workspaceId={view.workspaceId}
						source={view.source}
						workspaces={workspaceOptions}
						activeCount={view.scope === "active" ? loaded?.total : undefined}
						onScopeChange={(scope) => updateView({ scope })}
						onQueryChange={(q) => updateView({ q })}
						onWorkspaceChange={(workspaceId) => updateView({ workspaceId })}
						onSourceChange={(source: WorkItemSource | "") =>
							updateView({ source })
						}
					/>
					<MyWorkContent
						loaded={loaded}
						loading={loading}
						loadError={loadError}
						scope={view.scope}
						query={view.q}
						onRetry={onRetry}
						onRefresh={onRefresh}
						onShowAll={() => updateView({ scope: "all" })}
						onPageChange={handlePageChange}
						onSelect={onSelect}
					/>
				</div>
			</div>
			<MyWorkDetail {...props} />
		</div>
	);
}

type MyWorkDetailProps = Pick<
	MyWorkPageViewProps,
	"detailSelection" | "onCloseDetail" | "onRefresh" | "detailRefreshToken"
>;

function MyWorkDetail({
	detailSelection,
	onCloseDetail,
	onRefresh,
	detailRefreshToken,
}: MyWorkDetailProps) {
	if (!detailSelection) return null;
	return (
		<MyWorkDetailSheet
			selection={detailSelection}
			onClose={onCloseDetail}
			onRefresh={onRefresh}
			refreshToken={detailRefreshToken}
		/>
	);
}

interface MyWorkContentProps {
	loaded: LoadedPage | null;
	loading: boolean;
	loadError: LoadError | null;
	scope: MyWorkViewState["scope"];
	query: string;
	onRetry: () => void;
	onRefresh: () => void;
	onShowAll: () => void;
	onPageChange: (page: number) => void;
	onSelect: (item: MyWorkItem) => void;
}

function MyWorkContent({
	loaded,
	loading,
	loadError,
	scope,
	query,
	onRetry,
	onRefresh,
	onShowAll,
	onPageChange,
	onSelect,
}: MyWorkContentProps) {
	const showSkeleton = useDelayedLoading(loading);
	if (showSkeleton) return <LoadingState />;
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
			onSelect={onSelect}
			onRefresh={onRefresh}
		/>
	);
}

function LoadingState() {
	return (
		<div
			data-testid="my-work-loading"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			aria-label="Loading your work"
		>
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
			className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center"
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
		<div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
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
			className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center"
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
