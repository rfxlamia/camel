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

import cookieParser from "cookie-parser";
// ---------------------------------------------------------------------------
// Now safe to import modules that depend on the mocked deps.
// ---------------------------------------------------------------------------
import express from "express";
import request from "supertest";
import { seedTrackerVocabulary } from "./core/tracker-vocabulary-seed.js";
import { db } from "./db/kysely.js";
import { pool } from "./db/pool.js";
import { api } from "./routes.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const WS_ID = 1;

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
const columnStatusIds = new Map<number, number>();

async function statusIdForColumn(columnId: number) {
	const cached = columnStatusIds.get(columnId);
	if (cached !== undefined) return cached;
	const column = await db
		.selectFrom("columns")
		.select(["title", "is_done"])
		.where("id", "=", columnId)
		.executeTakeFirstOrThrow();
	const slot = column.is_done
		? "done"
		: column.title === "In Progress"
			? "in_progress"
			: "backlog";
	const status = await db
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", WS_ID)
		.where("kind", "=", "status")
		.where("slot", "=", slot)
		.executeTakeFirstOrThrow();
	columnStatusIds.set(columnId, status.id);
	return status.id;
}

async function setupFixtures() {
	// User — idempotent so multiple test files sharing user id=1 don't collide
	await db
		.insertInto("users")
		.values({
			id: mockTestUser.id,
			username: mockTestUser.username,
			display_name: mockTestUser.displayName,
			password_hash: "hashed",
		})
		.onConflict((oc) => oc.column("id").doNothing())
		.execute();

	// Workspace
	await db
		.insertInto("workspaces")
		.values({
			id: WS_ID,
			name: "Test WS",
			owner_user_id: mockTestUser.id,
			is_personal: false,
		})
		.onConflict((oc) => oc.column("id").doNothing())
		.execute();

	// Membership
	await db
		.insertInto("workspace_members")
		.values({
			workspace_id: WS_ID,
			user_id: mockTestUser.id,
			role: "owner",
		})
		.onConflict((oc) => oc.columns(["workspace_id", "user_id"]).doNothing())
		.execute();

	// Columns — clear workspace fixtures then insert predictable set
	await db.deleteFrom("cards").where("workspace_id", "=", WS_ID).execute();
	await db
		.deleteFrom("tracker_vocabularies")
		.where("workspace_id", "=", WS_ID)
		.execute();
	await db.deleteFrom("columns").where("workspace_id", "=", WS_ID).execute();
	await seedTrackerVocabulary(db, WS_ID);
	columnStatusIds.clear();

	const cols = await db
		.insertInto("columns")
		.values([
			{
				title: "Backlog",
				position: 1000,
				wip_limit: null,
				is_done: false,
				workspace_id: WS_ID,
			},
			{
				title: "In Progress",
				position: 2000,
				wip_limit: 2,
				is_done: false,
				workspace_id: WS_ID,
			},
			{
				title: "Done",
				position: 3000,
				wip_limit: null,
				is_done: true,
				workspace_id: WS_ID,
			},
		])
		.returning(["id", "title"])
		.execute();

	col1Id = cols.find((c) => c.title === "Backlog")!.id;
	col2Id = cols.find((c) => c.title === "In Progress")!.id;
}

