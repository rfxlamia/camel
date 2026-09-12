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
		const dueToday = item(10, "started", { dueDate: "2026-09-11" });

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
				item(11, "completed", { dueDate: "2026-09-10" }),
				now,
			),
		).toBe(false);
		expect(
			isMyWorkItemOverdue(item(12, "canceled", { dueDate: "2026-09-10" }), now),
		).toBe(false);
	});

	it("orders groups, overdue items, due dates, and equal ties deterministically", () => {
		const items = [
			item(2, "started", {
				dueDate: "2026-09-12",
				updatedAt: "2026-09-11T12:00:00.000Z",
			}),
			item(1, "started", {
				dueDate: "2026-09-12",
				updatedAt: "2026-09-11T12:00:00.000Z",
			}),
			item(3, "started", {
				dueDate: "2026-09-10",
				updatedAt: "2026-09-11T12:00:00.000Z",
			}),
			item(4, "backlog", {
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
