// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/column-less-guards.integration.test.ts
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../auth.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { createFocusSessionRepo } from "../modules/focus/index.js";
import { applyBoardCardStatusChange } from "./board-card-status-change.js";
import { createMyWorkMarkDoneService } from "./my-work-mark-done.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);
const WORKSPACE_ID = 5001;
const USER_ID = 50010;
const KEY_COLUMN_LESS = 501;
const KEY_BOARD = 502;

const actor: AuthUser = {
	id: USER_ID,
	username: "column-less-guard",
	displayName: "Column Less Guard",
	email: null,
	emailVerified: false,
	needsUsername: false,
};

type Fixture = {
	todoStatusId: number;
	doneStatusId: number;
	todoColumnId: number;
	doneColumnId: number;
	columnLessCardId: number;
	boardCardId: number;
};

async function cleanup() {
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM users WHERE id = $1", [USER_ID]);
}

async function seed(): Promise<Fixture> {
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 'column-less-guard', 'Column Less Guard', 'test')",
		[USER_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'Column Less Guard', $2, false)",
		[WORKSPACE_ID, USER_ID],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[WORKSPACE_ID, USER_ID],
	);
	await pool.query(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, category, slot) VALUES ($1, 'status', 'Todo', 1024, 'blue', 'backlog', 'todo'), ($1, 'status', 'Done', 2048, 'green', 'completed', 'done') ON CONFLICT DO NOTHING",
		[WORKSPACE_ID],
	);
	const statuses = await pool.query<{ id: number; slot: string }>(
		"SELECT id, slot FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status' AND slot IN ('todo', 'done')",
		[WORKSPACE_ID],
	);
	const statusId = (slot: string) =>
		statuses.rows.find((row) => row.slot === slot)!.id;
	const columns = await pool.query<{ id: number; is_done: boolean }>(
		"INSERT INTO columns (workspace_id, title, position, is_done) VALUES ($1, 'Todo', 1024, false), ($1, 'Done', 2048, true) RETURNING id, is_done",
		[WORKSPACE_ID],
	);
	const todoColumnId = columns.rows.find((row) => !row.is_done)!.id;
	const doneColumnId = columns.rows.find((row) => row.is_done)!.id;
	const todoStatusId = statusId("todo");
	const cards = await pool.query<{ id: number; key_number: number }>(
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number) VALUES ($1, NULL, 'Column-less', 1024, $2, $3), ($1, $4, 'On board', 1024, $2, $5) RETURNING id, key_number",
		[WORKSPACE_ID, todoStatusId, KEY_COLUMN_LESS, todoColumnId, KEY_BOARD],
	);
	const columnLessCardId = cards.rows.find(
		(row) => row.key_number === KEY_COLUMN_LESS,
	)!.id;
	const boardCardId = cards.rows.find(
		(row) => row.key_number === KEY_BOARD,
	)!.id;
	await pool.query(
		"INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $3), ($2, $3)",
		[columnLessCardId, boardCardId, USER_ID],
	);
	return {
		todoStatusId,
		doneStatusId: statusId("done"),
		todoColumnId,
		doneColumnId,
		columnLessCardId,
		boardCardId,
	};
}

const readCard = async (cardId: number) =>
	(
		await pool.query(
			"SELECT column_id, status_id, version, position, started_at, done_at FROM cards WHERE id = $1",
			[cardId],
		)
	).rows[0];

const eventCount = async (cardId: number) =>
	Number(
		(
			await pool.query<{ n: string }>(
				"SELECT count(*) AS n FROM card_events WHERE card_id = $1",
				[cardId],
			)
		).rows[0]!.n,
	);

describe.skipIf(!runIntegration)("column-less guards (integration)", () => {
	let fx: Fixture;

	beforeEach(async () => {
		await cleanup();
		fx = await seed();
	});

	afterAll(async () => {
		await cleanup();
		await pool.end();
	});

	describe("column-less items are board-missing", () => {
		it("status-change returns not_found and writes nothing", async () => {
			const before = await readCard(fx.columnLessCardId);
			const result = await db.transaction().execute((trx) =>
				applyBoardCardStatusChange(trx, {
					workspaceId: WORKSPACE_ID,
					actor,
					cardId: fx.columnLessCardId,
					targetStatusId: fx.doneStatusId,
				}),
			);
			expect(result).toEqual({ kind: "not_found" });
			expect(await readCard(fx.columnLessCardId)).toEqual(before);
			expect(await eventCount(fx.columnLessCardId)).toBe(0);
		});

		it("my-work mark-done (board branch) returns not_found and writes nothing", async () => {
			const before = await readCard(fx.columnLessCardId);
			const result = await createMyWorkMarkDoneService().markDone({
				userId: USER_ID,
				actor,
				workspaceId: WORKSPACE_ID,
				source: "board",
				keyNumber: KEY_COLUMN_LESS,
			});
			expect(result).toEqual({ kind: "not_found" });
			expect(await readCard(fx.columnLessCardId)).toEqual(before);
			expect(await eventCount(fx.columnLessCardId)).toBe(0);
		});

		it("focus findTask(board) returns null", async () => {
			const task = await createFocusSessionRepo().findTask(
				"board",
				fx.columnLessCardId,
				WORKSPACE_ID,
			);
			expect(task).toBeNull();
		});
	});

	describe("board cards keep their behavior", () => {
		it("status-change moves the card to the done column and logs the move", async () => {
			const result = await db.transaction().execute((trx) =>
				applyBoardCardStatusChange(trx, {
					workspaceId: WORKSPACE_ID,
					actor,
					cardId: fx.boardCardId,
					targetStatusId: fx.doneStatusId,
				}),
			);
			expect(result).toEqual({
				kind: "ok",
				moved: true,
				cardTitle: "On board",
				addedSignableAssignee: undefined,
			});
			const card = await readCard(fx.boardCardId);
			expect(card.column_id).toBe(fx.doneColumnId);
			expect(card.status_id).toBe(fx.doneStatusId);
			expect(card.version).toBe(2);
			expect(await eventCount(fx.boardCardId)).toBe(1);
		});

		it("my-work mark-done (board branch) completes the card", async () => {
			const result = await createMyWorkMarkDoneService().markDone({
				userId: USER_ID,
				actor,
				workspaceId: WORKSPACE_ID,
				source: "board",
				keyNumber: KEY_BOARD,
			});
			expect(result).toEqual({
				kind: "ok",
				source: "board",
				itemId: fx.boardCardId,
				itemTitle: "On board",
				changed: true,
				moved: true,
				addedSignableAssignee: undefined,
			});
			expect((await readCard(fx.boardCardId)).column_id).toBe(fx.doneColumnId);
		});

		it("focus findTask(board) returns the task", async () => {
			const task = await createFocusSessionRepo().findTask(
				"board",
				fx.boardCardId,
				WORKSPACE_ID,
			);
			expect(task).toEqual({
				id: fx.boardCardId,
				keyNumber: KEY_BOARD,
				title: "On board",
				workspaceName: "Column Less Guard",
			});
		});
	});
});