async function insertCard(
	title: string,
	columnId: number,
	position: number,
	version = 1,
) {
	const row = await db
		.insertInto("cards")
		.values({
			title,
			column_id: columnId,
			position,
			version,
			workspace_id: WS_ID,
			status_id: await statusIdForColumn(columnId),
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return row.id;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
	await setupFixtures();
});

afterEach(async () => {
	// Clean per-test data but keep base fixtures — scoped to this workspace only
	await db
		.deleteFrom("card_events")
		.where("workspace_id", "=", WS_ID)
		.execute();
	await db
		.deleteFrom("card_assignees")
		.where(
			"card_id",
			"in",
			db.selectFrom("cards").select("id").where("workspace_id", "=", WS_ID),
		)
		.execute();
	await db.deleteFrom("cards").where("workspace_id", "=", WS_ID).execute();
	// Reset card sequence to avoid collisions across test files
	await pool.query(
		"SELECT setval('cards_id_seq', COALESCE((SELECT MAX(id) FROM cards), 0) + 1, false)",
	);
	vi.clearAllMocks();
});

afterAll(async () => {
	// Scoped cleanup — only remove data for this test's workspace.
	// DO NOT truncate global tables (users, workspaces) as other test files
	// create their own workspace-scoped data.
	await db
		.deleteFrom("card_events")
		.where("workspace_id", "=", WS_ID)
		.execute();
	await db
		.deleteFrom("card_assignees")
		.where(
			"card_id",
			"in",
			db.selectFrom("cards").select("id").where("workspace_id", "=", WS_ID),
		)
		.execute();
	await db.deleteFrom("cards").where("workspace_id", "=", WS_ID).execute();
	await db.deleteFrom("columns").where("workspace_id", "=", WS_ID).execute();
	await db
		.deleteFrom("workspace_members")
		.where("workspace_id", "=", WS_ID)
		.execute();
	await db.deleteFrom("workspaces").where("id", "=", WS_ID).execute();
	// NOTE: we intentionally do NOT delete the shared user (id=1) since other
	// test files also use it with ON CONFLICT DO NOTHING.
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
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0, version: 1 });

			expect(res.status).toBe(200);
			expect(res.body.columnId).toBe(col2Id);
			expect(res.body.version).toBe(2);
		});

		it("moves a card without version (skips optimistic locking)", async () => {
			const cardId = await insertCard("Card B", col1Id, 1000, 5);

			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0 });

			expect(res.status).toBe(200);
			expect(res.body.columnId).toBe(col2Id);
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
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0 });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatch(/WIP limit/i);
			expect(res.body.reason).toBe("wip_limit_reached");
		});

		// ----- Optimistic locking -----

		it("rejects move with stale version (409)", async () => {
			const cardId = await insertCard("Card D", col1Id, 1000, 1);

			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
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
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: col1Id, index: 1 });

			expect(res.status).toBe(200);
			expect(res.body.columnId).toBe(col1Id);
		});

		// ----- Activity logging -----

		it("records activity when moving across columns", async () => {
			const cardId = await insertCard("Card F", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0 });

			expect(res.status).toBe(200);

			const events = await db
				.selectFrom("card_events")
				.selectAll()
				.where("card_id", "=", cardId)
				.execute();
			expect(events).toHaveLength(1);
			const evt = events[0];
			expect(evt.event_type).toBe("move");
			expect(evt.from_column_id).toBe(col1Id);
			expect(evt.to_column_id).toBe(col2Id);
			expect(evt.actor_id).toBe(mockTestUser.id);
			expect(evt.workspace_id).toBe(WS_ID);
			expect(evt.payload).toHaveProperty("cardTitle", "Card F");
		});

		// ----- Same-column reorder -----

		it("records reorder activity for same-column reorder", async () => {
			await insertCard("G-1", col1Id, 1000);
			await insertCard("G-2", col1Id, 2000);
			const cardId = await insertCard("Card G", col1Id, 1500);

			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: col1Id, index: 0 });

			expect(res.status).toBe(200);
			expect(res.body.columnId).toBe(col1Id);

			// Same-column moves are recorded as "reorder" events
			const events = await db
				.selectFrom("card_events")
				.selectAll()
				.where("card_id", "=", cardId)
				.execute();
			expect(events).toHaveLength(1);
			expect(events[0].event_type).toBe("reorder");
			expect(events[0].actor_id).toBe(mockTestUser.id);
			expect(events[0].workspace_id).toBe(WS_ID);
			expect(events[0].payload).toHaveProperty("cardTitle", "Card G");
		});

		// ----- Edge cases -----

		it("returns 400 for invalid toColumnId", async () => {
			const cardId = await insertCard("Card H", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: "abc", index: 0 });

			expect(res.status).toBe(400);
		});

		it("returns 400 for missing index", async () => {
			const cardId = await insertCard("Card I", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: col2Id });

			expect(res.status).toBe(400);
		});

		it("returns 400 for version as string", async () => {
			const cardId = await insertCard("Card J", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: col2Id, index: 0, version: "1" });

			expect(res.status).toBe(400);
		});

		it("returns 404 for non-existent card", async () => {
			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/99999/move`)
				.send({ toColumnId: col2Id, index: 0 });

			expect(res.status).toBe(404);
		});

		it("returns 404 for non-existent target column", async () => {
			const cardId = await insertCard("Card K", col1Id, 1000);

			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/cards/${cardId}/move`)
				.send({ toColumnId: 99999, index: 0 });

			expect(res.status).toBe(404);
		});
	},
);

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:wid/columns/:id
// ---------------------------------------------------------------------------
describe.skipIf(!process.env.RUN_INTEGRATION)(
	"PATCH /api/workspaces/:wid/columns/:id",
	() => {
		beforeEach(async () => {
			// Reset all columns to is_done = false before each test
			await db
				.updateTable("columns")
				.set({ is_done: false })
				.where("workspace_id", "=", WS_ID)
				.execute();
		});

		it("sets isDone to true and returns updated column", async () => {
			const res = await request(app)
				.patch(`/api/workspaces/${WS_ID}/columns/${col1Id}`)
				.send({ isDone: true });

			expect(res.status).toBe(200);
			expect(res.body.is_done).toBe(true);
		});

		it("unsets isDone when set to false", async () => {
			// First set to true
			await request(app)
				.patch(`/api/workspaces/${WS_ID}/columns/${col1Id}`)
				.send({ isDone: true });

			// Then unset
			const res = await request(app)
				.patch(`/api/workspaces/${WS_ID}/columns/${col1Id}`)
				.send({ isDone: false });

			expect(res.status).toBe(200);
			expect(res.body.is_done).toBe(false);
		});

		it("enforces single Done column per workspace", async () => {
			// col1Id becomes Done
			await request(app)
				.patch(`/api/workspaces/${WS_ID}/columns/${col1Id}`)
				.send({ isDone: true });

			// col2Id also becomes Done - should unset col1Id
			const res = await request(app)
				.patch(`/api/workspaces/${WS_ID}/columns/${col2Id}`)
				.send({ isDone: true });

			expect(res.status).toBe(200);
			expect(res.body.is_done).toBe(true);

			// Verify col1Id is no longer Done
			const check = await db
				.selectFrom("columns")
				.select("is_done")
				.where("id", "=", col1Id)
				.executeTakeFirstOrThrow();
			expect(check.is_done).toBe(false);
		});

		it("returns 400 for invalid isDone type", async () => {
			const res = await request(app)
				.patch(`/api/workspaces/${WS_ID}/columns/${col1Id}`)
				.send({ isDone: "yes" });

			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/isDone must be a boolean/i);
		});

		it("returns 400 for invalid column id", async () => {
			const res = await request(app)
				.patch(`/api/workspaces/${WS_ID}/columns/abc`)
				.send({ isDone: true });

			expect(res.status).toBe(400);
		});

		it("returns 404 for non-existent column", async () => {
			const res = await request(app)
				.patch(`/api/workspaces/${WS_ID}/columns/99999`)
				.send({ isDone: true });

			expect(res.status).toBe(404);
		});

		it("enforces single Done column under concurrent isDone=true requests", async () => {
			const cols = await db
				.insertInto("columns")
				.values([
					{
						title: "Race A",
						position: 4000,
						is_done: false,
						workspace_id: WS_ID,
					},
					{
						title: "Race B",
						position: 5000,
						is_done: false,
						workspace_id: WS_ID,
					},
					{
						title: "Race C",
						position: 6000,
						is_done: false,
						workspace_id: WS_ID,
					},
					{
						title: "Race D",
						position: 7000,
						is_done: false,
						workspace_id: WS_ID,
					},
					{
						title: "Race E",
						position: 8000,
						is_done: false,
						workspace_id: WS_ID,
					},
				])
				.returning("id")
				.execute();
			const raceColIds = cols.map((c) => c.id);

			try {
				const results = await Promise.all(
					raceColIds.map((cid) =>
						request(app)
							.patch(`/api/workspaces/${WS_ID}/columns/${cid}`)
							.send({ isDone: true }),
					),
				);
				expect(results.every((r) => r.status === 200)).toBe(true);

				const doneCols = await db
					.selectFrom("columns")
					.select("id")
					.where("workspace_id", "=", WS_ID)
					.where("is_done", "=", true)
					.execute();
				expect(doneCols).toHaveLength(1);
			} finally {
				await db.deleteFrom("columns").where("id", "in", raceColIds).execute();
			}
		});
	},
);

