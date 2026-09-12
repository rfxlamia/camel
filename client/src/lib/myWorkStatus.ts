import type { MyWorkItem, MyWorkScope } from "../types/myWork";

export type MyWorkStatusGroup =
	| "backlog"
	| "started"
	| "completed"
	| "canceled"
	| "other";

export type MyWorkGroupMap = Record<MyWorkStatusGroup, MyWorkItem[]>;

type MyWorkStatusSource = Pick<MyWorkItem, "status" | "statusCategory">;

function categoryToGroup(
	category: string | null | undefined,
): MyWorkStatusGroup | null {
	switch (category) {
		case "backlog":
			return "backlog";
		case "started":
			return "started";
		case "completed":
			return "completed";
		case "canceled":
			return "canceled";
		default:
			return null;
	}
}

function slotToGroup(
	slot: string | null | undefined,
): MyWorkStatusGroup | null {
	switch (slot) {
		case "backlog":
		case "todo":
			return "backlog";
		case "in_progress":
			return "started";
		case "done":
			return "completed";
		case "canceled":
			return "canceled";
		default:
			return null;
	}
}

/** Normalize the server's existing category/slot vocabulary into My Work groups. */
export function normalizeMyWorkStatus(
	item: MyWorkStatusSource,
): MyWorkStatusGroup {
	const category = item.statusCategory ?? item.status.category;
	const categoryGroup = categoryToGroup(category);
	if (categoryGroup) return categoryGroup;
	if (category !== null && category !== undefined) return "other";
	return slotToGroup(item.status.slot) ?? "other";
}

export function isActiveMyWorkItem(item: MyWorkStatusSource): boolean {
	const group = normalizeMyWorkStatus(item);
	return group === "backlog" || group === "started" || group === "other";
}

/** Return a new array containing only the requested Active/All scope. */
export function filterMyWorkItems(
	items: MyWorkItem[],
	scope: MyWorkScope,
): MyWorkItem[] {
	if (scope === "all") return [...items];
	return items.filter(isActiveMyWorkItem);
}

function emptyMyWorkGroups(): MyWorkGroupMap {
	return {
		backlog: [],
		started: [],
		completed: [],
		canceled: [],
		other: [],
	};
}

/** Bucket server-provided rows by normalized status without dropping unknown rows. */
export function deriveMyWorkGroups(
	items: MyWorkItem[],
	scope: MyWorkScope = "all",
): MyWorkGroupMap {
	const groups = emptyMyWorkGroups();
	for (const item of filterMyWorkItems(items, scope)) {
		groups[normalizeMyWorkStatus(item)].push(item);
	}
	return groups;
}
