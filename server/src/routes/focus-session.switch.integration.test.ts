// Integration tests: atomic focus session switch via repo.switchSession.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/focus-session.switch.integration.test.ts
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import {
	createFocusSessionRepo,
	type FocusSessionInsertInput,
} from "./focus-session-repo.js";

const USER_ID = 7;
const WORKSPACE_ID = 3;
const T0 = new Date("2026-09-04T10:00:00.000Z");
const T1 = new Date("2026-09-04T11:00:00.000Z");

async function idFor(sql: string, values: unknown[]): Promise<number> {
	return (await pool.query<{ id: number }>(sql, values)).rows[0]!.id;
}

async function cleanup(): Promise<void> {
	await pool.query(
		"DELETE FROM focus_sessions WHERE user_id = $1 AND workspace_id = $2",
		[USER_ID, WORKSPACE_ID],
	);
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM users WHERE id = $1", [USER_ID]);
}

type Fixtures = {
	taskAId: number;
	taskBId: number;
	sessionAId: number;
};

async function setupFixtures(): Promise<Fixtures> {
	await cleanup();
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 't6-user', 'T6 User', 'test') ON CONFLICT (id) DO NOTHING",
		[USER_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T6 Switch WS', $2, false)",
		[WORKSPACE_ID, USER_ID],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[WORKSPACE_ID, USER_ID],
	);
	await seedTrackerVocabulary(db, WORKSPACE_ID);
	const statusId = await idFor(
		"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status' LIMIT 1",
		[WORKSPACE_ID],
	);
	const columnId = await idFor(
		"INSERT INTO columns (workspace_id, title, position) VALUES ($1, 'Todo', 1024) RETURNING id",
		[WORKSPACE_ID],
	);
	const taskAId = await idFor(
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number) VALUES ($1, $2, 'Task A', 1024, $3, 10) RETURNING id",
		[WORKSPACE_ID, columnId, statusId],
	);
	const taskBId = await idFor(
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number) VALUES ($1, $2, 'Task B', 2048, $3, 20) RETURNING id",
		[WORKSPACE_ID, columnId, statusId],
	);
	const sessionAId = await idFor(
		`INSERT INTO focus_sessions (
			user_id, workspace_id, task_source, task_id, task_key, return_path,
			state, accumulated_seconds, running_since, version
		) VALUES ($1, $2, 'board', $3, 'T6-10', '/board/card/$3', 'running', 360, $4, 1)
		RETURNING id`,
		[USER_ID, WORKSPACE_ID, taskAId, T0],
	);
	return { taskAId, taskBId, sessionAId };
}

function readyInputForB(
	taskBId: number,
): FocusSessionInsertInput {
	return {
		user_id: USER_ID,
		workspace_id: WORKSPACE_ID,
		task_source: "board",
		task_id: taskBId,
		task_key: "T6-20",
		return_path: `/board/card/${taskBId}`,
		state: "ready",
		accumulated_seconds: 0,
		running_since: null,
	};
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"focus session switch integration",
	() => {
		beforeEach(async () => {
			await setupFixtures();
		});

		afterAll(async () => {
			await cleanup();
		});

		it("exactly one active row remains on B after switch", async () => {
			const { taskAId, taskBId, sessionAId } = await setupFixtures();
			const repo = createFocusSessionRepo(db);

			const result = await repo.switchSession(
				{
					id: sessionAId,
					patch: {
						state: "finished",
						accumulated_seconds: 360,
						running_since: null,
						finished_at: T1,
					},
					expectedVersion: 1,
				},
				readyInputForB(taskBId),
			);

			expect(result).not.toBeNull();
			expect(result!.finished.state).toBe("finished");
			expect(result!.finished.accumulated_seconds).toBe(360);
			expect(result!.created.state).toBe("ready");
			expect(result!.created.task_id).toBe(taskBId);
			expect(result!.created.accumulated_seconds).toBe(0);

			const activeRows = await pool.query<{
				id: number;
				task_id: number;
				state: string;
				accumulated_seconds: number;
			}>(
				`SELECT id, task_id, state, accumulated_seconds
				 FROM focus_sessions
				 WHERE user_id = $1 AND workspace_id = $2 AND state <> 'finished'`,
				[USER_ID, WORKSPACE_ID],
			);
			expect(activeRows.rows).toHaveLength(1);
			expect(activeRows.rows[0]!.task_id).toBe(taskBId);
			expect(activeRows.rows[0]!.accumulated_seconds).toBe(0);

			const finishedA = await pool.query<{ state: string; accumulated_seconds: number }>(
				"SELECT state, accumulated_seconds FROM focus_sessions WHERE id = $1",
				[sessionAId],
			);
			expect(finishedA.rows[0]!.state).toBe("finished");
			expect(finishedA.rows[0]!.accumulated_seconds).toBe(360);
			expect(taskAId).toBeTruthy();
		});

		it("old session remains Running when replacement insert fails", async () => {
			const { taskBId, sessionAId } = await setupFixtures();
			const repo = createFocusSessionRepo(db);

			await expect(
				repo.switchSession(
					{
						id: sessionAId,
						patch: {
							state: "finished",
							accumulated_seconds: 360,
							running_since: null,
							finished_at: T1,
						},
						expectedVersion: 1,
					},
					{ ...readyInputForB(taskBId), id: sessionAId },
				),
			).rejects.toMatchObject({ code: "23505" });

			const sessionA = await pool.query<{
				state: string;
				version: number;
				accumulated_seconds: number;
			}>(
				"SELECT state, version, accumulated_seconds FROM focus_sessions WHERE id = $1",
				[sessionAId],
			);
			expect(sessionA.rows[0]!.state).toBe("running");
			expect(sessionA.rows[0]!.version).toBe(1);
			expect(sessionA.rows[0]!.accumulated_seconds).toBe(360);
		});

		it("stale expectedVersion returns null and A stays Running", async () => {
			const { taskBId, sessionAId } = await setupFixtures();
			const repo = createFocusSessionRepo(db);

			const result = await repo.switchSession(
				{
					id: sessionAId,
					patch: {
						state: "finished",
						accumulated_seconds: 360,
						running_since: null,
						finished_at: T1,
					},
					expectedVersion: 2,
				},
				readyInputForB(taskBId),
			);

			expect(result).toBeNull();

			const sessionA = await pool.query<{
				state: string;
				version: number;
				accumulated_seconds: number;
			}>(
				"SELECT state, version, accumulated_seconds FROM focus_sessions WHERE id = $1",
				[sessionAId],
			);
			expect(sessionA.rows[0]!.state).toBe("running");
			expect(sessionA.rows[0]!.version).toBe(1);
			expect(sessionA.rows[0]!.accumulated_seconds).toBe(360);

			const countB = await pool.query<{ count: string }>(
				"SELECT COUNT(*)::text AS count FROM focus_sessions WHERE task_id = $1",
				[taskBId],
			);
			expect(Number(countB.rows[0]!.count)).toBe(0);
		});
	},
);
