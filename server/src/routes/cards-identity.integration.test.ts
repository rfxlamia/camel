import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPublishEvent, mockTestUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn(),
	mockTestUser: {
		id: 1,
		username: "identity-test",
		displayName: "Identity Test",
	},
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
import { createAgentRouter } from "../agent/routes.js";
import { pool } from "../db/pool.js";
import { registerAgentAndSeedTests } from "./cards-identity.integration.helpers.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

const WORKSPACE_ID = 995;

function createApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(
		"/api",
		createAgentRouter({
			classifyIntent: async () => ({
				templateId: "research-report",
				explanation: "classified",
			}),
			executeCard: async () => ({ output: "agent output" }),
		}),
	);
	app.use(createErrorHandler());
	return app;
}

export const app = createApp();

async function resetWorkspace() {
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username`,
		[
			mockTestUser.id,
			mockTestUser.username,
			mockTestUser.displayName,
			"hashed",
		],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
		 VALUES ($1, 'Identity Test Workspace', $2, false)`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
		 VALUES ($1, $2, 'owner')`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await pool.query(
		`INSERT INTO tracker_vocabularies
		 (workspace_id, kind, name, position, colour, slot)
		 VALUES
		 ($1, 'status', 'Backlog', 1024, 'blue', 'backlog'),
		 ($1, 'status', 'Todo', 2048, 'blue', 'todo'),
		 ($1, 'status', 'In Progress', 3072, 'green', 'in_progress'),
		 ($1, 'status', 'Done', 4096, 'green', 'done'),
		 ($1, 'status', 'Canceled', 5120, 'red', 'canceled')`,
		[WORKSPACE_ID],
	);
}

export async function addColumn(
	title: string,
	position: number,
	isDone = false,
	boardId: number | null = null,
) {
	const result = await pool.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, board_id, title, position, is_done)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		[WORKSPACE_ID, boardId, title, position, isDone],
	);
	return result.rows[0]!.id;
}

beforeEach(async () => {
	await resetWorkspace();
	vi.clearAllMocks();
});

afterAll(async () => {
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.end();
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"card identity allocation",
	() => {
		it("allocates In Review status/key and returns the shared T3 response shape", async () => {
			const backlog = await addColumn("Inbox", 1024);
			await addColumn("Ready", 2048);
			await addColumn("In Progress", 3072);
			const review = await addColumn("In Review", 4096);
			await addColumn("Done", 5120, true);

			const response = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId: review, title: "Review me" });

			expect(response.status).toBe(201);
			expect(response.body.key).toBe("IT-1");
			expect(response.body.status.slot).toBe("in_progress");
			expect(response.body.status.kind).toBe("status");
			expect(response.body.columnId).toBe(review);
			expect(backlog).toBeDefined();
		});

		it("rejects statusId on POST and PATCH before changing the database", async () => {
			const columnId = await addColumn("Inbox", 1024);
			const post = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId, title: "Rejected", statusId: 999999 });
			expect(post.status).toBe(400);
			expect(
				(
					await pool.query(
						"SELECT count(*)::int AS n FROM cards WHERE workspace_id = $1",
						[WORKSPACE_ID],
					)
				).rows[0]!.n,
			).toBe(0);

			const card = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId, title: "Patch target" });
			const patch = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.body.id}`)
				.send({ title: "Must reject", statusId: 999999 });
			expect(patch.status).toBe(400);
			expect(
				(
					await pool.query("SELECT title FROM cards WHERE id = $1", [
						card.body.id,
					])
				).rows[0]!.title,
			).toBe("Patch target");
		});

		it("serializes concurrent card and tracker allocations without duplicate keys", async () => {
			const columnId = await addColumn("Inbox", 1024);
			const statuses = await pool.query<{ id: number }>(
				"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND slot = 'backlog'",
				[WORKSPACE_ID],
			);
			const results = await Promise.all([
				...Array.from({ length: 4 }, () =>
					request(app)
						.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
						.send({ columnId, title: "Concurrent card" }),
				),
				...Array.from({ length: 4 }, () =>
					request(app)
						.post(`/api/workspaces/${WORKSPACE_ID}/tracker/items`)
						.send({
							title: "Concurrent tracker",
							statusId: statuses.rows[0]!.id,
						}),
				),
			]);
			expect(results.every((result) => result.status === 201)).toBe(true);
			const keys = await pool.query<{ key_number: number }>(
				`SELECT key_number FROM cards WHERE workspace_id = $1
			 UNION ALL SELECT key_number FROM tracker_items WHERE workspace_id = $1`,
				[WORKSPACE_ID],
			);
			expect(new Set(keys.rows.map((row) => row.key_number)).size).toBe(8);
		});

		it("keeps a soft-deleted key issued and increments the next key", async () => {
			const columnId = await addColumn("Inbox", 1024);
			const first = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId, title: "Delete me" });
			expect(first.body.key).toBe("IT-1");
			expect(
				(
					await request(app).delete(
						`/api/workspaces/${WORKSPACE_ID}/cards/${first.body.id}`,
					)
				).status,
			).toBe(204);
			const second = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId, title: "Keep counting" });
			expect(second.body.key).toBe("IT-2");
			const row = await pool.query<{
				key_number: number;
				deleted_at: Date | null;
			}>("SELECT key_number, deleted_at FROM cards WHERE id = $1", [
				first.body.id,
			]);
			expect(row.rows[0]!.key_number).toBe(1);
			expect(row.rows[0]!.deleted_at).not.toBeNull();
		});

		registerAgentAndSeedTests({
			app,
			workspaceId: WORKSPACE_ID,
			addColumn,
		});

		it("rejects a direct null status insert after final migration", async () => {
			const columnId = await addColumn("Inbox", 1024);
			await expect(
				pool.query(
					`INSERT INTO cards (workspace_id, column_id, title, position, key_number)
					 VALUES ($1, $2, 'invalid', 1024, 99)`,
					[WORKSPACE_ID, columnId],
				),
			).rejects.toMatchObject({ code: "23502" });
		});
	},
);
