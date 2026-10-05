import type { MyWorkItem, MyWorkWorkspace } from "../../shared/myWorkTypes";
import type { WorkItemSource } from "../../types";
import MyWorkDetailSheet from "./MyWorkDetailSheet";
import MyWorkHeader from "./MyWorkHeader";
import MyWorkList from "./MyWorkList";
import { SessionErrorState } from "./MyWorkSessionError";
import { EmptyResult, LoadingState, TransientErrorState } from "./MyWorkStates";
import MyWorkToolbar from "./MyWorkToolbar";
import type { MyWorkDetailSelection } from "./myWorkNavigation";
import type { MyWorkViewState } from "./myWorkUtils";
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
	onListRefresh: () => void;
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
		onListRefresh,
		onRetry,
		onSelect,
	} = props;
	return (
		<div className="min-h-full bg-neutral-100">
			<div className="mx-auto max-w-6xl px-4 pt-5 pb-8 md:px-6 md:pt-7">
				<MyWorkHeader loading={loading} onRefresh={onRefresh} />
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
						onListRefresh={onListRefresh}
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
	"detailSelection" | "onCloseDetail" | "onListRefresh" | "detailRefreshToken"
>;

function MyWorkDetail({
	detailSelection,
	onCloseDetail,
	onListRefresh,
	detailRefreshToken,
}: MyWorkDetailProps) {
	if (!detailSelection) return null;
	return (
		<MyWorkDetailSheet
			selection={detailSelection}
			onClose={onCloseDetail}
			onRefresh={onListRefresh}
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
	onListRefresh: () => void;
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
	onListRefresh,
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
		<>
			{loaded.candidateSetIncomplete && (
				<p
					role="status"
					className="border-neutral-200/70 border-b bg-neutral-50 px-4 py-2 text-neutral-600 text-xs md:px-5"
				>
					Showing the first {loaded.total} active matches. Narrow filters or
					search to find more.
				</p>
			)}
			<MyWorkList
				items={loaded.items}
				scope={scope}
				page={loaded.page}
				pageCount={loaded.pageCount}
				hasPrevious={loaded.hasPrevious}
				hasNext={loaded.hasNext}
				onPageChange={onPageChange}
				onSelect={onSelect}
				onRefresh={onListRefresh}
			/>
		</>
	);
}
