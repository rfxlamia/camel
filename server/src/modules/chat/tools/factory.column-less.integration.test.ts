// Integration describe requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/chat/tools/factory.column-less.integration.test.ts
//
// Rule: only rows with a non-NULL cards.column_id are board cards. Tracker-native
// (column-less) rows must never leak into this reader.
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../../db/pool.js";
import { createChatToolFactory } from "./factory.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);
const WORKSPACE_ID = 3103;
const USER_ID = 31030;

function makeTool() {
	return createChatToolFactory({
		userId: USER_ID,
		threadId: 1,
		messageId: 1,
		workspaceId: WORKSPACE_ID,
		insertAttachment: async () => {},
	}).resolveTools(["query_board_data"])[0]!;
}

type Seed = { boardIds: number[]; columnLessIds: number[]; statusId: number };

async function cleanup() {
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM users WHERE id = $1", [USER_ID]);
}

async function insertCard(
	statusId: number,
	columnId: number | null,
	key: number,
	timing: { created: string; started?: string; done?: string },
	deletedAt: string | null = null,
) {
	const { rows } = await pool.query<{ id: number }>(
		`INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number, created_at, started_at, done_at, deleted_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now() - $7::interval, now() - $8::interval, now() - $9::interval, $10)
		 RETURNING id`,
		[
			WORKSPACE_ID,
			columnId,
			`Card ${key}`,
			key * 1024,
			statusId,
			key,
			timing.created,
			timing.started ?? null,
			timing.done ?? null,
			deletedAt,
		],
	);
	return rows[0]!.id;
}

// 2 board cards (one done, one in progress) + 3 column-less cards
// (two done, one in progress) that would inflate throughput/WIP if counted.
async function seed(): Promise<Seed> {
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 'cl-chat', 'cl-chat', 'test')",
		[USER_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'cl-chat WS', $2, false)",
		[WORKSPACE_ID, USER_ID],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[WORKSPACE_ID, USER_ID],
	);
	const cols = await pool.query<{ id: number }>(
		"INSERT INTO columns (workspace_id, title, position, is_done) VALUES ($1, 'Todo', 1024, false), ($1, 'Done', 2048, true) RETURNING id",
		[WORKSPACE_ID],
	);
	const [todoCol, doneCol] = cols.rows.map((r) => r.id) as [number, number];
	const status = await pool.query<{ id: number }>(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, category, slot) VALUES ($1, 'status', 'Todo', 1024, 'blue', 'backlog', 'todo') RETURNING id",
		[WORKSPACE_ID],
	);
	const s = status.rows[0]!.id;
	const boardIds = [
		await insertCard(s, todoCol, 1, { created: "3 days", started: "2 days" }),
		await insertCard(s, doneCol, 2, {
			created: "5 days",
			started: "4 days",
			done: "1 day",
		}),
	];
	const columnLessIds = [
		await insertCard(s, null, 3, {
			created: "6 days",
			started: "5 days",
			done: "2 days",
		}),
		await insertCard(s, null, 4, {
			created: "7 days",
			started: "6 days",
			done: "3 days",
		}),
		await insertCard(s, null, 5, { created: "2 days", started: "1 day" }),
	];
	return { boardIds, columnLessIds, statusId: s };
}

describe.skipIf(!runIntegration)("chat column-less scope (integration)", () => {
	let fixture: Seed;

	beforeEach(async () => {
		await cleanup();
		fixture = await seed();
	});

	afterAll(async () => {
		await cleanup();
		await pool.end();
	});

	it("chat query_board_data excludes column-less cards", async () => {
		const tool = makeTool();
		const result = await tool.execute({ data_types: ["metrics"] });
		expect(result.ok).toBe(true);
		const payload = JSON.parse(result.content);
		// Board only: 1 done, 1 in progress. Column-less would give 3 / 2.
		expect(payload.metrics.throughput).toBe(1);
		expect(payload.metrics.wipCount).toBe(1);
	});

	// Regression guard: every reader already carries deleted_at IS NULL, and
	// column_id IS NOT NULL independently excludes column-less rows, so the two
	// predicates overlap. Only the soft-deleted column-less row remains here, so
	// this fails only if a reader lacks both predicates.
	it("regression guard: soft-deleted column-less item appears nowhere", async () => {
		await pool.query("DELETE FROM cards WHERE id = ANY($1::int[])", [
			fixture.columnLessIds,
		]);
		await insertCard(
			fixture.statusId,
			null,
			6,
			{ created: "9 days", started: "8 days", done: "4 days" },
			new Date().toISOString(),
		);

		const chat = JSON.parse(
			(await makeTool().execute({ data_types: ["metrics"] })).content,
		);
		expect(chat.metrics.throughput).toBe(1);
		expect(chat.metrics.wipCount).toBe(1);
	});
});
