//
// trackerUtils.ts already exists with untested behaviour this task locks
// down before trackerRollup.ts is built on top of it. No implementation
// change is made here.
import { describe, expect, it } from "vitest";
import type { TrackerProject, TrackerVocabulary, WorkItem } from "../types";
import {
	formatDateRange,
	groupItems,
	groupItemsByStatus,
	priorityGroupKey,
	projectGroupKey,
	resolveToggle,
	sortItemsOldestFirst,
	sortStatusesByPosition,
} from "./trackerUtils";

function vocab(id: number, name: string, position: number): TrackerVocabulary {
	return { id, kind: "status", name, position, colour: "#ccc" };
}

function item(id: number, statusId: number, createdAt: string): WorkItem {
	return {
		id,
		key: `CA-${id}`,
		title: `Task ${id}`,
		description: "",
		source: "tracker",
		status: {
			id: statusId,
			kind: "status",
			name: "Status",
			position: 0,
			colour: "#ccc",
		},
		priority: null,
		labels: [],
		assignees: [],
		version: 1,
		createdAt,
		updatedAt: createdAt,
	};
}

describe("resolveToggle", () => {
	it("adds the id when absent", () => {
		expect(resolveToggle([1], 2)).toEqual([1, 2]);
	});

	it("removes the id when present", () => {
		expect(resolveToggle([1, 2], 2)).toEqual([1]);
	});

	it("adds to an empty list", () => {
		expect(resolveToggle([], 5)).toEqual([5]);
	});
});

describe("formatDateRange", () => {
	it("formats equal dates as a single day and month", () => {
		expect(formatDateRange("2026-08-06", "2026-08-06")).toBe("6 Aug");
	});

	it("formats a range within the same month", () => {
		expect(formatDateRange("2026-08-06", "2026-08-26")).toBe("6–26 Aug");
	});

	it("formats a range across different months in the same year", () => {
		expect(formatDateRange("2026-08-28", "2026-09-03")).toBe("28 Aug–3 Sep");
	});

	it("formats a range across different years", () => {
		expect(formatDateRange("2026-12-30", "2027-01-03")).toBe(
			"30 Dec 2026–3 Jan 2027",
		);
	});

	it("formats a single start date when end is unset", () => {
		expect(formatDateRange("2026-08-06", null)).toBe("6 Aug");
	});

	it("formats a single end date when start is unset", () => {
		expect(formatDateRange(null, "2026-08-26")).toBe("26 Aug");
	});

	it("returns null when both dates are unset", () => {
		expect(formatDateRange(null, null)).toBeNull();
	});

	it("returns null for a reversed date range", () => {
		expect(formatDateRange("2026-08-26", "2026-08-06")).toBeNull();
	});
});

describe("sortStatusesByPosition", () => {
	it("orders statuses by ascending position", () => {
		const statuses = [
			vocab(3, "Done", 4096),
			vocab(1, "Backlog", 1024),
			vocab(2, "Todo", 2048),
		];
		expect(sortStatusesByPosition(statuses).map((s) => s.name)).toEqual([
			"Backlog",
			"Todo",
			"Done",
		]);
	});

	it("does not mutate the input array", () => {
		const statuses = [vocab(2, "Todo", 2048), vocab(1, "Backlog", 1024)];
		const copy = [...statuses];
		sortStatusesByPosition(statuses);
		expect(statuses).toEqual(copy);
	});
});

describe("sortItemsOldestFirst", () => {
	it("orders items by ascending createdAt", () => {
		const items = [
			item(1, 1, "2026-08-03T00:00:00.000Z"),
			item(2, 1, "2026-08-01T00:00:00.000Z"),
			item(3, 1, "2026-08-02T00:00:00.000Z"),
		];
		expect(sortItemsOldestFirst(items).map((i) => i.id)).toEqual([2, 3, 1]);
	});
});

describe("groupItemsByStatus", () => {
	it("buckets items under their status id, sorted oldest first within each bucket", () => {
		const statuses = [vocab(1, "Backlog", 1024), vocab(2, "Done", 2048)];
		const items = [
			item(1, 1, "2026-08-02T00:00:00.000Z"),
			item(2, 2, "2026-08-01T00:00:00.000Z"),
			item(3, 1, "2026-08-01T00:00:00.000Z"),
		];
		const grouped = groupItemsByStatus(items, statuses);
		expect(grouped.get(1)?.map((i) => i.id)).toEqual([3, 1]);
		expect(grouped.get(2)?.map((i) => i.id)).toEqual([2]);
	});

	it("initializes a bucket for every status even with no items", () => {
		const statuses = [vocab(1, "Backlog", 1024), vocab(2, "Done", 2048)];
		const grouped = groupItemsByStatus([], statuses);
		expect(grouped.get(1)).toEqual([]);
		expect(grouped.get(2)).toEqual([]);
	});

	it("drops items whose status id has no matching vocabulary", () => {
		const statuses = [vocab(1, "Backlog", 1024)];
		const items = [item(1, 999, "2026-08-01T00:00:00.000Z")];
		const grouped = groupItemsByStatus(items, statuses);
		expect(grouped.get(1)).toEqual([]);
		expect(grouped.get(999)).toBeUndefined();
	});
});

const statuses = [vocab(1, "Backlog", 1024), vocab(2, "Done", 2048)];
const priorities: TrackerVocabulary[] = [
	{ id: 10, kind: "priority", name: "Urgent", position: 1024, colour: "#ccc" },
	{ id: 11, kind: "priority", name: "Low", position: 2048, colour: "#ccc" },
];

function project(
	id: number,
	name: string,
	position: number,
	phases: TrackerProject["phases"] = [],
): TrackerProject {
	return {
		id,
		name,
		startDate: null,
		endDate: null,
		position,
		version: 1,
		phases,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
	};
}

