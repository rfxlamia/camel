import { describe, expect, it } from "vitest";
import { buildRemapPlan } from "./remap-card-statuses.js";

type Column = { id: number; position: number; is_done: boolean };
type Card = {
	id: number;
	column_id: number;
	status_id: number | null;
	deleted_at: string | null;
};
type Status = { id: number; kind: string; slot: string | null };

const statuses: Status[] = [
	{ id: 101, kind: "status", slot: "backlog" },
	{ id: 102, kind: "status", slot: "todo" },
	{ id: 103, kind: "status", slot: "in_progress" },
	{ id: 104, kind: "status", slot: "done" },
	{ id: 105, kind: "status", slot: "canceled" },
];

const beforeColumns: Column[] = [
	{ id: 1, position: 1, is_done: false },
	{ id: 2, position: 2, is_done: false },
	{ id: 3, position: 3, is_done: true },
];

const cards: Card[] = [
	{ id: 11, column_id: 1, status_id: 101, deleted_at: null },
	{ id: 12, column_id: 2, status_id: 102, deleted_at: null },
	{ id: 13, column_id: 3, status_id: 104, deleted_at: null },
	{ id: 14, column_id: 3, status_id: 104, deleted_at: "2026-01-01T00:00:00Z" },
];

describe("buildRemapPlan", () => {
	it("omits unchanged slots, remaps live cards to new status ids, and excludes soft-deleted cards", () => {
		const afterColumns = beforeColumns.map((column) =>
			column.id === 2
				? { ...column, is_done: true }
				: { ...column, is_done: false },
		);

		expect(
			buildRemapPlan({
				beforeColumns,
				afterColumns,
				cards,
				statuses,
			}),
		).toEqual([
			{ cardId: 12, columnId: 2, fromStatusId: 102, statusId: 104 },
			{ cardId: 13, columnId: 3, fromStatusId: 104, statusId: 102 },
		]);
	});

	it("uses is_done-wins geometry before counting non-done columns", () => {
		const columns: Column[] = [
			{ id: 21, position: 1, is_done: true },
			{ id: 22, position: 2, is_done: false },
			{ id: 23, position: 3, is_done: false },
		];
		const result = buildRemapPlan({
			beforeColumns: columns.map((column) => ({ ...column, is_done: false })),
			afterColumns: columns,
			cards: [
				{ id: 31, column_id: 22, status_id: 102, deleted_at: null },
				{ id: 32, column_id: 23, status_id: 103, deleted_at: null },
			],
			statuses,
		});

		expect(result).toEqual([
			{ cardId: 31, columnId: 22, fromStatusId: 102, statusId: 101 },
			{ cardId: 32, columnId: 23, fromStatusId: 103, statusId: 102 },
		]);
	});

	it("remaps surviving cards when a middle column is deleted", () => {
		const beforeColumns: Column[] = [
			{ id: 1, position: 1, is_done: false },
			{ id: 2, position: 2, is_done: false },
			{ id: 3, position: 3, is_done: false },
			{ id: 4, position: 4, is_done: true },
		];
		const afterColumns = beforeColumns.filter((column) => column.id !== 2);

		expect(
			buildRemapPlan({
				beforeColumns,
				afterColumns,
				cards: [
					{ id: 11, column_id: 1, status_id: 101, deleted_at: null },
					{ id: 12, column_id: 2, status_id: 102, deleted_at: null },
					{ id: 13, column_id: 3, status_id: 103, deleted_at: null },
					{ id: 14, column_id: 4, status_id: 104, deleted_at: null },
				],
				statuses,
			}),
		).toEqual([
			{ cardId: 13, columnId: 3, fromStatusId: 103, statusId: 102 },
		]);
	});
});
