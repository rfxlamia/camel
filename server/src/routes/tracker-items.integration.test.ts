// server/src/routes/tracker-items.integration.test.ts
// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test -- server/src/routes/tracker-items.integration.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const { mockPublishEvent, mockCurrentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	mockCurrentUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
	publishEvent: mockPublishEvent,
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

vi.mock("../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: any) => {
			req.user = mockCurrentUser;
			next();
		},
	};
});

import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";
import { workspaceAccessService } from "./helpers.js";
import * as trackerActivity from "./tracker-activity.js";

const recordSpy = vi.spyOn(trackerActivity, "recordTrackerActivity");

const WORKSPACE_ID = 101; // Isolated — not 94/95/96/97/99
const OTHER_WORKSPACE_ID = 102;

const DEFAULT_VOCAB = [
	["status", "Backlog", 1024, "oklch(0.89 0.07 250)"],
	["status", "Todo", 2048, "oklch(0.89 0.07 200)"],
	["status", "In Progress", 3072, "oklch(0.89 0.07 150)"],
	["status", "Done", 4096, "oklch(0.89 0.07 140)"],
	["status", "Canceled", 5120, "oklch(0.89 0.07 30)"],
	["priority", "High", 1024, "oklch(0.89 0.07 25)"],
	["priority", "Medium", 2048, "oklch(0.89 0.07 85)"],
	["priority", "Low", 3072, "oklch(0.89 0.07 220)"],
	["label", "Feature", 1024, "oklch(0.89 0.07 280)"],
	["label", "Bug", 2048, "oklch(0.89 0.07 15)"],
	["label", "Maintain", 3072, "oklch(0.89 0.07 180)"],
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

async function seedVocabularies(wid: number) {
	for (const [kind, name, position, colour] of DEFAULT_VOCAB) {
		await pool.query(
			`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM tracker_vocabularies
         WHERE workspace_id = $1 AND kind = $2 AND lower(name) = lower($3)
       )`,
			[wid, kind, name, position, colour],
		);
	}
}

async function cleanupWorkspace(wid: number) {
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [wid]);
	await pool.query(
		"DELETE FROM tracker_item_assignees WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[wid],
	);
	await pool.query(
		"DELETE FROM tracker_item_labels WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[wid],
	);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [wid]);
	await pool.query(
		"UPDATE workspaces SET tracker_key_counter = 0 WHERE id = $1",
		[wid],
	);
	if (wid === WORKSPACE_ID) {
		await pool.query(`UPDATE workspaces SET name = 'Camel' WHERE id = $1`, [
			wid,
		]);
	} else if (wid === OTHER_WORKSPACE_ID) {
		await pool.query(`UPDATE workspaces SET name = 'Other' WHERE id = $1`, [
			wid,
		]);
	}
}

async function setupFixtures() {
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
		[
			mockCurrentUser.id,
			mockCurrentUser.username,
			mockCurrentUser.displayName,
			"hashed",
		],
	);
	for (const [wid, name] of [
		[WORKSPACE_ID, "Camel"],
		[OTHER_WORKSPACE_ID, "Other"],
	] as const) {
		await pool.query(
			`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
       VALUES ($1, $2, $3, false) ON CONFLICT (id) DO NOTHING`,
			[wid, name, mockCurrentUser.id],
		);
		await pool.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
			[wid, mockCurrentUser.id],
		);
		await seedVocabularies(wid);
	}
}

beforeEach(async () => {
	await setupFixtures();
	await cleanupWorkspace(WORKSPACE_ID);
	await cleanupWorkspace(OTHER_WORKSPACE_ID);
	vi.clearAllMocks();
});

afterEach(async () => {
	await cleanupWorkspace(WORKSPACE_ID);
	await cleanupWorkspace(OTHER_WORKSPACE_ID);
});

afterAll(async () => {
	await cleanupWorkspace(WORKSPACE_ID);
	await cleanupWorkspace(OTHER_WORKSPACE_ID);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id IN ($1, $2)", [
		WORKSPACE_ID,
		OTHER_WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id IN ($1, $2)", [
		WORKSPACE_ID,
		OTHER_WORKSPACE_ID,
	]);
});

