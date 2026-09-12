import {
	FilterControls,
	type MyWorkToolbarProps,
	ScopeTabs,
	SearchControl,
	ToolbarIntro,
	workspaceOptionsFor,
} from "./MyWorkToolbarParts";

export type { MyWorkToolbarProps } from "./MyWorkToolbarParts";

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
	const workspaceOptions = workspaceOptionsFor(workspaces, workspaceId);
	return (
		<div className="border-primary-200 border-b bg-white">
			<div className="mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-7">
				<ToolbarIntro loading={loading} onRefresh={onRefresh} />
				<div className="mt-5 flex min-w-0 flex-col gap-3 pb-4 lg:flex-row lg:items-center">
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
		</div>
	);
}
