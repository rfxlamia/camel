import { RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import type { WorkItemSource } from "../../types";
import type { MyWorkScope, MyWorkWorkspace } from "../../types/myWork";

export interface MyWorkToolbarProps {
	scope: MyWorkScope;
	q: string;
	workspaceId: number | "";
	source: WorkItemSource | "";
	workspaces: MyWorkWorkspace[];
	activeCount?: number;
	allCount?: number;
	loading?: boolean;
	onScopeChange: (scope: MyWorkScope) => void;
	onQueryChange: (query: string) => void;
	onWorkspaceChange: (workspaceId: number | "") => void;
	onSourceChange: (source: WorkItemSource | "") => void;
	onRefresh: () => void;
}

function controlClass(): string {
	return "h-9 rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-800 shadow-sm outline-none transition-colors hover:border-neutral-400 focus:border-primary-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600";
}

/** Route-driven filters and refresh controls for the personal work surface. */
export default function MyWorkToolbar({
	scope,
	q,
	workspaceId,
	source,
	workspaces,
	activeCount,
	allCount,
	loading = false,
	onScopeChange,
	onQueryChange,
	onWorkspaceChange,
	onSourceChange,
	onRefresh,
}: MyWorkToolbarProps) {
	const workspaceOptions = [...workspaces];
	if (
		typeof workspaceId === "number" &&
		!workspaceOptions.some((workspace) => workspace.id === workspaceId)
	) {
		workspaceOptions.push({
			id: workspaceId,
			name: `Workspace ${workspaceId}`,
			timezone: null,
		});
	}
	workspaceOptions.sort((a, b) => a.name.localeCompare(b.name));

	return (
		<div className="border-primary-200 border-b bg-white">
			<div className="mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-7">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="min-w-0">
						<p className="font-medium text-primary-700 text-xs uppercase tracking-[0.12em]">
							Personal queue
						</p>
						<h1 className="mt-1 text-xl font-semibold tracking-tight text-neutral-900 md:text-[25px]">
							My Work
						</h1>
						<p className="mt-1 max-w-xl text-neutral-600 text-sm">
							Your assigned work, across every workspace you can access.
						</p>
					</div>
					<button
						type="button"
						onClick={onRefresh}
						disabled={loading}
						className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 bg-neutral-100 px-3 font-medium text-primary-700 text-sm shadow-sm transition-colors hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:text-neutral-400"
						aria-label="Refresh My Work"
					>
						<RefreshCw
							size={14}
							className={
								loading ? "animate-spin motion-reduce:animate-none" : ""
							}
							aria-hidden
						/>
						{loading ? "Refreshing…" : "Refresh"}
					</button>
				</div>

				<div className="mt-5 flex min-w-0 flex-col gap-3 pb-4 lg:flex-row lg:items-center">
					<div
						className="inline-flex w-fit items-center gap-0.5 rounded-lg border border-neutral-200 bg-neutral-100 p-0.5"
						role="tablist"
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
							className={`${controlClass()} w-full pr-3 pl-9`}
						/>
					</div>

					<div className="flex min-w-0 flex-wrap items-center gap-2">
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
							className={`${controlClass()} min-w-32 max-w-[12rem]`}
							aria-label="Filter by workspace"
						>
							<option value="">All workspaces</option>
							{workspaceOptions.map((workspace) => (
								<option key={workspace.id} value={workspace.id}>
									{workspace.name}
								</option>
							))}
						</select>

						<label className="sr-only" htmlFor="my-work-source-filter">
							Source
						</label>
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
								className={`${controlClass()} min-w-28 pl-8`}
								aria-label="Filter by source"
							>
								<option value="">All sources</option>
								<option value="board">Board</option>
								<option value="tracker">Tracker</option>
							</select>
						</div>
					</div>
				</div>
			</div>
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
			role="tab"
			aria-selected={active}
			onClick={onClick}
			className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 ${
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
