// Integration tests: /activity excludes merged-event rows (tracker_project_*,
// tracker_phase_*) and GET /cards/:id/activity rejects column-less items.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/activity/activity-feed.integration.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import { pool } from "../../db/pool.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { activityRouter } from "./activity.js";

const { mockCurrentUser } = vi.hoisted(() => ({
	mockCurrentUser: {
		id: 32010,
		username: "t6-feed-actor",
		displayName: "T6 Feed Actor",
	},
}));

const WORKSPACE_ID = 3201;

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

function createApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use((req, _res, next) => {
		req.user = mockCurrentUser;
		next();
	});
	app.use("/workspaces/:workspaceId", activityRouter);
	app.use(createErrorHandler());
	return app;
}

const app = createApp();

async function idFor(sql: string, values: unknown[]): Promise<number> {
	return (await pool.query<{ id: number }>(sql, values)).rows[0]!.id;
}

async function cleanupWorkspace(): Promise<void> {
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
}

async function cleanupUser(): Promise<void> {
	await pool.query("DELETE FROM users WHERE id = $1", [mockCurrentUser.id]);
}

type Fixtures = { columnId: number; cardId: number };

async function setupFixtures(): Promise<Fixtures> {
	await cleanupWorkspace();
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, $2, $3, 'test') ON CONFLICT (id) DO NOTHING",
		[mockCurrentUser.id, mockCurrentUser.username, mockCurrentUser.displayName],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T6 Activity Feed WS', $2, false)",
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[WORKSPACE_ID, mockCurrentUser.id],
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
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id) VALUES ($1, $2, 'Feed test card', 1024, $3) RETURNING id",
		[WORKSPACE_ID, columnId, statusId],
	);
	return { columnId, cardId };
}

async function insertCardEvent(
	eventType: string,
	opts: {
		cardId?: number | null;
		fromColumnId?: number | null;
		toColumnId?: number | null;
		payload?: Record<string, unknown>;
	},
): Promise<void> {
	await pool.query(
		`INSERT INTO card_events
			(workspace_id, card_id, actor_id, event_type, payload, from_column_id, to_column_id)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
		[
			WORKSPACE_ID,
			opts.cardId ?? null,
			mockCurrentUser.id,
			eventType,
			JSON.stringify(opts.payload ?? {}),
			opts.fromColumnId ?? null,
			opts.toColumnId ?? null,
		],
	);
}

beforeEach(async () => {
	await cleanupWorkspace();
});

afterAll(async () => {
	await cleanupWorkspace();
	await cleanupUser();
});

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("GET /activity merged-event tolerance", () => {
	it("excludes project and phase events and never returns a null title", async () => {
		const { columnId, cardId } = await setupFixtures();

		await insertCardEvent("tracker_project_created", {
			payload: { title: "Roadmap" },
		});
		await insertCardEvent("tracker_phase_deleted", {
			payload: { title: "Phase 1" },
		});
		await insertCardEvent("move", {
			cardId,
			fromColumnId: columnId,
			toColumnId: columnId,
			payload: { cardTitle: "Feed test card" },
		});

		const res = await request(app).get(`/workspaces/${WORKSPACE_ID}/activity`);

		expect(res.status).toBe(200);
		expect(res.body.events.map((e: { type: string }) => e.type)).toEqual([
			"move",
		]);
		for (const e of res.body.events) {
			expect(e.cardTitle).not.toBeNull();
		}
	});
});

integration("GET /cards/:id/activity column-less items", () => {
	it("returns the existing 404 for a column-less card", async () => {
		const { cardId } = await setupFixtures();
		await pool.query("UPDATE cards SET column_id = NULL WHERE id = $1", [
			cardId,
		]);

		const res = await request(app).get(
			`/workspaces/${WORKSPACE_ID}/cards/${cardId}/activity`,
		);

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "Not found" });
	});

	it("still returns 200 with events for a normal board card", async () => {
		const { columnId, cardId } = await setupFixtures();
		await insertCardEvent("move", {
			cardId,
			fromColumnId: columnId,
			toColumnId: columnId,
			payload: { cardTitle: "Feed test card" },
		});

		const res = await request(app).get(
			`/workspaces/${WORKSPACE_ID}/cards/${cardId}/activity`,
		);

		expect(res.status).toBe(200);
		expect(res.body.events).toHaveLength(1);
		expect(res.body.events[0].type).toBe("move");
	});
});
