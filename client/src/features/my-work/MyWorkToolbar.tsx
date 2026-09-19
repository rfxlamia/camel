import {
	FilterControls,
	type MyWorkToolbarProps,
	ScopeTabs,
	SearchControl,
	workspaceOptionsFor,
} from "./MyWorkToolbarParts";

export type { MyWorkToolbarProps } from "./MyWorkToolbarParts";

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