describe.skipIf(!process.env.RUN_INTEGRATION)("tracker items CRUD", () => {
	it("creates item with Backlog status, null priority, and auto key CA-1", async () => {
		recordSpy.mockClear();
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Fix realtime" });
		expect(res.status).toBe(201);
		expect(res.body.key).toBe("CA-1");
		expect(res.body.status.name).toBe("Backlog");
		expect(res.body.priority).toBeNull();
		expect(recordSpy).toHaveBeenCalled();
	});

	it("rejects whitespace-only title with 400", async () => {
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "   " });
		expect(res.status).toBe(400);
	});

	it("searches by title, description, and key number", async () => {
		await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Workspace Rename", description: "rename flow" });

		const byTitle = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items?q=rename`,
		);
		expect(byTitle.body).toHaveLength(1);

		const byNumber = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items?q=1`,
		);
		expect(byNumber.body.some((i: { key: string }) => i.key === "CA-1")).toBe(
			true,
		);
	});

	it("returns 409 on stale version PATCH", async () => {
		recordSpy.mockClear();
		const created = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Conflict test" });
		const res = await request(app)
			.patch(`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`)
			.send({ title: "Updated", version: 999 });
		expect(res.status).toBe(409);
		expect(res.body.code).toBe("version_conflict");
		expect(created.body.version).toBe(1);
		expect(recordSpy).toHaveBeenCalled();
	});

	it("redirects stale prefix URL to canonical key on GET detail", async () => {
		await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Rename test" });
		await pool.query(`UPDATE workspaces SET name = $1 WHERE id = $2`, [
			"CK Team",
			WORKSPACE_ID,
		]);
		const res = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`,
		);
		expect(res.status).toBe(200);
		expect(res.body.key).toBe("CT-1");
		expect(res.body.canonicalKey).toBe("CT-1");
		expect(res.body.redirectFrom).toBe("CA-1");
	});

	it("returns changelog events from tracker_events", async () => {
		await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Changelog test" });
		await request(app)
			.patch(`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`)
			.send({ title: "Changelog test v2", version: 1 });

		const res = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1/events`,
		);
		expect(res.status).toBe(200);
		expect(res.body.events.length).toBeGreaterThanOrEqual(2);
		expect(res.body.events[0]).toMatchObject({
			eventType: expect.any(String),
			createdAt: expect.any(String),
		});
	});

	it("soft-deletes item: absent from list, search, detail 404; key_number not reused", async () => {
		await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "To delete" });

		const del = await request(app)
			.delete(`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`)
			.send({ version: 1 });
		expect(del.status).toBe(204);

		const list = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items`,
		);
		expect(list.body).toHaveLength(0);

		const search = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items?q=delete`,
		);
		expect(search.body).toHaveLength(0);

		const detail = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`,
		);
		expect(detail.status).toBe(404);

		const next = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Next item" });
		expect(next.body.key).toBe("CA-2");
	});

	it("returns 404 for item in wrong workspace context", async () => {
		await request(app)
			.post(`/api/workspaces/${OTHER_WORKSPACE_ID}/tracker/items`)
			.send({ title: "Other ws item" });

		const res = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`,
		);
		expect(res.status).toBe(404);
	});

	it("rejects non-member assignee with 400", async () => {
		await pool.query(
			`INSERT INTO users (id, username, display_name, password_hash)
       VALUES (99, 'outsider', 'Outsider', 'hash') ON CONFLICT (id) DO NOTHING`,
		);
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Assign test", assigneeIds: [99] });
		expect(res.status).toBe(400);
	});

	it("strips assignee on membership removal", async () => {
		await pool.query(
			`INSERT INTO users (id, username, display_name, password_hash)
       VALUES (2, 'bob', 'Bob', 'hash') ON CONFLICT (id) DO NOTHING`,
		);
		await pool.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, 2, 'member') ON CONFLICT DO NOTHING`,
			[WORKSPACE_ID],
		);
		const created = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Shared", assigneeIds: [2] });
		expect(created.body.assignees).toHaveLength(1);

		await workspaceAccessService.removeMember({
			actorId: mockCurrentUser.id,
			workspaceId: WORKSPACE_ID,
			userId: 2,
		});

		const detail = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/items/CA-1`,
		);
		expect(detail.body.assignees).toHaveLength(0);
	});

	it("allows member role to CRUD tracker items", async () => {
		const memberUser = { id: 3, username: "member", displayName: "Member" };
		await pool.query(
			`INSERT INTO users (id, username, display_name, password_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
			[memberUser.id, memberUser.username, memberUser.displayName, "hash"],
		);
		await pool.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
			[WORKSPACE_ID, memberUser.id],
		);
		Object.assign(mockCurrentUser, memberUser);
		const create = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
			.send({ title: "Member create" });
		expect(create.status).toBe(201);
		Object.assign(mockCurrentUser, {
			id: 1,
			username: "testuser",
			displayName: "Test User",
		});
	});
});
