// Replicates server/src/routes.integration.test.ts: mock realtime/auth,
// real pool, fixtures. NOTE the file lives in server/src/routes/, so all
// app-module imports are "../" (not "./"). NodeNext → .js extensions.
// Gated: RUN_INTEGRATION=1 npx vitest run server/src/routes/columns.batch.integration.test.ts
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
import { api } from "../routes.js";

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	return app;
}

const app = createTestApp();

const PAYLOAD = {
	templateName: "Software Dev",
	columns: [
		{
			title: "Backlog",
			color: "powder-blue",
			wipLimit: null,
			policy: "Ideas.",
			isDone: false,
		},
		{
			title: "To Do",
			color: "pale-sky",
			wipLimit: null,
			policy: "Next.",
			isDone: false,
		},
		{
			title: "In Progress",
			color: "light-cyan",
			wipLimit: 3,
			policy: "WIP.",
			isDone: false,
		},
		{
			title: "In Review",
			color: "frozen-water",
			wipLimit: 2,
			policy: "QA.",
			isDone: false,
		},
		{
			title: "Done",
			color: "turquoise",
			wipLimit: null,
			policy: "Shipped.",
			isDone: true,
		},
	],
};

async function setupFixtures() {
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
		 VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
		[mockTestUser.id, mockTestUser.username, mockTestUser.displayName, "hashed"],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
		 VALUES (1, 'Test WS', $1, false) ON CONFLICT (id) DO NOTHING`,
		[mockTestUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
		 VALUES (1, $1, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[mockTestUser.id],
	);
}

beforeEach(async () => {
	await setupFixtures();
	await pool.query("DELETE FROM card_events");
	await pool.query("DELETE FROM columns WHERE workspace_id = 1");
	vi.clearAllMocks();
});

afterAll(async () => {
	await pool.query(
		"TRUNCATE users, workspaces, columns, cards, card_events CASCADE",
	);
	await pool.end();
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"POST /api/workspaces/:wid/columns/batch",
	() => {
		it("seeds an empty workspace atomically with one event + one activity", async () => {
			const res = await request(app)
				.post("/api/workspaces/1/columns/batch")
				.send(PAYLOAD);

			expect(res.status).toBe(201);

			const cols = await pool.query(
				"SELECT title, color, wip_limit, policy, is_done, is_signable, signable_assignee_id FROM columns WHERE workspace_id = 1 ORDER BY position",
			);
			expect(cols.rows).toHaveLength(5);
			expect(cols.rows.map((c) => c.title)).toEqual([
				"Backlog",
				"To Do",
				"In Progress",
				"In Review",
				"Done",
			]);
			expect(cols.rows.filter((c) => c.is_done)).toHaveLength(1);
			expect(cols.rows[2].wip_limit).toBe(3);
			expect(cols.rows[2].color).toBe("light-cyan");

			expect(mockPublishEvent).toHaveBeenCalledTimes(1);
			expect(mockPublishEvent.mock.calls[0][1]).toMatchObject({
				type: "column.created",
			});

			const events = await pool.query(
				"SELECT event_type, payload FROM card_events WHERE workspace_id = 1",
			);
			expect(events.rows).toHaveLength(1);
			expect(events.rows[0].event_type).toBe("create");
			expect(events.rows[0].payload).toMatchObject({
				templateName: "Software Dev",
				columnCount: 5,
			});
		});

		it("rejects a non-empty workspace with 409 and writes nothing", async () => {
			await pool.query(
				"INSERT INTO columns (title, position, workspace_id) VALUES ('Existing', 1024, 1)",
			);

			const res = await request(app)
				.post("/api/workspaces/1/columns/batch")
				.send(PAYLOAD);

			expect(res.status).toBe(409);
			const cols = await pool.query(
				"SELECT count(*)::int AS n FROM columns WHERE workspace_id = 1",
			);
			expect(cols.rows[0].n).toBe(1);
			expect(mockPublishEvent).not.toHaveBeenCalled();
			const events = await pool.query(
				"SELECT count(*)::int AS n FROM card_events WHERE workspace_id = 1",
			);
			expect(events.rows[0].n).toBe(0);
		});

		it("rejects an invalid color with 400 and creates no columns", async () => {
			const bad = {
				templateName: "Bad",
				columns: [
					{
						title: "X",
						color: "hot-pink",
						wipLimit: null,
						policy: "",
						isDone: false,
					},
				],
			};
			const res = await request(app)
				.post("/api/workspaces/1/columns/batch")
				.send(bad);

			expect(res.status).toBe(400);
			const cols = await pool.query(
				"SELECT count(*)::int AS n FROM columns WHERE workspace_id = 1",
			);
			expect(cols.rows[0].n).toBe(0);
		});

		it("ignores signable fields — created columns are is_signable=false, assignee=null", async () => {
			const withSignable = {
				templateName: "Signable Probe",
				columns: PAYLOAD.columns.map((c) => ({
					...c,
					isSignable: true,
					signableAssigneeId: 1,
				})),
			};
			const res = await request(app)
				.post("/api/workspaces/1/columns/batch")
				.send(withSignable);

			expect(res.status).toBe(201);
			const cols = await pool.query(
				"SELECT is_signable, signable_assignee_id FROM columns WHERE workspace_id = 1",
			);
			expect(cols.rows.every((c) => c.is_signable === false)).toBe(true);
			expect(cols.rows.every((c) => c.signable_assignee_id === null)).toBe(
				true,
			);
		});

		it("rolls back fully when an insert fails mid-apply (atomicity)", async () => {
			const realConnect = pool.connect.bind(pool);
			const connectSpy = vi
				.spyOn(pool, "connect")
				// biome-ignore lint/suspicious/noExplicitAny: test double
				.mockImplementation(async () => {
					const client: any = await realConnect();
					const realQuery = client.query.bind(client);
					let inserts = 0;
					client.query = (...args: any[]) => {
						const sql =
							typeof args[0] === "string" ? args[0] : (args[0]?.text ?? "");
						if (/INSERT INTO columns/i.test(sql)) {
							inserts++;
							if (inserts === 3) {
								return Promise.reject(new Error("simulated insert failure"));
							}
						}
						return realQuery(...args);
					};
					return client;
				});

			try {
				const res = await request(app)
					.post("/api/workspaces/1/columns/batch")
					.send(PAYLOAD);
				expect(res.status).toBeGreaterThanOrEqual(500);
			} finally {
				connectSpy.mockRestore();
			}

			const cols = await pool.query(
				"SELECT count(*)::int AS n FROM columns WHERE workspace_id = 1",
			);
			expect(cols.rows[0].n).toBe(0);
			const events = await pool.query(
				"SELECT count(*)::int AS n FROM card_events WHERE workspace_id = 1",
			);
			expect(events.rows[0].n).toBe(0);
			expect(mockPublishEvent).not.toHaveBeenCalled();
		});
	},
);
