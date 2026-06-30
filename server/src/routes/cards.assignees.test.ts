import { describe, expect, it } from "vitest";
import { diffAssigneeIds } from "./card-assignees.js";

describe("diffAssigneeIds", () => {
	it("detects added assignees", () => {
		expect(diffAssigneeIds([1], [1, 2])).toEqual({
			added: [2],
			removed: [],
		});
	});

	it("detects removed assignees", () => {
		expect(diffAssigneeIds([1, 2], [2])).toEqual({
			added: [],
			removed: [1],
		});
	});

	it("dedupes next list", () => {
		expect(diffAssigneeIds([], [3, 3, 3])).toEqual({
			added: [3],
			removed: [],
		});
	});

	it("returns empty diff when sets match", () => {
		expect(diffAssigneeIds([1, 2], [2, 1])).toEqual({
			added: [],
			removed: [],
		});
	});

	it("models signable move: existing assignee preserved, new one added", () => {
		// User A (id=1) assigned in Backlog; signable column adds user B (id=2).
		const prev = [1];
		const afterSignableAdd = diffAssigneeIds(prev, [...prev, 2]);
		expect(afterSignableAdd).toEqual({ added: [2], removed: [] });

		// Idempotent re-drag: B already on card.
		const afterDuplicate = diffAssigneeIds([1, 2], [1, 2]);
		expect(afterDuplicate).toEqual({ added: [], removed: [] });
	});

	it("clearing all assignees", () => {
		expect(diffAssigneeIds([1, 2], [])).toEqual({
			added: [],
			removed: [1, 2],
		});
	});
});
