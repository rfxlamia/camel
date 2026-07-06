// Integration tests for PATCH /columns/:id fixes:
//   1. A validated title must be trimmed before being persisted, not the
//      raw whitespace-padded input.
//   2. An empty patch payload (no recognized fields) must be rejected with
//      a clean 400 instead of reaching an empty .set({}) update.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npx vitest run src/routes/columns.patch.integration.test.ts
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
import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";
import { COLUMN_COLOR_VALIDATION_ERROR } from "../validators/column.js";

/** Isolated from routes.integration.test.ts (workspace 1),
 * columns.batch.integration.test.ts (workspace 99), and
 * cards-mutations.integration.test.ts (workspace 97). */
const WORKSPACE_ID = 96;

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createTestApp();

async function cleanup() {
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
     VALUES ($1, 'Columns Patch Test WS', $2, false) ON CONFLICT (id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
}

beforeEach(async () => {
	await setupFixtures();
	await cleanup();
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
	"PATCH /api/workspaces/:wid/columns/:id",
	() => {
		it("trims a whitespace-padded title before persisting it", async () => {
			const col = await pool.query(
				`INSERT INTO columns (title, position, workspace_id)
       VALUES ('Backlog', 1000, $1) RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${colId}`)
				.send({ title: "  Padded Title  " });

			expect(res.status).toBe(200);
			expect(res.body.title).toBe("Padded Title");

			const row = await pool.query("SELECT title FROM columns WHERE id = $1", [
				colId,
			]);
			expect(row.rows[0].title).toBe("Padded Title");
		});

		it("rejects an empty patch payload with 400 instead of an empty SET", async () => {
			const col = await pool.query(
				`INSERT INTO columns (title, position, workspace_id)
       VALUES ('Backlog', 1000, $1) RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${colId}`)
				.send({});

			expect(res.status).toBe(400);

			const row = await pool.query("SELECT title FROM columns WHERE id = $1", [
				colId,
			]);
			expect(row.rows[0].title).toBe("Backlog");
		});

		it("persists a well-formed OKLCH color", async () => {
			const oklch = "oklch(88% 0.09 47.3)";
			const col = await pool.query(
				`INSERT INTO columns (title, position, workspace_id)
       VALUES ('Backlog', 1000, $1) RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${colId}`)
				.send({ color: oklch });

			expect(res.status).toBe(200);
			expect(res.body.color).toBe(oklch);

			const row = await pool.query("SELECT color FROM columns WHERE id = $1", [
				colId,
			]);
			expect(row.rows[0].color).toBe(oklch);
		});

		it("rejects an invalid color with COLUMN_COLOR_VALIDATION_ERROR", async () => {
			const col = await pool.query(
				`INSERT INTO columns (title, position, workspace_id, color)
       VALUES ('Backlog', 1000, $1, 'powder-blue') RETURNING id`,
				[WORKSPACE_ID],
			);
			const colId = col.rows[0].id;

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${colId}`)
				.send({ color: "not-a-color" });

			expect(res.status).toBe(400);
			expect(res.body.error).toBe(COLUMN_COLOR_VALIDATION_ERROR);

			const row = await pool.query("SELECT color FROM columns WHERE id = $1", [
				colId,
			]);
			expect(row.rows[0].color).toBe("powder-blue");
		});
	},
);
