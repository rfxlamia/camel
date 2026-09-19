import type { MyWorkItem } from "../../shared/myWorkTypes";

export function item(
	id: number,
	category: string | null,
	overrides: Partial<MyWorkItem> = {},
): MyWorkItem {
	return {
		id,
		key: `CA-${id}`,
		title: `Task ${id}`,
		description: "",
		source: "tracker",
		status: {
			id: id,
			kind: "status",
			name: category ?? "Unknown",
			position: id,
			colour: "#ccc",
			category: category as MyWorkItem["statusCategory"],
			slot: null,
		},
		priority: null,
		labels: [],
		assignees: [],
		version: 1,
		createdAt: "2026-09-11T00:00:00.000Z",
		updatedAt: "2026-09-11T00:00:00.000Z",
		workspace: { id: 1, name: "Atlas", timezone: "Asia/Jakarta" },
		workspaceId: 1,
		workspaceName: "Atlas",
		identity: { workspaceId: 1, source: "tracker", key: `CA-${id}` },
		statusCategory: category as MyWorkItem["statusCategory"],
		canMarkDone: true,
		markDoneReason: null,
		...overrides,
	};
}

export function sourceItem(
	id: number,
	source: MyWorkItem["source"],
	key: string,
	overrides: Partial<MyWorkItem> = {},
): MyWorkItem {
	const workspaceId = overrides.workspaceId ?? 1;
	const workspace = overrides.workspace ?? {
		id: workspaceId,
		name: `Workspace ${workspaceId}`,
		timezone: "Asia/Jakarta",
	};
	const category =
		overrides.statusCategory === undefined
			? "started"
			: overrides.statusCategory;
	return item(id, category, {
		...overrides,
		key,
		source,
		workspace,
		workspaceId,
		workspaceName: workspace.name,
		identity: { workspaceId, source, key },
	});
}
