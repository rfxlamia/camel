import { beforeEach, describe, expect, it, vi } from "vitest";

function chainable(result: unknown) {
	const builder: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of [
		"where",
		"select",
		"orderBy",
		"forUpdate",
		"innerJoin",
		"leftJoin",
	]) {
		builder[method] = vi.fn(() => builder);
	}
	const isArray = Array.isArray(result);
	builder.execute = vi.fn().mockResolvedValue(isArray ? result : [result]);
	builder.executeTakeFirst = vi
		.fn()
		.mockResolvedValue(isArray ? result[0] : result);
	builder.executeTakeFirstOrThrow = builder.executeTakeFirst;
	return builder;
}

const mockRecordActivity = vi.fn();
const mockAddCardAssignee = vi.fn();

vi.mock("../routes/helpers.js", () => ({
	recordActivity: (...args: unknown[]) => mockRecordActivity(...args),
}));
vi.mock("../routes/card-assignees.js", () => ({
	addCardAssignee: (...args: unknown[]) => mockAddCardAssignee(...args),
}));

import { applyBoardCardStatusChange } from "./board-card-status-change.js";

const actor = { id: 1, username: "tester", displayName: "Tester" };

const statusRows = [
	{ id: 101, kind: "status", slot: "backlog" },
	{ id: 102, kind: "status", slot: "todo" },
	{ id: 103, kind: "status", slot: "in_progress" },
	{ id: 104, kind: "status", slot: "done" },
	{ id: 105, kind: "status", slot: "canceled" },
];

type MockScenario = {
	card: {
		id: number;
		column_id: number;
		title: string;
		version: number;
		started_at: Date | null;
		done_at: Date | null;
	} | null;
	targetStatusId: number;
	targetStatusSlot: string | null;
	siblingColumns: Array<{ id: number; position: number; is_done: boolean }>;
	targetColumn?: {
		id: number;
		wip_limit: number | null;
		is_done: boolean;
		is_signable: boolean;
		signable_assignee_id: number | null;
		is_first: boolean;
	};
	siblingsInTarget?: Array<{ id: number; position: number }>;
};

function makeTrx(scenario: MockScenario) {
	const updateCalls: Array<Record<string, unknown>> = [];
	let vocabularyQueryCount = 0;
	let columnQueryCount = 0;
	let cardQueryCount = 0;

	const trx: Record<string, unknown> = {
		selectFrom: vi.fn((table: string) => {
			if (table === "cards") {
				cardQueryCount += 1;
				if (cardQueryCount === 1) {
					return chainable(scenario.card);
				}
				return chainable(scenario.siblingsInTarget ?? []);
			}
			if (table === "tracker_vocabularies") {
				vocabularyQueryCount += 1;
				if (vocabularyQueryCount === 1) {
					return chainable(
						scenario.targetStatusSlot
							? { id: scenario.targetStatusId, slot: scenario.targetStatusSlot }
							: { id: scenario.targetStatusId, slot: null },
					);
				}
				return chainable(statusRows);
			}
			if (table === "columns") {
				columnQueryCount += 1;
				if (columnQueryCount === 1) {
					return chainable({ board_id: null });
				}
				if (columnQueryCount === 2) {
					return chainable(scenario.siblingColumns);
				}
				return chainable(
					scenario.targetColumn ?? {
						id: 15,
						wip_limit: null,
						is_done: true,
						is_signable: false,
						signable_assignee_id: null,
						is_first: false,
					},
				);
			}
			return chainable(undefined);
		}),
		updateTable: vi.fn(() => ({
			set: vi.fn((values: Record<string, unknown>) => ({
				where: vi.fn(() => {
					updateCalls.push(values);
					return chainable(undefined);
				}),
			})),
		})),
	};

	return {
		trx: trx as Parameters<typeof applyBoardCardStatusChange>[0],
		updateCalls,
	};
}

beforeEach(() => {
	mockRecordActivity.mockReset();
	mockAddCardAssignee.mockReset();
	mockAddCardAssignee.mockResolvedValue(false);
});

