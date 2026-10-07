// server/src/modules/tracker/tracker-writes.merged.integration.test.ts
// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/tracker/tracker-writes.merged.integration.test.ts
// Tracker item writes land on `cards` rows with NULL column_id (single-table merge, T10).
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCurrentUser } = vi.hoisted(() => ({
	mockCurrentUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../../realtime.js", () => ({
	publishEvent: vi.fn().mockResolvedValue(undefined),
	clearPresence: vi.fn().mockResolvedValue(undefined),
	heartbeat: vi.fn(),
	onlineUsers: vi.fn().mockResolvedValue([]),
	sseHandler: vi.fn(),
	createRealtimeHub: vi.fn(),
	initRealtime: vi.fn(),
	workspaceEventChannel: vi.fn(),
	workspacePresenceKey: vi.fn(),
	workspacePresencePattern: vi.fn(),
}));

vi.mock("../../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = mockCurrentUser;
			next();
		},
	};
});

import { pool } from "../../db/pool.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { api } from "../../routes.js";

const WORKSPACE_ID = 7101; // Isolated from every other integration test.
const BASE = `/api/workspaces/${WORKSPACE_ID}`;

const VOCAB = [
	["status", "Backlog", 1024, "backlog", "backlog"],
	["status", "Todo", 2048, "backlog", "todo"],
	["status", "In Progress", 3072, "started", "in_progress"],
	["status", "Done", 4096, "completed", "done"],
	["status", "Canceled", 5120, "canceled", "canceled"],
	["label", "Feature", 1024, null, null],
	["label", "Bug", 2048, null, null],
] as const;

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createTestApp();

async function cleanupWorkspace() {
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query(
		"UPDATE workspaces SET tracker_key_counter = 0, name = 'Camel' WHERE id = $1",
		[WORKSPACE_ID],
	);
}

async function setupFixtures() {
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
		 VALUES ($1, $2, $3, 'hashed') ON CONFLICT (id) DO NOTHING`,
		[mockCurrentUser.id, mockCurrentUser.username, mockCurrentUser.displayName],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
		 VALUES ($1, 'Camel', $2, false) ON CONFLICT (id) DO NOTHING`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
		 VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	for (const [kind, name, position, category, slot] of VOCAB) {
		await pool.query(
			`INSERT INTO tracker_vocabularies
			   (workspace_id, kind, name, position, colour, category, slot)
			 SELECT $1, $2, $3, $4, 'oklch(0.89 0.07 250)', $5, $6
			 WHERE NOT EXISTS (
			   SELECT 1 FROM tracker_vocabularies
			   WHERE workspace_id = $1 AND kind = $2 AND lower(name) = lower($3)
			 )`,
			[WORKSPACE_ID, kind, name, position, category, slot],
		);
	}
}

async function cardRows() {
	const { rows } = await pool.query(
		"SELECT * FROM cards WHERE workspace_id = $1 ORDER BY id",
		[WORKSPACE_ID],
	);
	return rows;
}

async function eventTypes(cardId: number): Promise<string[]> {
	const { rows } = await pool.query(
		"SELECT event_type FROM card_events WHERE card_id = $1 ORDER BY id",
		[cardId],
	);
	return rows.map((r) => r.event_type);
}

async function count(table: string): Promise<number> {
	const { rows } = await pool.query(
		`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`,
		[WORKSPACE_ID],
	);
	return rows[0].n;
}

beforeEach(async () => {
	await setupFixtures();
	await cleanupWorkspace();
});

afterAll(async () => {
	await cleanupWorkspace();
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"tracker writes on the merged table",
	() => {
		it("creates and updates an item as a column-less cards row", async () => {
			const first = await request(app)
				.post(`${BASE}/tracker/items`)
				.send({ title: "First" });
			expect(first.status).toBe(201);
			const second = await request(app)
				.post(`${BASE}/work-items`)
				.send({ title: "Second" });
			expect(second.status).toBe(201);
			expect(first.body.key).toBe("CA-1");
			expect(second.body.key).toBe("CA-2");

			const rows = await cardRows();
			expect(rows.map((r) => r.key_number)).toEqual([1, 2]);
			for (const row of rows) {
				expect(row.column_id).toBeNull();
				expect(row.plan_position).not.toBeNull();
				expect(row.position).toBe(0);
				expect(row.version).toBe(1);
				expect(row.updated_at).not.toBeNull();
			}
			expect(await count("tracker_items")).toBe(0);
			expect(await count("tracker_events")).toBe(0);
			expect(await eventTypes(first.body.id)).toEqual(["tracker_item_created"]);

			const patched = await request(app)
				.patch(`${BASE}/tracker/items/CA-1`)
				.send({ title: "First v2", version: 1 });
			expect(patched.status).toBe(200);
			expect(patched.body.title).toBe("First v2");
			expect(patched.body.version).toBe(2);
			expect((await cardRows())[0]).toMatchObject({
				title: "First v2",
				version: 2,
				column_id: null,
			});
			expect(await eventTypes(first.body.id)).toEqual([
				"tracker_item_created",
				"tracker_item_updated",
			]);

			const stale = await request(app)
				.patch(`${BASE}/tracker/items/CA-1`)
				.send({ title: "Stale", version: 1 });
			expect(stale.status).toBe(409);
			expect(stale.body.code).toBe("version_conflict");
			expect((await cardRows())[0]).toMatchObject({
				title: "First v2",
				version: 2,
			});
			expect(await eventTypes(first.body.id)).toHaveLength(2);
			expect(await count("tracker_items")).toBe(0);
			expect(await count("tracker_events")).toBe(0);
		});
	},
);
