// Integration tests for two cards.ts fixes:
//   1. POST /cards must enforce the WIP limit atomically — concurrent
//      creates targeting the same column must not all pass.
//   2. DELETE /cards/:id must make the soft-delete and the card_events
//      write atomic — a failure in recordActivity must roll back the delete.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npx vitest run src/routes/cards-mutations.integration.test.ts
import "dotenv/config";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { mockPublishEvent, mockTestUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn(),
	mockTestUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
	publishEvent: mockPublishEvent,
	clearPresence: vi.fn(),
	heartbeat: vi.fn(),
	onlineUsers: vi.fn().mockResolvedValue([]),
	sseHandler: vi.fn(),
	createRealtimeHub: vi.fn(),
	initRealtime: vi.fn(),
	workspaceEventChannel: vi.fn(),
	workspacePresenceKey: vi.fn(),
	workspacePresencePattern: vi.fn(),
}));

vi.mock("../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = mockTestUser;
			next();
		},
	};
});

import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";
import * as routeHelpers from "./helpers.js";

/** Isolated from routes.integration.test.ts (workspace 1) and
 * columns.batch.integration.test.ts (workspace 99). */
const WORKSPACE_ID = 97;

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createTestApp();
let backlogStatusId: number | undefined;

async function backlogStatusIdForWorkspace() {
	if (backlogStatusId !== undefined) return backlogStatusId;
	const row = await db
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", WORKSPACE_ID)
		.where("kind", "=", "status")
		.where("slot", "=", "backlog")
		.executeTakeFirstOrThrow();
	backlogStatusId = row.id;
	return backlogStatusId;
}

async function cleanup() {
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
}

