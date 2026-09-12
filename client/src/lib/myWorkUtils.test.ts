import { describe, expect, it } from "vitest";
import type { MyWorkItem } from "../types/myWork";
import {
	deriveMyWorkGroups,
	filterMyWorkItems,
	isMyWorkItemOverdue,
	normalizeMyWorkStatus,
	orderMyWorkItems,
	paginateMyWorkItems,
	parseMyWorkViewState,
	serializeMyWorkViewState,
} from "./myWorkUtils";

function item(
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

function sourceItem(
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

describe("My Work status normalization and filtering", () => {
	it("maps known categories and keeps unknown categories in Other", () => {
		expect(normalizeMyWorkStatus(item(1, "backlog"))).toBe("backlog");
		expect(normalizeMyWorkStatus(item(2, "started"))).toBe("started");
		expect(normalizeMyWorkStatus(item(3, "completed"))).toBe("completed");
		expect(normalizeMyWorkStatus(item(4, "canceled"))).toBe("canceled");
		expect(normalizeMyWorkStatus(item(5, "mystery"))).toBe("other");
	});

	it("excludes terminal categories from Active but preserves them in All", () => {
		const items = [
			item(1, "backlog"),
			item(2, "started"),
			item(3, "completed"),
			item(4, "canceled"),
			item(5, "mystery"),
		];

		expect(filterMyWorkItems(items, "active").map((entry) => entry.id)).toEqual(
			[1, 2, 5],
		);
		expect(filterMyWorkItems(items, "all")).toEqual(items);
	});

	it("derives status groups without dropping unknown items", () => {
		const items = [
			item(1, "backlog"),
			item(2, "started"),
			item(3, "completed"),
			item(4, "canceled"),
			item(5, "mystery"),
		];
		const groups = deriveMyWorkGroups(items, "all");

		expect(groups.backlog.map((entry) => entry.id)).toEqual([1]);
		expect(groups.started.map((entry) => entry.id)).toEqual([2]);
		expect(groups.completed.map((entry) => entry.id)).toEqual([3]);
		expect(groups.canceled.map((entry) => entry.id)).toEqual([4]);
		expect(groups.other.map((entry) => entry.id)).toEqual([5]);
	});
});

describe("My Work timezone ordering", () => {
	it("does not mark a due-today item overdue before the workspace day ends", () => {
		const dueToday = sourceItem(10, "board", "CA-10", {
			dueDate: "2026-09-11",
		});

		expect(
			isMyWorkItemOverdue(dueToday, new Date("2026-09-11T16:59:59.000Z")),
		).toBe(false);
		expect(
			isMyWorkItemOverdue(dueToday, new Date("2026-09-11T17:00:00.000Z")),
		).toBe(true);
	});

	it("does not mark terminal past-due items overdue", () => {
		const now = new Date("2026-09-11T10:00:00.000Z");

		expect(
			isMyWorkItemOverdue(
				sourceItem(11, "board", "CA-11", {
					dueDate: "2026-09-10",
					statusCategory: "completed",
				}),
				now,
			),
		).toBe(false);
		expect(
			isMyWorkItemOverdue(
				sourceItem(12, "board", "CA-12", {
					dueDate: "2026-09-10",
					statusCategory: "canceled",
				}),
				now,
			),
		).toBe(false);
	});

	it("orders groups, overdue items, due dates, and equal ties deterministically", () => {
		const items = [
			sourceItem(2, "board", "CA-2", {
				dueDate: "2026-09-12",
				updatedAt: "2026-09-11T12:00:00.000Z",
			}),
			sourceItem(1, "board", "CA-1", {
				dueDate: "2026-09-12",
				updatedAt: "2026-09-11T12:00:00.000Z",
			}),
			sourceItem(3, "board", "CA-3", {
				dueDate: "2026-09-10",
				updatedAt: "2026-09-11T12:00:00.000Z",
			}),
			sourceItem(4, "board", "CA-4", {
				dueDate: "2026-09-09",
				updatedAt: "2026-09-11T12:00:00.000Z",
			}),
		];

		expect(
			orderMyWorkItems(items, new Date("2026-09-11T10:00:00.000Z")).map(
				(entry) => entry.id,
			),
		).toEqual([4, 3, 1, 2]);
	});

	it("uses source-specific due fields at the workspace timezone boundary", () => {
		const tracker = sourceItem(20, "tracker", "OR-20", {
			endDate: "2026-09-10",
		});
		const board = sourceItem(21, "board", "AT-21", {
			dueDate: "2026-09-11",
		});
		const beforeLocalDayEnds = new Date("2026-09-10T16:59:59.000Z");
		const afterLocalDayEnds = new Date("2026-09-10T17:00:00.000Z");

		expect(tracker).toMatchObject({
			source: "tracker",
			endDate: "2026-09-10",
		});
		expect(tracker).not.toHaveProperty("dueDate");
		expect(isMyWorkItemOverdue(tracker, beforeLocalDayEnds)).toBe(false);
		expect(isMyWorkItemOverdue(tracker, afterLocalDayEnds)).toBe(true);
		expect(
			orderMyWorkItems([board, tracker], afterLocalDayEnds).map(
				(entry) => entry.id,
			),
		).toEqual([20, 21]);
	});

	it("mirrors numeric workspace, source, key, and id tie-breakers across pages", () => {
		const now = new Date("2026-09-11T10:00:00.000Z");
		const workspaceTen = sourceItem(10, "tracker", "OR-2", {
			workspaceId: 10,
			workspace: { id: 10, name: "Workspace 10", timezone: "Asia/Jakarta" },
		});
		const workspaceTwo = sourceItem(20, "tracker", "OR-10", {
			workspaceId: 2,
			workspace: { id: 2, name: "Workspace 2", timezone: "Asia/Jakarta" },
		});
		expect(
			orderMyWorkItems([workspaceTen, workspaceTwo], now).map(
				(entry) => entry.id,
			),
		).toEqual([20, 10]);

		const keyTen = sourceItem(30, "tracker", "OR-10", {
			workspaceId: 2,
		});
		const keyTwo = sourceItem(40, "tracker", "OR-2", {
			workspaceId: 2,
		});
		const keyOrdered = orderMyWorkItems([keyTen, keyTwo], now);
		expect(keyOrdered.map((entry) => entry.id)).toEqual([40, 30]);
		expect(
			paginateMyWorkItems(keyOrdered, 1, 1).items.map((entry) => entry.id),
		).toEqual([40]);
		expect(
			paginateMyWorkItems(keyOrdered, 2, 1).items.map((entry) => entry.id),
		).toEqual([30]);

		const board = sourceItem(50, "board", "OR-2", {
			workspaceId: 2,
		});
		const trackerWithHigherId = sourceItem(10, "tracker", "OR-2", {
			workspaceId: 2,
		});
		const trackerWithLowerId = sourceItem(2, "tracker", "OR-2", {
			workspaceId: 2,
		});
		expect(
			orderMyWorkItems(
				[trackerWithHigherId, board, trackerWithLowerId],
				now,
			).map((entry) => entry.id),
		).toEqual([50, 2, 10]);
	});
});

describe("My Work pagination and URL state", () => {
	it("splits 73 items into stable 50-item pages without mutating the source", () => {
		const items = Array.from({ length: 73 }, (_, index) =>
			item(index + 1, "started"),
		);
		const original = [...items];

		const firstPage = paginateMyWorkItems(items, 1);
		const secondPage = paginateMyWorkItems(items, 2);

		expect(firstPage.items).toHaveLength(50);
		expect(secondPage.items).toHaveLength(23);
		expect(firstPage.items[0]?.id).toBe(1);
		expect(secondPage.items[0]?.id).toBe(51);
		expect(firstPage.pageCount).toBe(2);
		expect(items).toEqual(original);
	});

	it("parses valid view state and applies safe defaults to invalid values", () => {
		const parsed = parseMyWorkViewState(
			new URLSearchParams(
				"scope=all&workspaceId=17&source=tracker&q=imgae%20uplod&page=2",
			),
		);
		expect(parsed).toEqual({
			scope: "all",
			workspaceId: 17,
			source: "tracker",
			q: "imgae uplod",
			page: 2,
		});

		const invalid = parseMyWorkViewState(
			new URLSearchParams(
				"scope=unknown&workspaceId=abc&source=other&q=&page=0",
			),
		);
		expect(invalid).toEqual({
			scope: "active",
			workspaceId: "",
			source: "",
			q: "",
			page: 1,
		});
	});

	it("serializes view state in a form that round-trips through the parser", () => {
		const state = {
			scope: "all" as const,
			workspaceId: 17,
			source: "board" as const,
			q: "  retry  ",
			page: 2,
		};
		expect(parseMyWorkViewState(serializeMyWorkViewState(state))).toEqual({
			...state,
			q: "retry",
		});
	});
});