describe("applyBoardCardStatusChange", () => {
	it("returns not_found when the card is missing", async () => {
		const { trx } = makeTrx({
			card: null,
			targetStatusId: 104,
			targetStatusSlot: "done",
			siblingColumns: [],
		});

		const result = await applyBoardCardStatusChange(trx, {
			workspaceId: 7,
			actor,
			cardId: 50,
			targetStatusId: 104,
		});

		expect(result).toEqual({ kind: "not_found" });
	});

	it("returns conflict when the version is stale", async () => {
		const { trx } = makeTrx({
			card: {
				id: 50,
				column_id: 11,
				title: "Test card",
				version: 2,
				started_at: null,
				done_at: null,
			},
			targetStatusId: 104,
			targetStatusSlot: "done",
			siblingColumns: [],
		});

		const result = await applyBoardCardStatusChange(trx, {
			workspaceId: 7,
			actor,
			cardId: 50,
			targetStatusId: 104,
			version: 1,
		});

		expect(result).toEqual({ kind: "conflict" });
	});

	it("returns invalid_status when the vocabulary row has no slot", async () => {
		const { trx } = makeTrx({
			card: {
				id: 50,
				column_id: 11,
				title: "Test card",
				version: 1,
				started_at: null,
				done_at: null,
			},
			targetStatusId: 999,
			targetStatusSlot: null,
			siblingColumns: [],
		});

		const result = await applyBoardCardStatusChange(trx, {
			workspaceId: 7,
			actor,
			cardId: 50,
			targetStatusId: 999,
		});

		expect(result).toEqual({ kind: "invalid_status" });
	});

	it("returns unmappable when the board cannot represent the slot", async () => {
		const { trx } = makeTrx({
			card: {
				id: 50,
				column_id: 11,
				title: "Test card",
				version: 1,
				started_at: null,
				done_at: null,
			},
			targetStatusId: 103,
			targetStatusSlot: "in_progress",
			siblingColumns: [
				{ id: 11, position: 1024, is_done: false },
				{ id: 12, position: 2048, is_done: true },
			],
		});

		const result = await applyBoardCardStatusChange(trx, {
			workspaceId: 7,
			actor,
			cardId: 50,
			targetStatusId: 103,
		});

		expect(result).toEqual({ kind: "unmappable" });
	});

	it("updates status without moving for canceled slot", async () => {
		const { trx, updateCalls } = makeTrx({
			card: {
				id: 50,
				column_id: 11,
				title: "Test card",
				version: 1,
				started_at: null,
				done_at: null,
			},
			targetStatusId: 105,
			targetStatusSlot: "canceled",
			siblingColumns: [
				{ id: 11, position: 1024, is_done: false },
				{ id: 12, position: 2048, is_done: false },
				{ id: 15, position: 5120, is_done: true },
			],
		});

		const result = await applyBoardCardStatusChange(trx, {
			workspaceId: 7,
			actor,
			cardId: 50,
			targetStatusId: 105,
		});

		expect(result).toEqual({
			kind: "ok",
			moved: false,
			cardTitle: "Test card",
		});
		expect(updateCalls).toHaveLength(1);
		expect(mockRecordActivity).toHaveBeenCalledWith(
			trx,
			actor,
			7,
			"update",
			expect.objectContaining({ cardId: 50 }),
		);
	});

	it("returns wip when the destination column is full", async () => {
		const { trx } = makeTrx({
			card: {
				id: 50,
				column_id: 11,
				title: "Test card",
				version: 1,
				started_at: null,
				done_at: null,
			},
			targetStatusId: 104,
			targetStatusSlot: "done",
			siblingColumns: [
				{ id: 11, position: 1024, is_done: false },
				{ id: 12, position: 2048, is_done: false },
				{ id: 15, position: 5120, is_done: true },
			],
			targetColumn: {
				id: 15,
				wip_limit: 1,
				is_done: true,
				is_signable: false,
				signable_assignee_id: null,
				is_first: false,
			},
			siblingsInTarget: [{ id: 90, position: 1024 }],
		});

		const result = await applyBoardCardStatusChange(trx, {
			workspaceId: 7,
			actor,
			cardId: 50,
			targetStatusId: 104,
		});

		expect(result).toEqual({
			kind: "wip",
			reason: "wip_limit_reached",
		});
	});

	it("moves the card and records activity when status maps to another column", async () => {
		const { trx, updateCalls } = makeTrx({
			card: {
				id: 50,
				column_id: 11,
				title: "Test card",
				version: 1,
				started_at: null,
				done_at: null,
			},
			targetStatusId: 104,
			targetStatusSlot: "done",
			siblingColumns: [
				{ id: 11, position: 1024, is_done: false },
				{ id: 12, position: 2048, is_done: false },
				{ id: 15, position: 5120, is_done: true },
			],
			targetColumn: {
				id: 15,
				wip_limit: null,
				is_done: true,
				is_signable: true,
				signable_assignee_id: 42,
				is_first: false,
			},
			siblingsInTarget: [],
		});
		mockAddCardAssignee.mockResolvedValue(true);

		const result = await applyBoardCardStatusChange(trx, {
			workspaceId: 7,
			actor,
			cardId: 50,
			targetStatusId: 104,
		});

		expect(result).toEqual({
			kind: "ok",
			moved: true,
			cardTitle: "Test card",
			addedSignableAssignee: 42,
		});
		expect(updateCalls).toHaveLength(1);
		expect(mockAddCardAssignee).toHaveBeenCalledWith(trx, 50, 42);
		expect(mockRecordActivity).toHaveBeenCalledWith(
			trx,
			actor,
			7,
			"move",
			expect.objectContaining({
				cardId: 50,
				fromColumnId: 11,
				toColumnId: 15,
			}),
		);
	});
});
