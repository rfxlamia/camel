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
		<>
			<div className="bg-white">
				<div className="mx-auto max-w-6xl px-4 pt-5 md:px-6 md:pt-7">
					<ToolbarIntro loading={loading} onRefresh={onRefresh} />
				</div>
			</div>
			<div
				data-testid="my-work-filter-row"
				className="sticky top-0 z-20 border-neutral-200/70 border-y bg-white"
			>
				<div className="mx-auto max-w-6xl px-4 py-3 md:px-6">
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
			</div>
		</>
	);
}
