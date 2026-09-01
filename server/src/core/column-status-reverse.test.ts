import { describe, expect, it } from "vitest";
import { resolveColumnForStatusChange } from "./column-status-reverse.js";

describe("resolveColumnForStatusChange", () => {
	const twoCol = [
		{ id: 1, position: 0, is_done: false },
		{ id: 2, position: 1, is_done: true },
	];

	it("moves backlog card to is_done column when target is done", () => {
		expect(resolveColumnForStatusChange(1, "done", twoCol)).toBe(2);
	});

	it("moves done card to backlog column when target is backlog", () => {
		expect(resolveColumnForStatusChange(2, "backlog", twoCol)).toBe(1);
	});

	it("keeps column for canceled", () => {
		expect(resolveColumnForStatusChange(1, "canceled", twoCol)).toBeNull();
	});

	it("stays on in_progress column when already in_progress", () => {
		const cols = [
			{ id: 10, position: 0, is_done: false },
			{ id: 11, position: 1, is_done: false },
			{ id: 12, position: 2, is_done: false },
		];
		expect(resolveColumnForStatusChange(12, "in_progress", cols)).toBe(12);
	});

	it("moves to first in_progress column from backlog", () => {
		const cols = [
			{ id: 10, position: 0, is_done: false },
			{ id: 11, position: 1, is_done: false },
			{ id: 12, position: 2, is_done: false },
		];
		expect(resolveColumnForStatusChange(10, "in_progress", cols)).toBe(12);
	});
});
