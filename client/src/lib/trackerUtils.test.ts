//
// trackerUtils.ts already exists with untested behaviour this task locks
// down before trackerRollup.ts is built on top of it. No implementation
// change is made here.
import { describe, expect, it } from "vitest";
import type { TrackerItem, TrackerVocabulary } from "../types";
import {
	groupItemsByStatus,
	sortItemsOldestFirst,
	sortStatusesByPosition,
} from "./trackerUtils";

function vocab(id: number, name: string, position: number): TrackerVocabulary {
	return { id, kind: "status", name, position, colour: "#ccc" };
}

function item(id: number, statusId: number, createdAt: string): TrackerItem {
	return {
		id,
		key: `CA-${id}`,
		title: `Task ${id}`,
		description: "",
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
