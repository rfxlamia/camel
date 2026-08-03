// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test -- src/routes/tracker-vocabularies.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockTestUser } = vi.hoisted(() => ({
	mockTestUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn(),
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

import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

const WORKSPACE_ID = 100;

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

async function cleanup() {
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
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
     VALUES ($1, 'Tracker Vocab Test WS', $2, false) ON CONFLICT (id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);

	for (const [kind, name, position, colour] of DEFAULT_VOCAB) {
		await pool.query(
			`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour)
       VALUES ($1, $2, $3, $4, $5)`,
			[WORKSPACE_ID, kind, name, position, colour],
		);
	}
}

beforeEach(async () => {
	await setupFixtures();
	await cleanup();
	await setupFixtures();
	vi.clearAllMocks();
});

afterEach(async () => {
	await cleanup();
});

describe.skipIf(!process.env.RUN_INTEGRATION)("tracker vocabulary API", () => {
	it("lists status vocabulary ordered by position", async () => {
		const res = await request(app).get(
			`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies?kind=status`,
		);
		expect(res.status).toBe(200);
		const names = res.body.map((v: { name: string }) => v.name);
		expect(names).toEqual([
			"Backlog",
			"Todo",
			"In Progress",
			"Done",
			"Canceled",
		]);
	});

	it("creates status with fractional position between neighbors", async () => {
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
			.send({ kind: "status", name: "Blocked", position: 1500 });
		expect(res.status).toBe(201);
		expect(res.body.name).toBe("Blocked");
		expect(res.body.position).toBe(1500);
		expect(res.body.colour).toMatch(/^oklch\(/i);
	});

	it("rejects duplicate vocabulary name case-insensitively", async () => {
		await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
			.send({ kind: "status", name: "Blocked", position: 1500 });

		const dup = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
			.send({ kind: "status", name: "blocked", position: 1600 });

		expect([400, 409]).toContain(dup.status);
	});

	it("assigns auto pastel colour on label create", async () => {
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/tracker/vocabularies`)
			.send({ kind: "label", name: "Infra", position: 1000 });
		expect(res.status).toBe(201);
		expect(res.body.colour).toMatch(/^oklch\(/i);
	});
});
