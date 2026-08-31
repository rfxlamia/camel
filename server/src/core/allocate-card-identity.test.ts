import { describe, expect, it } from "vitest";
import { allocateCardIdentity } from "./allocate-card-identity.js";
import { mapColumnSlots } from "./column-status-map.js";

interface FakeQuery {
	where(...args: unknown[]): FakeQuery;
	whereRef(...args: unknown[]): FakeQuery;
	set(...args: unknown[]): FakeQuery;
	returning(...args: unknown[]): FakeQuery;
	select(...args: unknown[]): FakeQuery;
	orderBy(...args: unknown[]): FakeQuery;
	executeTakeFirstOrThrow(): Promise<unknown>;
	execute(): Promise<unknown[]>;
}

function fakeTransaction(data: {
	counter: number;
	target: { board_id: number | null };
	columns: Array<{
		id: number;
		position: number;
		is_done: boolean;
		board_id: number | null;
	}>;
	statuses: Array<{ id: number; kind: string; slot: string | null }>;
}) {
	return {
		updateTable(table: string): FakeQuery {
			if (table !== "workspaces") throw new Error(`unexpected table ${table}`);
			return {
				where: () => this.updateTable(table),
				whereRef: () => this.updateTable(table),
				set: () => this.updateTable(table),
				returning: () => this.updateTable(table),
				select: () => this.updateTable(table),
				orderBy: () => this.updateTable(table),
				executeTakeFirstOrThrow: async () => ({
					tracker_key_counter: ++data.counter,
				}),
			};
		},
		selectFrom(table: string): FakeQuery {
			if (table !== "columns" && table !== "tracker_vocabularies") {
				throw new Error(`unexpected table ${table}`);
			}
			let rows: unknown[] = table === "columns" ? data.columns : data.statuses;
			const query: FakeQuery = {
				where: (...args) => {
					if (table === "columns" && typeof args[0] !== "string") {
						rows = rows.filter(
							(row) =>
								(row as { board_id: number | null }).board_id ===
								(data.target.board_id ?? null),
						);
					}
					if (table === "tracker_vocabularies" && args[0] === "slot") {
						rows = rows.filter(
							(row) => (row as { slot: string | null }).slot === args[2],
						);
					}
					return query;
				},
				whereRef: () => query,
				set: () => query,
				returning: () => query,
				select: (...args) => {
					if (table === "columns" && args[0] === "board_id") {
						rows = [data.target];
					}
					return query;
				},
				orderBy: () => query,
				executeTakeFirstOrThrow: async () => rows[0],
				execute: async () => rows,
			};
			return query;
		},
	} as never;
}

describe("allocateCardIdentity", () => {
	it("returns the atomically incremented counter and mapped status id", async () => {
		const tx = fakeTransaction({
			counter: 41,
			target: { board_id: null },
			columns: [
				{ id: 1, position: 1, is_done: false, board_id: null },
				{ id: 2, position: 2, is_done: false, board_id: null },
			],
			statuses: [
				{ id: 10, kind: "status", slot: "backlog" },
				{ id: 11, kind: "status", slot: "todo" },
			],
		});
		expect(
			await allocateCardIdentity(tx, { workspaceId: 7, columnId: 1 }),
		).toEqual({
			keyNumber: 42,
			statusId: 10,
		});
	});

	it("maps In Review geometry to in_progress", async () => {
		const columns = [
			{ id: 1, position: 1, is_done: false, board_id: null },
			{ id: 2, position: 2, is_done: false, board_id: null },
			{ id: 3, position: 3, is_done: false, board_id: null },
		];
		expect(mapColumnSlots(columns).get(3)).toBe("in_progress");
		const tx = fakeTransaction({
			counter: 0,
			target: { board_id: null },
			columns,
			statuses: [{ id: 30, kind: "status", slot: "in_progress" }],
		});
		expect(
			await allocateCardIdentity(tx, { workspaceId: 7, columnId: 3 }),
		).toEqual({
			keyNumber: 1,
			statusId: 30,
		});
	});

	it("gives is_done precedence over column position", async () => {
		const tx = fakeTransaction({
			counter: 0,
			target: { board_id: null },
			columns: [
				{ id: 1, position: 1, is_done: true, board_id: null },
				{ id: 2, position: 2, is_done: false, board_id: null },
			],
			statuses: [{ id: 40, kind: "status", slot: "done" }],
		});
		expect(
			await allocateCardIdentity(tx, { workspaceId: 7, columnId: 1 }),
		).toEqual({
			keyNumber: 1,
			statusId: 40,
		});
	});

	it("isolates sibling columns to the destination board", async () => {
		const tx = fakeTransaction({
			counter: 0,
			target: { board_id: 9 },
			columns: [
				{ id: 1, position: 1, is_done: false, board_id: 9 },
				{ id: 2, position: 2, is_done: true, board_id: 123 },
			],
			statuses: [{ id: 50, kind: "status", slot: "backlog" }],
		});
		// The imported mapper is intentionally used for the geometry contract;
		// the fake transaction supplies only the destination board's siblings.
		expect(
			await allocateCardIdentity(tx, { workspaceId: 7, columnId: 1 }),
		).toEqual({
			keyNumber: 1,
			statusId: 50,
		});
	});
});
