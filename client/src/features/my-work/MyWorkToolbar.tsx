import { Search, SlidersHorizontal } from "lucide-react";
import type { MyWorkScope, MyWorkWorkspace } from "../../shared/myWorkTypes";
import type { WorkItemSource } from "../../types";

export interface MyWorkToolbarProps {
	scope: MyWorkScope;
	q: string;
	workspaceId: number | "";
	source: WorkItemSource | "";
	workspaces: MyWorkWorkspace[];
	activeCount?: number;
	allCount?: number;
	onScopeChange: (scope: MyWorkScope) => void;
	onQueryChange: (query: string) => void;
	onWorkspaceChange: (workspaceId: number | "") => void;
	onSourceChange: (source: WorkItemSource | "") => void;
}

const CONTROL_CLASS =
	"h-9 rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-800 shadow-sm outline-none transition-colors motion-reduce:transition-none hover:border-neutral-400 focus:border-primary-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600";

function workspaceOptionsFor(
	workspaces: MyWorkWorkspace[],
	workspaceId: number | "",
): MyWorkWorkspace[] {
	const options = [...workspaces];
	if (
		typeof workspaceId === "number" &&
		!options.some((workspace) => workspace.id === workspaceId)
	) {
		options.push({
			id: workspaceId,
			name: `Workspace ${workspaceId}`,
			timezone: null,
		});
	}
	return options.sort((a, b) => a.name.localeCompare(b.name));
}

function ScopeTabs({
	scope,
	activeCount,
	allCount,
	onScopeChange,
}: {
	scope: MyWorkScope;
	activeCount?: number;
	allCount?: number;
	onScopeChange: (scope: MyWorkScope) => void;
}) {
	return (
		<div
			className="inline-flex w-fit items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-100 p-0.5"
			role="group"
			aria-label="My Work scope"
		>
			<ScopeTab
				active={scope === "active"}
				onClick={() => onScopeChange("active")}
				label="Active"
				count={activeCount}
			/>
			<ScopeTab
				active={scope === "all"}
				onClick={() => onScopeChange("all")}
				label="All"
				count={allCount}
			/>
		</div>
	);
}

function SearchControl({
	q,
	onQueryChange,
}: {
	q: string;
	onQueryChange: (query: string) => void;
}) {
	return (
		<div className="relative min-w-0 flex-1 lg:max-w-sm">
			<Search
				size={15}
				className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-500"
				aria-hidden
			/>
			<input
				type="search"
				value={q}
				onChange={(event) => onQueryChange(event.target.value)}
				placeholder="Search your work…"
				aria-label="Search My Work"
				className={`${CONTROL_CLASS} w-full pr-3 pl-9`}
			/>
		</div>
	);
}

function WorkspaceFilter({
	workspaceId,
	workspaces,
	onWorkspaceChange,
}: {
	workspaceId: number | "";
	workspaces: MyWorkWorkspace[];
	onWorkspaceChange: (workspaceId: number | "") => void;
}) {
	return (
		<div>
			<label className="sr-only" htmlFor="my-work-workspace-filter">
				Workspace
			</label>
			<select
				id="my-work-workspace-filter"
				value={workspaceId === "" ? "" : String(workspaceId)}
				onChange={(event) =>
					onWorkspaceChange(
						event.target.value ? Number(event.target.value) : "",
					)
				}
				className={`${CONTROL_CLASS} min-w-32 max-w-[12rem]`}
				aria-label="Filter by workspace"
			>
				<option value="">All workspaces</option>
				{workspaces.map((workspace) => (
					<option key={workspace.id} value={workspace.id}>
						{workspace.name}
					</option>
				))}
			</select>
		</div>
	);
}

function SourceFilter({
	source,
	onSourceChange,
}: {
	source: WorkItemSource | "";
	onSourceChange: (source: WorkItemSource | "") => void;
}) {
	return (
		<div className="relative">
			<SlidersHorizontal
				size={13}
				className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-500"
				aria-hidden
			/>
			<select
				id="my-work-source-filter"
				value={source}
				onChange={(event) =>
					onSourceChange(event.target.value as WorkItemSource | "")
				}
				className={`${CONTROL_CLASS} min-w-28 pl-8`}
				aria-label="Filter by source"
			>
				<option value="">All sources</option>
				<option value="board">Board</option>
				<option value="tracker">Tracker</option>
			</select>
		</div>
	);
}

function FilterControls({
	workspaceId,
	workspaces,
	source,
	onWorkspaceChange,
	onSourceChange,
}: {
	workspaceId: number | "";
	workspaces: MyWorkWorkspace[];
	source: WorkItemSource | "";
	onWorkspaceChange: (workspaceId: number | "") => void;
	onSourceChange: (source: WorkItemSource | "") => void;
}) {
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-2">
			<WorkspaceFilter
				workspaceId={workspaceId}
				workspaces={workspaces}
				onWorkspaceChange={onWorkspaceChange}
			/>
			<SourceFilter source={source} onSourceChange={onSourceChange} />
		</div>
	);
}

function ScopeTab({
	active,
	onClick,
	label,
	count,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
	count?: number;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-[background-color,border-color,color,transform] motion-safe:active:scale-[0.97] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 ${
				active
					? "bg-white font-medium text-primary-800 shadow-sm"
					: "text-neutral-600 hover:text-neutral-900"
			}`}
		>
			{label}
			{count !== undefined && (
				<span
					className={`rounded-full px-1.5 text-xs tabular-nums ${
						active ? "bg-primary-100 text-primary-700" : "text-neutral-500"
					}`}
				>
					{count}
				</span>
			)}
		</button>
	);
}

/** Filters for the personal work surface. */
export default function MyWorkToolbar({
	scope,
	q,
	workspaceId,
	source,
	workspaces,
	activeCount,
	allCount,
	onScopeChange,
	onQueryChange,
	onWorkspaceChange,
	onSourceChange,
}: MyWorkToolbarProps) {
	const workspaceOptions = workspaceOptionsFor(workspaces, workspaceId);
	return (
		<div
			data-testid="my-work-filter-row"
			className="sticky top-0 z-20 rounded-t-md border-neutral-200/70 border-b bg-white/80 px-4 py-3 backdrop-blur-md md:px-5"
		>
			<div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
				<ScopeTabs
					scope={scope}
					activeCount={activeCount}
					allCount={allCount}
					onScopeChange={onScopeChange}
				/>
				<SearchControl q={q} onQueryChange={onQueryChange} />
				<FilterControls
					workspaceId={workspaceId}
					workspaces={workspaceOptions}
					source={source}
					onWorkspaceChange={onWorkspaceChange}
					onSourceChange={onSourceChange}
				/>
			</div>
		</div>
	);
}
