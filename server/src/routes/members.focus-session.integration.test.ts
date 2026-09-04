// Integration tests: membership removal finalizes active focus sessions atomically.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/members.focus-session.integration.test.ts
import "dotenv/config";
import express from "express";
import request from "supertest";
import {
	afterAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { AuthUser } from "../auth.js";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import {
	createDefaultWorkspaceAccessDeps,
	createWorkspaceAccessService,
} from "./helpers.js";

const WORKSPACE_ID = 3;
const MEMBER_USER_ID = 7;
const ADMIN_USER_ID = 2;
const T0 = new Date("2026-09-04T10:00:00.000Z");
const FIXED_NOW = new Date(T0.getTime() + 120_000);

const { mockPublishEvent } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn(async () => undefined),
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
	publishEvent: mockPublishEvent,
	clearPresence: vi.fn(async () => undefined),
	heartbeat: vi.fn(),
	onlineUsers: vi.fn().mockResolvedValue([]),
	sseHandler: vi.fn(),
	createRealtimeHub: vi.fn(),
	initRealtime: vi.fn(),
	workspaceEventChannel: vi.fn(),
	workspacePresenceKey: vi.fn(),
	workspacePresencePattern: vi.fn(),
}));

vi.mock("./helpers.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./helpers.js")>();
	const deps = actual.createDefaultWorkspaceAccessDeps({
		now: () => FIXED_NOW,
	});
	return {
		...actual,
		workspaceAccessService: actual.createWorkspaceAccessService({
			...deps,
			publishEvent: mockPublishEvent,
		}),
	};
});

import { membersRouter } from "./members.js";

const ADMIN_ACTOR: AuthUser = {
	id: ADMIN_USER_ID,
	username: "t14-admin",
	displayName: "T14 Admin",
	email: null,
	emailVerified: true,
	needsUsername: false,
};

let currentUser: AuthUser = ADMIN_ACTOR;

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = currentUser;
		next();
	});
	app.use("/workspaces/:workspaceId", membersRouter);
	return app;
}

const app = createApp();

async function idFor(sql: string, values: unknown[]): Promise<number> {
	return (await pool.query<{ id: number }>(sql, values)).rows[0]!.id;
}

async function cleanup(): Promise<void> {
	await pool.query(
		"DELETE FROM focus_sessions WHERE workspace_id = $1",
		[WORKSPACE_ID],
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
	await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [
		[ADMIN_USER_ID, MEMBER_USER_ID],
	]);
}

async function setupFixtures(): Promise<{ sessionId: number }> {
	await cleanup();
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES ($1, 't14-admin', 'T14 Admin', 'test'),
            ($2, 't14-member', 'T14 Member', 'test')
     ON CONFLICT (id) DO NOTHING`,
		[ADMIN_USER_ID, MEMBER_USER_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T14 Focus WS', $2, false)",
		[WORKSPACE_ID, ADMIN_USER_ID],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'admin'), ($1, $3, 'member')`,
		[WORKSPACE_ID, ADMIN_USER_ID, MEMBER_USER_ID],
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
	const cardId = await idFor(
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number) VALUES ($1, $2, 'Focus task', 1024, $3, 42) RETURNING id",
		[WORKSPACE_ID, columnId, statusId],
	);
	const sessionId = await idFor(
		`INSERT INTO focus_sessions (
      user_id, workspace_id, task_source, task_id, task_key, return_path,
      state, accumulated_seconds, running_since, version
    ) VALUES ($1, $2, 'board', $3, 'T14-42', '/board/card/$3', 'running', 300, $4, 4)
    RETURNING id`,
		[MEMBER_USER_ID, WORKSPACE_ID, cardId, T0],
	);
	return { sessionId };
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"membership removal focus session integration",
	() => {
		beforeEach(async () => {
			mockPublishEvent.mockClear();
			currentUser = ADMIN_ACTOR;
			await setupFixtures();
		});

		afterAll(async () => {
			await cleanup();
		});

		it("membership row is gone and focus session is finished atomically", async () => {
			const { sessionId } = await setupFixtures();

			const res = await request(app).delete(
				`/workspaces/${WORKSPACE_ID}/members/${MEMBER_USER_ID}`,
			);
			expect(res.status).toBe(204);

			const membership = await pool.query(
				"SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
				[WORKSPACE_ID, MEMBER_USER_ID],
			);
			expect(membership.rowCount).toBe(0);

			const focusRow = await pool.query<{
				state: string;
				accumulated_seconds: number;
				running_since: Date | null;
				finished_at: Date | null;
			}>(
				"SELECT state, accumulated_seconds, running_since, finished_at FROM focus_sessions WHERE id = $1",
				[sessionId],
			);
			expect(focusRow.rows[0]).toMatchObject({
				state: "finished",
				accumulated_seconds: 420,
				running_since: null,
			});
			expect(focusRow.rows[0]!.finished_at).not.toBeNull();

			const auditRows = await pool.query<{
				card_id: number | null;
				event_type: string;
				actor_id: number;
				payload: string;
			}>(
				`SELECT card_id, event_type, actor_id, payload::text AS payload
         FROM card_events
         WHERE workspace_id = $1 AND event_type = 'focus_session'`,
				[WORKSPACE_ID],
			);
			expect(auditRows.rowCount).toBe(1);
			expect(auditRows.rows[0]).toMatchObject({
				card_id: null,
				event_type: "focus_session",
				actor_id: ADMIN_USER_ID,
			});
			expect(JSON.parse(auditRows.rows[0]!.payload)).toMatchObject({
				kind: "focus_session",
				action: "membership_removed",
				sessionId,
				workspaceId: WORKSPACE_ID,
				userId: MEMBER_USER_ID,
			});

			expect(mockPublishEvent).toHaveBeenCalledTimes(2);
			expect(mockPublishEvent.mock.calls[0]![1]).toMatchObject({
				type: "focus_session.updated",
				userId: MEMBER_USER_ID,
				workspaceId: WORKSPACE_ID,
				payload: { session: null },
			});
			expect(mockPublishEvent.mock.calls[1]![1]).toMatchObject({
				type: "membership.removed",
				userId: MEMBER_USER_ID,
				workspaceId: WORKSPACE_ID,
			});
		});

		it("roll back both membership deletion and focus finalization on failure", async () => {
			const { sessionId } = await setupFixtures();
			const publishSpy = vi.fn(async () => undefined);
			const service = createWorkspaceAccessService({
				...createDefaultWorkspaceAccessDeps({
					now: () => FIXED_NOW,
					failAfterFocusFinalize: () => {
						throw new Error("injected post-finalize failure");
					},
				}),
				publishEvent: publishSpy,
			});

			await expect(
				service.removeMember({
					actorId: ADMIN_USER_ID,
					actor: ADMIN_ACTOR,
					workspaceId: WORKSPACE_ID,
					userId: MEMBER_USER_ID,
				}),
			).rejects.toThrow("injected post-finalize failure");

			const membership = await pool.query(
				"SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
				[WORKSPACE_ID, MEMBER_USER_ID],
			);
			expect(membership.rowCount).toBe(1);

			const focusRow = await pool.query<{
				state: string;
				accumulated_seconds: number;
			}>(
				"SELECT state, accumulated_seconds FROM focus_sessions WHERE id = $1",
				[sessionId],
			);
			expect(focusRow.rows[0]).toMatchObject({
				state: "running",
				accumulated_seconds: 300,
			});

			expect(publishSpy).not.toHaveBeenCalled();
		});
	},
);