function phase(id: number, projectId: number, position: number) {
	return {
		id,
		projectId,
		name: `Phase ${id}`,
		subtitle: "",
		startDate: null,
		endDate: null,
		position,
		version: 1,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
	};
}

function groupItem(
	id: number,
	overrides: Partial<WorkItem> = {},
): WorkItem {
	return {
		...item(id, 1, "2026-08-01T00:00:00.000Z"),
		status: statuses[0]!,
		...overrides,
	};
}

describe("projectGroupKey", () => {
	it("maps a numeric project id to a stable group key", () => {
		expect(projectGroupKey(42)).toBe("project:42");
	});

	it("maps null to the loose-project bucket key", () => {
		expect(projectGroupKey(null)).toBe("project:none");
	});
});

describe("priorityGroupKey", () => {
	it("maps a numeric priority id to a stable group key", () => {
		expect(priorityGroupKey(10)).toBe("priority:10");
	});

	it("maps null to the loose-priority bucket key", () => {
		expect(priorityGroupKey(null)).toBe("priority:none");
	});
});

describe("groupItems", () => {
	const context = { statuses, priorities, projects: [] as TrackerProject[] };

	it("keeps every item in exactly one group whatever the grouping", () => {
		const items = [
			groupItem(1, { projectId: 1, priority: priorities[0]! }),
			groupItem(2, { status: statuses[1]! }),
			groupItem(3, { projectId: 2 }),
			// Status, project and priority each point at a record that is not in
			// the vocabulary — the case that used to drop an item silently.
			groupItem(4, {
				status: vocab(99, "Ghost", 4096),
				projectId: 99,
				priority: {
					id: 99,
					kind: "priority",
					name: "Ghost",
					position: 4096,
					colour: "#ccc",
				},
			}),
		];
		const ctx = {
			...context,
			projects: [project(1, "Alpha", 1024), project(2, "Beta", 2048)],
		};

		for (const groupBy of ["status", "project", "priority"] as const) {
			const total = groupItems(items, groupBy, ctx).reduce(
				(sum, group) => sum + group.items.length,
				0,
			);
			expect(total).toBe(items.length);
		}
	});

	it("groups by status in vocabulary order, keeping empty statuses", () => {
		const groups = groupItems([groupItem(1)], "status", context);
		expect(groups.map((g) => g.label)).toEqual(["Backlog", "Done"]);
		expect(groups[0]?.key).toBe("status:1");
		expect(groups[0]?.status?.id).toBe(1);
		expect(groups[1]?.items).toEqual([]);
	});

	it("adds a No status bucket last, only when it has items", () => {
		expect(
			groupItems([groupItem(1)], "status", context).map((g) => g.label),
		).toEqual(["Backlog", "Done"]);

		const groups = groupItems(
			[groupItem(1, { status: vocab(99, "Ghost", 4096) })],
			"status",
			context,
		);
		expect(groups.at(-1)?.key).toBe("status:none");
		expect(groups.at(-1)?.items.map((i) => i.id)).toEqual([1]);
	});

	it("groups by project in position order and keeps an empty project visible", () => {
		const ctx = {
			...context,
			projects: [project(2, "Beta", 2048), project(1, "Alpha", 1024)],
		};
		const groups = groupItems([groupItem(1, { projectId: 2 })], "project", ctx);

		expect(groups.map((g) => g.label)).toEqual(["Alpha", "Beta"]);
		expect(groups[0]?.items).toEqual([]);
		expect(groups[1]?.projectId).toBe(2);
	});

	it("adds a No project bucket last, only when it has items", () => {
		const ctx = { ...context, projects: [project(1, "Alpha", 1024)] };

		expect(
			groupItems([groupItem(1, { projectId: 1 })], "project", ctx).map(
				(g) => g.label,
			),
		).toEqual(["Alpha"]);
		expect(groupItems([groupItem(1)], "project", ctx).map((g) => g.label)).toEqual(
			["Alpha", "No project"],
		);
	});

	it("treats an item pointing at a deleted project as No project", () => {
		const ctx = { ...context, projects: [project(1, "Alpha", 1024)] };
		const groups = groupItems([groupItem(1, { projectId: 99 })], "project", ctx);
		expect(groups.at(-1)?.key).toBe("project:none");
		expect(groups.at(-1)?.items.map((i) => i.id)).toEqual([1]);
	});

	it("orders items in a project by phase, then position", () => {
		const ctx = {
			...context,
			projects: [
				project(1, "Alpha", 1024, [phase(5, 1, 2048), phase(4, 1, 1024)]),
			],
		};
		const items = [
			groupItem(1, { projectId: 1, phaseId: null, position: 1 }),
			groupItem(2, { projectId: 1, phaseId: 5, position: 2048 }),
			groupItem(3, { projectId: 1, phaseId: 4, position: 2048 }),
			groupItem(4, { projectId: 1, phaseId: 4, position: 1024 }),
		];

		const groups = groupItems(items, "project", ctx);
		// Phase 4 (position 1024) before phase 5, and unphased items last.
		expect(groups[0]?.items.map((i) => i.id)).toEqual([4, 3, 2, 1]);
	});

	it("groups by priority, bucketing unset priorities last", () => {
		const items = [
			groupItem(1, { priority: priorities[1]! }),
			groupItem(2),
			groupItem(3, { priority: priorities[0]! }),
		];
		const groups = groupItems(items, "priority", context);

		expect(groups.map((g) => g.label)).toEqual(["Urgent", "Low", "No priority"]);
		expect(groups[0]?.items.map((i) => i.id)).toEqual([3]);
		expect(groups[2]?.items.map((i) => i.id)).toEqual([2]);
	});
});
