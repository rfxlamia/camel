import { describe, expect, it } from "vitest";
import { sourceItem } from "./myWorkTestSupport";
import {
	isMyWorkItemOverdue,
	orderMyWorkItems,
	paginateMyWorkItems,
} from "./myWorkUtils";

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
