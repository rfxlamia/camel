import { describe, expect, it } from "vitest";
import { buildBoardResponse } from "./board.js";
import type { HumanColumn } from "./helpers.js";

function makeColumn(
	overrides: Partial<HumanColumn> & { id: number },
): HumanColumn {
	return {
		title: `Col ${overrides.id}`,
		position: overrides.id,
		wip_limit: null,
		policy: "manual",
		is_done: false,
		...overrides,
	};
}

function makeCard(overrides: {
	id: number;
	column_id: number;
	position?: number;
	assignee_id?: number | null;
	assignee_username?: string | null;
	assignee_display_name?: string | null;
}) {
	return {
		id: overrides.id,
		column_id: overrides.column_id,
		title: `Card ${overrides.id}`,
		description: `Description ${overrides.id}`,
		position: overrides.position ?? overrides.id,
		version: 1,
		created_at: "2026-06-26T00:00:00Z",
		started_at: null,
		done_at: null,
		due_date: null,
		assignee_id: overrides.assignee_id ?? null,
		assignee_username: overrides.assignee_username ?? null,
		assignee_display_name: overrides.assignee_display_name ?? null,
	};
}

describe("buildBoardResponse", () => {
	it("groups cards into the correct columns", () => {
		const columns = [makeColumn({ id: 1 }), makeColumn({ id: 2 })];
		const cards = [
			makeCard({ id: 10, column_id: 1 }),
			makeCard({ id: 20, column_id: 2 }),
			makeCard({ id: 30, column_id: 1 }),
		];

		const result = buildBoardResponse(columns, cards);

		expect(result.columns).toHaveLength(2);
		expect(result.columns[0].cards).toHaveLength(2);
		expect(result.columns[0].cards.map((c) => c.id)).toEqual([10, 30]);
		expect(result.columns[1].cards).toHaveLength(1);
		expect(result.columns[1].cards[0].id).toBe(20);
	});

	it("returns empty cards array for columns with no cards", () => {
		const columns = [
			makeColumn({ id: 1 }),
			makeColumn({ id: 2 }),
			makeColumn({ id: 3 }),
		];
		const cards = [makeCard({ id: 10, column_id: 1 })];

		const result = buildBoardResponse(columns, cards);

		expect(result.columns[0].cards).toHaveLength(1);
		expect(result.columns[1].cards).toHaveLength(0);
		expect(result.columns[2].cards).toHaveLength(0);
	});

	it("sets assignee to null when assignee_id is null", () => {
		const columns = [makeColumn({ id: 1 })];
		const cards = [makeCard({ id: 10, column_id: 1, assignee_id: null })];

		const result = buildBoardResponse(columns, cards);

		expect(result.columns[0].cards[0].assignee).toBeNull();
	});

	it("maps assignee fields when assignee_id is present", () => {
		const columns = [makeColumn({ id: 1 })];
		const cards = [
			makeCard({
				id: 10,
				column_id: 1,
				assignee_id: 42,
				assignee_username: "alice",
				assignee_display_name: "Alice W",
			}),
		];

		const result = buildBoardResponse(columns, cards);

		expect(result.columns[0].cards[0].assignee).toEqual({
			id: 42,
			username: "alice",
			displayName: "Alice W",
		});
	});

	it("preserves card ordering from input", () => {
		const columns = [makeColumn({ id: 1 })];
		const cards = [
			makeCard({ id: 30, column_id: 1, position: 3 }),
			makeCard({ id: 10, column_id: 1, position: 1 }),
			makeCard({ id: 20, column_id: 1, position: 2 }),
		];

		const result = buildBoardResponse(columns, cards);

		expect(result.columns[0].cards.map((c) => c.id)).toEqual([30, 10, 20]);
	});

	it("maps all card fields correctly", () => {
		const columns = [makeColumn({ id: 1 })];
		const cards = [
			{
				id: 10,
				column_id: 1,
				title: "My Card",
				description: "Details here",
				position: 5,
				version: 3,
				created_at: "2026-06-01T10:00:00Z",
				started_at: "2026-06-02T08:00:00Z",
				done_at: "2026-06-03T16:00:00Z",
				due_date: "2026-06-10",
				assignee_id: null,
				assignee_username: null,
				assignee_display_name: null,
			},
		];

		const result = buildBoardResponse(columns, cards);
		const card = result.columns[0].cards[0];

		expect(card).toEqual({
			id: 10,
			columnId: 1,
			title: "My Card",
			description: "Details here",
			position: 5,
			version: 3,
			createdAt: "2026-06-01T10:00:00Z",
			startedAt: "2026-06-02T08:00:00Z",
			doneAt: "2026-06-03T16:00:00Z",
			dueDate: "2026-06-10",
			assignee: null,
		});
	});

	it("maps column fields correctly", () => {
		const columns = [
			{
				id: 5,
				title: "Done",
				position: 3,
				wip_limit: 5,
				policy: "auto",
				is_done: true,
			},
		];

		const result = buildBoardResponse(columns, []);

		expect(result.columns[0]).toEqual({
			id: 5,
			title: "Done",
			position: 3,
			wipLimit: 5,
			policy: "auto",
			isDone: true,
			cards: [],
		});
	});

	it("handles empty inputs gracefully", () => {
		const result = buildBoardResponse([], []);

		expect(result).toEqual({ columns: [] });
	});
});
