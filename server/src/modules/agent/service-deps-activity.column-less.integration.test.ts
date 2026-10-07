// Integration describe requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/agent/service-deps-activity.column-less.integration.test.ts
//
// Rule: only rows with a non-NULL cards.column_id are board cards. Tracker-native
// (column-less) rows must never leak into this reader.
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../db/pool.js";
import { activityDeps } from "./service-deps-activity.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);
const WORKSPACE_ID = 3102;
const USER_ID = 31020;

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
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 'cl-agent', 'cl-agent', 'test')",
		[USER_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'cl-agent WS', $2, false)",
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

describe.skipIf(!runIntegration)(
	"agent column-less scope (integration)",
	() => {
		let fixture: Seed;

		beforeEach(async () => {
			await cleanup();
			fixture = await seed();
		});

		afterAll(async () => {
			await cleanup();
			await pool.end();
		});

		it("agent timestamps reader excludes column-less cards", async () => {
			const agentRows = await activityDeps.fetchCardTimestamps(WORKSPACE_ID);
			expect(agentRows).toHaveLength(fixture.boardIds.length);
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

			expect(await activityDeps.fetchCardTimestamps(WORKSPACE_ID)).toHaveLength(
				fixture.boardIds.length,
			);
		});
	},
);
