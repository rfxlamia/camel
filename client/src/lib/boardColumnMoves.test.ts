import { describe, expect, it } from "vitest";
import { moveCardToColumn } from "./boardColumnMoves";
import type { Card, Column } from "../types";

describe("moveCardToColumn", () => {
	const card: Card = {
		id: 1,
		columnId: 1,
		title: "Ship feature",
		description: "",
		position: 1,
		version: 1,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
		startedAt: null,
		doneAt: null,
		dueDate: null,
		assignees: [],
	};
	const columns: Column[] = [
		{
			id: 1,
			title: "To Do",
			position: 0,
			wipLimit: null,
			policy: "",
			isDone: false,
			isSignable: false,
			signableAssigneeId: null,
			color: null,
			cards: [card],
		},
		{
			id: 2,
			title: "In Progress",
			position: 1,
			wipLimit: null,
			policy: "",
			isDone: false,
			isSignable: false,
			signableAssigneeId: null,
			color: null,
			cards: [],
		},
	];

	it("returns the same columns when source and target are identical", () => {
		expect(moveCardToColumn(columns, 1, 1)).toBe(columns);
	});
});