async function setupFixtures() {
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
		[
			mockTestUser.id,
			mockTestUser.username,
			mockTestUser.displayName,
			"hashed",
		],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
     VALUES ($1, 'Cards Mutation Test WS', $2, false) ON CONFLICT (id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await db
		.deleteFrom("tracker_vocabularies")
		.where("workspace_id", "=", WORKSPACE_ID)
		.execute();
	await seedTrackerVocabulary(db, WORKSPACE_ID);
	backlogStatusId = undefined;
}

beforeEach(async () => {
	await cleanup();
	await setupFixtures();
	vi.clearAllMocks();
});

afterEach(async () => {
	await cleanup();
});

afterAll(async () => {
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"POST /api/workspaces/:wid/cards — WIP enforcement",
	() => {
		it("rejects concurrent creates beyond the WIP limit", async () => {
			const col = await pool.query(
				`INSERT INTO columns (title, position, wip_limit, is_done, workspace_id)
         VALUES ('Doing', 1000, 1, false, $1) RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;

			const results = await Promise.all(
				Array.from({ length: 8 }, () =>
					request(app)
						.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
						.send({ columnId: colId, title: "race card" }),
				),
			);
			const statuses = results.map((r) => r.status).sort();
			const created = statuses.filter((s) => s === 201).length;
			const rejected = statuses.filter((s) => s === 409).length;

			expect(created).toBe(1);
			expect(rejected).toBe(7);

			const rows = await pool.query(
				"SELECT count(*)::int AS n FROM cards WHERE column_id = $1 AND deleted_at IS NULL",
				[colId],
			);
			expect(rows.rows[0].n).toBe(1);
		});

		it("rejects a missing columnId with a clean 400, not a leaked DB error", async () => {
			const res = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ title: "no column" });

			expect(res.status).toBe(400);
			expect(res.body.error).toBe("columnId must be an integer");
		});

		it("rejects a non-integer columnId with a clean 400, not a leaked DB error", async () => {
			const res = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId: "not-a-number", title: "bad column" });

			expect(res.status).toBe(400);
			expect(res.body.error).toBe("columnId must be an integer");
		});
	},
);

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"DELETE /api/workspaces/:wid/cards/:id — atomicity",
	() => {
		it("soft-deletes and records activity together on success", async () => {
			const col = await pool.query(
				`INSERT INTO columns (title, position, wip_limit, is_done, workspace_id)
         VALUES ('Backlog', 1000, NULL, false, $1) RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;
			const statusId = await backlogStatusIdForWorkspace();
			const card = await pool.query(
				`INSERT INTO cards (title, column_id, position, workspace_id, status_id)
         VALUES ('to delete', $1, 1000, $2, $3) RETURNING id`,
				[colId, WORKSPACE_ID, statusId],
			);
			const cardId = card.rows[0].id;

			const res = await request(app).delete(
				`/api/workspaces/${WORKSPACE_ID}/cards/${cardId}`,
			);
			expect(res.status).toBe(204);

			const row = await pool.query(
				"SELECT deleted_at FROM cards WHERE id = $1",
				[cardId],
			);
			expect(row.rows[0].deleted_at).not.toBeNull();

			const events = await pool.query(
				"SELECT event_type FROM card_events WHERE workspace_id = $1 AND event_type = 'delete'",
				[WORKSPACE_ID],
			);
			expect(events.rows).toHaveLength(1);
		});

		it("rolls back the soft-delete when recordActivity fails (atomicity)", async () => {
			const col = await pool.query(
				`INSERT INTO columns (title, position, wip_limit, is_done, workspace_id)
         VALUES ('Backlog', 1000, NULL, false, $1) RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;
			const statusId = await backlogStatusIdForWorkspace();
			const card = await pool.query(
				`INSERT INTO cards (title, column_id, position, workspace_id, status_id)
         VALUES ('to delete', $1, 1000, $2, $3) RETURNING id`,
				[colId, WORKSPACE_ID, statusId],
			);
			const cardId = card.rows[0].id;

			const activitySpy = vi
				.spyOn(routeHelpers, "recordActivity")
				.mockRejectedValueOnce(new Error("simulated activity failure"));

			try {
				const res = await request(app).delete(
					`/api/workspaces/${WORKSPACE_ID}/cards/${cardId}`,
				);
				expect(res.status).toBeGreaterThanOrEqual(500);
			} finally {
				activitySpy.mockRestore();
			}

			const row = await pool.query(
				"SELECT deleted_at FROM cards WHERE id = $1",
				[cardId],
			);
			expect(row.rows[0].deleted_at).toBeNull();

			const events = await pool.query(
				"SELECT count(*)::int AS n FROM card_events WHERE workspace_id = $1",
				[WORKSPACE_ID],
			);
			expect(events.rows[0].n).toBe(0);
		});

		it("rejects a stale version with 409 instead of deleting", async () => {
			const col = await pool.query(
				`INSERT INTO columns (title, position, wip_limit, is_done, workspace_id)
         VALUES ('Backlog', 1000, NULL, false, $1) RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;
			const statusId = await backlogStatusIdForWorkspace();
			const card = await pool.query(
				`INSERT INTO cards (title, column_id, position, workspace_id, status_id)
         VALUES ('to delete', $1, 1000, $2, $3) RETURNING id`,
				[colId, WORKSPACE_ID, statusId],
			);
			const cardId = card.rows[0].id;

			const res = await request(app)
				.delete(`/api/workspaces/${WORKSPACE_ID}/cards/${cardId}`)
				.send({ version: 999 });

			expect(res.status).toBe(409);
			expect(res.body.code).toBe("version_conflict");

			const row = await pool.query(
				"SELECT deleted_at FROM cards WHERE id = $1",
				[cardId],
			);
			expect(row.rows[0].deleted_at).toBeNull();
		});

		it("deletes when the correct version is sent", async () => {
			const col = await pool.query(
				`INSERT INTO columns (title, position, wip_limit, is_done, workspace_id)
         VALUES ('Backlog', 1000, NULL, false, $1) RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;
			const statusId = await backlogStatusIdForWorkspace();
			const card = await pool.query(
				`INSERT INTO cards (title, column_id, position, workspace_id, status_id)
         VALUES ('to delete', $1, 1000, $2, $3) RETURNING id`,
				[colId, WORKSPACE_ID, statusId],
			);
			const cardId = card.rows[0].id;

			const res = await request(app)
				.delete(`/api/workspaces/${WORKSPACE_ID}/cards/${cardId}`)
				.send({ version: 1 });

			expect(res.status).toBe(204);

			const row = await pool.query(
				"SELECT deleted_at FROM cards WHERE id = $1",
				[cardId],
			);
			expect(row.rows[0].deleted_at).not.toBeNull();
		});
	},
);
