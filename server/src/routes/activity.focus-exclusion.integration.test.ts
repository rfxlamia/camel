// Integration tests: GET /activity excludes focus_session rows in SQL
// before limit — focus events must not consume the activity page.
//
// Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
// Run:
//   RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/activity.focus-exclusion.integration.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
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
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { activityRouter } from "./activity.js";

const { mockCurrentUser } = vi.hoisted(() => ({
	mockCurrentUser: {
		id: 20950,
		username: "t15-actor",
		displayName: "T15 Actor",
	},
}));

const WORKSPACE_ID = 2095;

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));
vi.mock("../realtime.js", () => ({
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
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T15 Focus Exclusion WS', $2, false)",
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
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id) VALUES ($1, $2, 'Focus test card', 1024, $3) RETURNING id",
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

integration("GET /activity focus_session exclusion", () => {
	it("returns only card events when feed mixes move and focus_session rows", async () => {
		const { columnId, cardId } = await setupFixtures();

		await insertCardEvent("focus_session", {
			cardId: null,
			payload: { kind: "focus_session", action: "start" },
		});
		await insertCardEvent("move", {
			cardId,
			fromColumnId: columnId,
			toColumnId: columnId,
			payload: { cardTitle: "Focus test card" },
		});

		const res = await request(app).get(
			`/workspaces/${WORKSPACE_ID}/activity`,
		);

		expect(res.status).toBe(200);
		expect(res.body.events).toHaveLength(1);
		expect(res.body.events[0].type).toBe("move");
		expect(res.body.events[0].cardId).toBe(cardId);
	});

	it("returns empty events when workspace has only focus_session rows", async () => {
		await setupFixtures();

		for (const action of ["start", "pause", "end"]) {
			await insertCardEvent("focus_session", {
				cardId: null,
				payload: { kind: "focus_session", action },
			});
		}

		const res = await request(app).get(
			`/workspaces/${WORKSPACE_ID}/activity`,
		);

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ events: [] });
	});
});