// ---------------------------------------------------------------------------
// POST /api/workspaces/:wid/columns and DELETE .../columns/:id — activity log
// ---------------------------------------------------------------------------
describe.skipIf(!process.env.RUN_INTEGRATION)(
	"Column create/delete — card_events",
	() => {
		it("records a create activity event", async () => {
			const res = await request(app)
				.post(`/api/workspaces/${WS_ID}/columns`)
				.send({ title: "New Column" });
			expect(res.status).toBe(201);

			const events = await db
				.selectFrom("card_events")
				.select("payload")
				.where("workspace_id", "=", WS_ID)
				.where("event_type", "=", "create")
				.orderBy("id", "desc")
				.limit(1)
				.execute();
			expect(events).toHaveLength(1);
			expect(events[0].payload).toHaveProperty("columnTitle", "New Column");

			await db.deleteFrom("columns").where("id", "=", res.body.id).execute();
		});

		it("records a delete activity event", async () => {
			const col = await db
				.insertInto("columns")
				.values({
					title: "To Delete",
					position: 9000,
					wip_limit: null,
					is_done: false,
					workspace_id: WS_ID,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			const colId = col.id;

			const res = await request(app).delete(
				`/api/workspaces/${WS_ID}/columns/${colId}`,
			);
			expect(res.status).toBe(204);

			const events = await db
				.selectFrom("card_events")
				.select("payload")
				.where("workspace_id", "=", WS_ID)
				.where("event_type", "=", "delete")
				.orderBy("id", "desc")
				.limit(1)
				.execute();
			expect(events).toHaveLength(1);
			expect(events[0].payload).toHaveProperty("columnTitle", "To Delete");
		});
	},
);
