import { describe, expect, it } from "vitest";
import {
	mapColumnSlots,
	statusIdForSlot,
	type StatusSlot,
} from "./column-status-map.js";

describe("mapColumnSlots", () => {
	it("maps software-development columns by ordered non-done geometry", () => {
		const columns = [
			{ id: 11, title: "Inbox", position: 1024, is_done: false },
			{ id: 12, title: "Ready", position: 2048, is_done: false },
			{ id: 13, title: "In Progress", position: 3072, is_done: false },
			{ id: 14, title: "In Review", position: 4096, is_done: false },
			{ id: 15, title: "Done", position: 5120, is_done: true },
		];

		const mapped = mapColumnSlots(columns);

		expect([...mapped.entries()]).toEqual([
			[11, "backlog"],
			[12, "todo"],
			[13, "in_progress"],
			[14, "in_progress"],
			[15, "done"],
		]);
	});

	it("maps Inbox and a second-column Finished by is_done", () => {
		const mapped = mapColumnSlots([
			{ id: 21, title: "Inbox", position: 1024, is_done: false },
			{ id: 22, title: "Finished", position: 2048, is_done: true },
		]);

		expect(mapped.get(21)).toBe("backlog");
		expect(mapped.get(22)).toBe("done");
	});

	it("maps a leftmost is_done column to done before counting non-done columns", () => {
		const mapped = mapColumnSlots([
			{ id: 31, title: "Done", position: 1024, is_done: true },
			{ id: 32, title: "Inbox", position: 2048, is_done: false },
			{ id: 33, title: "Next", position: 3072, is_done: false },
		]);

		expect([...mapped.entries()]).toEqual([
			[31, "done"],
			[32, "backlog"],
			[33, "todo"],
		]);
	});

	it("shares in_progress across the third and later non-done columns", () => {
		const mapped = mapColumnSlots([
			{ id: 41, title: "One", position: 1024, is_done: false },
			{ id: 42, title: "Two", position: 2048, is_done: false },
			{ id: 43, title: "Three", position: 3072, is_done: false },
			{ id: 44, title: "Four", position: 4096, is_done: false },
			{ id: 45, title: "Five", position: 5120, is_done: false },
			{ id: 46, title: "Done", position: 6144, is_done: true },
		]);

		expect([...mapped.entries()]).toEqual([
			[41, "backlog"],
			[42, "todo"],
			[43, "in_progress"],
			[44, "in_progress"],
			[45, "in_progress"],
			[46, "done"],
		]);
		expect([...mapped.values()]).not.toContain("canceled");
	});

	it("uses a stable id tie-breaker without mutating the input", () => {
		const columns = [
			{ id: 52, position: 1024, is_done: false },
			{ id: 51, position: 1024, is_done: false },
			{ id: 53, position: 2048, is_done: false },
		];
		const original = [...columns];

		const mapped = mapColumnSlots(columns);

		expect([...mapped.entries()]).toEqual([
			[51, "backlog"],
			[52, "todo"],
			[53, "in_progress"],
		]);
		expect(columns).toEqual(original);
	});

	it("does not use column title or category when assigning slots", () => {
		const renamed = mapColumnSlots([
			{
				id: 61,
				title: "QA Gate",
				category: "completed",
				position: 1024,
				is_done: false,
			},
			{
				id: 62,
				title: "Whatever",
				category: "backlog",
				position: 2048,
				is_done: false,
			},
			{
				id: 63,
				title: "Renamed Done",
				category: "backlog",
				position: 3072,
				is_done: true,
			},
		]);

		const sameGeometry = mapColumnSlots([
			{ id: 61, title: "Backlog", category: "started", position: 1024, is_done: false },
			{ id: 62, title: "In Review", category: "completed", position: 2048, is_done: false },
			{ id: 63, title: "Done", category: "canceled", position: 3072, is_done: true },
		]);

		expect(renamed).toEqual(sameGeometry);
	});
});

describe("statusIdForSlot", () => {
	const slottedStatuses = [
		{ id: 101, kind: "status", slot: "backlog" as StatusSlot },
		{ id: 102, kind: "status", slot: "todo" as StatusSlot },
		{ id: 103, kind: "status", slot: "in_progress" as StatusSlot },
		{ id: 104, kind: "status", slot: "done" as StatusSlot },
		{ id: 105, kind: "status", slot: "canceled" as StatusSlot },
	];

	it("resolves each slot only from kind=status rows with non-null slots", () => {
		const rows = [
			...slottedStatuses,
			{ id: 199, kind: "status", slot: null },
			{ id: 299, kind: "priority", slot: "backlog" as StatusSlot },
		];

		expect(statusIdForSlot(rows, "backlog")).toBe(101);
		expect(statusIdForSlot(rows, "todo")).toBe(102);
		expect(statusIdForSlot(rows, "in_progress")).toBe(103);
		expect(statusIdForSlot(rows, "done")).toBe(104);
		expect(statusIdForSlot(rows, "canceled")).toBe(105);
	});

	it("returns null when a slot has no eligible vocabulary row", () => {
		expect(
			statusIdForSlot(
				[{ id: 199, kind: "status", slot: null }],
				"in_progress",
			),
		).toBeNull();
	});
});
