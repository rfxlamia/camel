/**
 * Integration tests for the card-move route handler.
 *
 * Covers: move success, WIP enforcement, optimistic locking (version conflict),
 * rebalance trigger, activity logging, same-column reorder, and edge cases.
 *
 * Requires a running PostgreSQL instance (via Docker or local).
 * Gated behind RUN_INTEGRATION=1 to skip in CI fast-path.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/routes.integration.test.ts
 */

import "dotenv/config";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — vi.hoisted() is required because vi.mock factories
// are hoisted to the top of the file and cannot reference later-declared vars.
// ---------------------------------------------------------------------------

const { mockPublishEvent, mockTestUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn(),
	mockTestUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

// Mock Redis to prevent connection attempts.
vi.mock("./db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

// Mock realtime to prevent Redis pub/sub and isolate publishEvent calls.
vi.mock("./realtime.js", () => ({
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

// Mock auth — replace requireAuth with a pass-through that injects a test user.
// This must happen at module level because `api.use(requireAuth)` runs on import.
vi.mock("./auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = mockTestUser;
			next();
		},
	};
});

// ---------------------------------------------------------------------------
// Now safe to import modules that depend on the mocked deps.
// ---------------------------------------------------------------------------
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "./db/pool.js";
import { api } from "./routes.js";

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------
function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const app = createTestApp();

/** Column IDs assigned during beforeEach setup. */
let col1Id: number;
let col2Id: number; // has wip_limit = 2

async function setupFixtures() {
	// User
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

	// Workspace
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
     VALUES (1, 'Test WS', $1, false) ON CONFLICT (id) DO NOTHING`,
		[mockTestUser.id],
	);

	// Membership
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES (1, $1, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[mockTestUser.id],
	);

	// Columns — reset sequence so IDs are predictable
	await pool.query("ALTER SEQUENCE columns_id_seq RESTART WITH 1");
	const colRes = await pool.query(
		`INSERT INTO columns (title, position, wip_limit, is_done, workspace_id)
     VALUES
       ('Backlog',   1000, NULL, false, 1),
       ('In Progress', 2000, 2,    false, 1),
       ('Done',      3000, NULL, true,  1)
     RETURNING id, title`,
	);
	const cols = colRes.rows;
	col1Id = cols.find((c) => c.title === "Backlog")!.id;
	col2Id = cols.find((c) => c.title === "In Progress")!.id;
}

async function insertCard(
	title: string,
	columnId: number,
	position: number,
	version = 1,
) {
	const res = await pool.query(
		`INSERT INTO cards (title, column_id, position, version, workspace_id)
     VALUES ($1, $2, $3, $4, 1)
     RETURNING id`,
		[title, columnId, position, version],
	);
	return res.rows[0].id as number;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
	await setupFixtures();
});

afterEach(async () => {
	// Clean per-test data but keep base fixtures
	await pool.query("DELETE FROM card_events");
	await pool.query("DELETE FROM cards");
	// Reset card sequence
	await pool.query("ALTER SEQUENCE cards_id_seq RESTART WITH 1");
	vi.clearAllMocks();
});

afterAll(async () => {
	await pool.query(
		"TRUNCATE users, workspaces, columns, cards, card_events CASCADE",
	);
	await pool.end();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe.skipIf(!process.env.RUN_INTEGRATION)(
	"POST /api/workspaces/:wid/cards/:id/move",
	() => {
		// ----- Success paths -----

		it("moves a card to another column with version check", async () => {
			const cardId = await insertCard("Card A", col1Id, 1000, 1);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0, version: 1 });

			expect(res.status).toBe(200);
			expect(res.body.column_id).toBe(col2Id);
			expect(res.body.version).toBe(2);
		});

		it("moves a card without version (skips optimistic locking)", async () => {
			const cardId = await insertCard("Card B", col1Id, 1000, 5);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0 });

			expect(res.status).toBe(200);
			expect(res.body.column_id).toBe(col2Id);
			// version still increments even without check
			expect(res.body.version).toBe(6);
		});

		// ----- WIP enforcement -----

		it("rejects move when WIP limit is reached (409)", async () => {
			// col2 has wip_limit = 2
			await insertCard("WIP-1", col2Id, 2000);
			await insertCard("WIP-2", col2Id, 2001);
			const cardId = await insertCard("Card C", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0 });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatch(/WIP limit/i);
			expect(res.body.reason).toBe("wip_limit_reached");
		});

		// ----- Optimistic locking -----

		it("rejects move with stale version (409)", async () => {
			const cardId = await insertCard("Card D", col1Id, 1000, 1);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0, version: 999 });

			expect(res.status).toBe(409);
			expect(res.body.code).toBe("version_conflict");
			expect(res.body.error).toMatch(/Someone else/i);
		});

		// ----- Rebalance -----

		it("triggers rebalance when positions are too close", async () => {
			// Insert 3 cards with positions closer than MIN_SPACING (1e-9)
			await insertCard("R-1", col1Id, 0);
			await insertCard("R-2", col1Id, 1e-15);
			await insertCard("R-3", col1Id, 2e-15);
			const cardId = await insertCard("Card E", col1Id, 5000);

			// Move card between the tightly-packed siblings — triggers RangeError → rebalance
			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col1Id, index: 1 });

			expect(res.status).toBe(200);
			expect(res.body.column_id).toBe(col1Id);
		});

		// ----- Activity logging -----

		it("records activity when moving across columns", async () => {
			const cardId = await insertCard("Card F", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0 });

			expect(res.status).toBe(200);

			const events = await pool.query(
				"SELECT * FROM card_events WHERE card_id = $1",
				[cardId],
			);
			expect(events.rows).toHaveLength(1);
			const evt = events.rows[0];
			expect(evt.event_type).toBe("move");
			expect(evt.from_column_id).toBe(col1Id);
			expect(evt.to_column_id).toBe(col2Id);
			expect(evt.actor_id).toBe(mockTestUser.id);
			expect(evt.workspace_id).toBe(1);
			expect(evt.payload).toHaveProperty("cardTitle", "Card F");
		});

		// ----- Same-column reorder -----

		it("does NOT record activity for same-column reorder", async () => {
			await insertCard("G-1", col1Id, 1000);
			await insertCard("G-2", col1Id, 2000);
			const cardId = await insertCard("Card G", col1Id, 1500);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col1Id, index: 0 });

			expect(res.status).toBe(200);
			expect(res.body.column_id).toBe(col1Id);

			// No activity log for same-column moves
			const events = await pool.query(
				"SELECT * FROM card_events WHERE card_id = $1",
				[cardId],
			);
			expect(events.rows).toHaveLength(0);
		});

		// ----- Edge cases -----

		it("returns 400 for invalid toColumnId", async () => {
			const cardId = await insertCard("Card H", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: "abc", index: 0 });

			expect(res.status).toBe(400);
		});

		it("returns 400 for missing index", async () => {
			const cardId = await insertCard("Card I", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col2Id });

			expect(res.status).toBe(400);
		});

		it("returns 400 for version as string", async () => {
			const cardId = await insertCard("Card J", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0, version: "1" });

			expect(res.status).toBe(400);
		});

		it("returns 404 for non-existent card", async () => {
			const res = await request(app)
				.post("/api/workspaces/1/cards/99999/move")
				.send({ toColumnId: col2Id, index: 0 });

			expect(res.status).toBe(404);
		});

		it("returns 404 for non-existent target column", async () => {
			const cardId = await insertCard("Card K", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/1/cards/${cardId}/move`)
				.send({ toColumnId: 99999, index: 0 });

			expect(res.status).toBe(404);
		});
	},
);

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:wid/columns/:id
// ---------------------------------------------------------------------------
describe.skipIf(!process.env.RUN_LLM_IT)(
	"PATCH /api/workspaces/:wid/columns/:id",
	() => {
		beforeEach(async () => {
			// Reset all columns to is_done = false before each test
			await pool.query(
				"UPDATE columns SET is_done = false WHERE workspace_id = 1",
			);
		});

		it("sets isDone to true and returns updated column", async () => {
			const res = await request(app)
				.patch(`/api/workspaces/1/columns/${col1Id}`)
				.send({ isDone: true });

			expect(res.status).toBe(200);
			expect(res.body.is_done).toBe(true);
		});

		it("unsets isDone when set to false", async () => {
			// First set to true
			await request(app)
				.patch(`/api/workspaces/1/columns/${col1Id}`)
				.send({ isDone: true });

			// Then unset
			const res = await request(app)
				.patch(`/api/workspaces/1/columns/${col1Id}`)
				.send({ isDone: false });

			expect(res.status).toBe(200);
			expect(res.body.is_done).toBe(false);
		});

		it("enforces single Done column per workspace", async () => {
			// col1Id becomes Done
			await request(app)
				.patch(`/api/workspaces/1/columns/${col1Id}`)
				.send({ isDone: true });

			// col2Id also becomes Done - should unset col1Id
			const res = await request(app)
				.patch(`/api/workspaces/1/columns/${col2Id}`)
				.send({ isDone: true });

			expect(res.status).toBe(200);
			expect(res.body.is_done).toBe(true);

			// Verify col1Id is no longer Done
			const check = await pool.query(
				"SELECT is_done FROM columns WHERE id = $1",
				[col1Id],
			);
			expect(check.rows[0].is_done).toBe(false);
		});

		it("returns 400 for invalid isDone type", async () => {
			const res = await request(app)
				.patch(`/api/workspaces/1/columns/${col1Id}`)
				.send({ isDone: "yes" });

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/isDone must be a boolean/i);
		});

		it("returns 400 for invalid column id", async () => {
			const res = await request(app)
				.patch("/api/workspaces/1/columns/abc")
				.send({ isDone: true });

			expect(res.status).toBe(400);
		});

		it("returns 404 for non-existent column", async () => {
			const res = await request(app)
				.patch("/api/workspaces/1/columns/99999")
				.send({ isDone: true });

			expect(res.status).toBe(404);
		});
	},
);
