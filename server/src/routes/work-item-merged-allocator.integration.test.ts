// Requires PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/work-item-merged-allocator.integration.test.ts
// Board create, Tracker create and the agent create dependency share one key allocator.
import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { SCHEMA, mockCurrentUser } = vi.hoisted(() => ({
	SCHEMA: `wim_alloc_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`,
	mockCurrentUser: { id: 0, username: "alloc-user", displayName: "Owner" },
}));

vi.mock("../db/pool.js", async () => {
	const { createScratchPool } = await import(
		"../db/scratch-pool-test-support.js"
	);
	return { pool: createScratchPool(SCHEMA) };
});
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

import { applySchema } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "../db/scratch-schema-test-support.js";
import { rows } from "../db/work-item-merge.test-support.js";
import { boardDeps } from "../modules/agent/service-deps-board.js";
import {
	createMergedApp,
	createWorkspaceThroughRoutes,
	insertUser,
} from "./work-item-merged.app.test-support.js";

const app = createMergedApp();

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"one key allocator across entry points",
	() => {
		let s: ScratchSchema;

		beforeAll(async () => {
			s = await createScratchSchema("wim_alloc", { schema: SCHEMA });
			await applySchema(s.client, { workItemMerge: true });
			mockCurrentUser.id = await insertUser(s, "alloc-owner");
		});

		afterAll(async () => {
			await s?.drop();
			await pool.end();
		});

		it("board create, Tracker create and agent create allocate consecutive unique keys", async () => {
			const ws = await createWorkspaceThroughRoutes(app, "Allocator");
			const base = `/api/workspaces/${ws.id}`;
			const keyOf = (key: string) => Number(key.split("-").pop());

			const boardRes = await request(app)
				.post(`${base}/cards`)
				.send({ columnId: ws.columns[0].id, title: "from the board" });
			expect(boardRes.status).toBe(201);
			const trackerRes = await request(app)
				.post(`${base}/tracker/items`)
				.send({ title: "from the tracker" });
			expect(trackerRes.status).toBe(201);

			const [agentBoard] = await rows(
				s,
				`INSERT INTO agent_boards (workspace_id, user_id, template_id, original_intent, status)
				 VALUES ($1, $2, 'status-report', 'allocator check', 'approved') RETURNING id`,
				[ws.id, mockCurrentUser.id],
			);
			const [agentColumn] = await rows(
				s,
				`INSERT INTO columns (workspace_id, board_id, title, position, slug)
				 VALUES ($1, $2, 'Analyst', 1024, 'analyst') RETURNING id`,
				[ws.id, agentBoard.id],
			);
			await boardDeps.insertCard({
				boardId: agentBoard.id,
				columnId: agentColumn.id,
				workspaceId: ws.id,
				title: "from the agent",
				position: 1,
			} as never);

			const boardKey = keyOf(boardRes.body.key);
			const trackerKey = keyOf(trackerRes.body.key);
			const [agentCard] = await rows(
				s,
				"SELECT id, key_number FROM cards WHERE workspace_id = $1 AND title = 'from the agent'",
				[ws.id],
			);
			expect([boardKey, trackerKey, agentCard.key_number]).toEqual([1, 2, 3]);

			const [counter] = await rows(
				s,
				"SELECT tracker_key_counter FROM workspaces WHERE id = $1",
				[ws.id],
			);
			expect(counter.tracker_key_counter).toBe(3);

			// The unique index is what makes a duplicate key impossible.
			await expect(
				s.client.query(
					`INSERT INTO cards (workspace_id, column_id, title, position, key_number, status_id)
					 SELECT workspace_id, column_id, 'dupe', 1, key_number, status_id FROM cards WHERE id = $1`,
					[agentCard.id],
				),
			).rejects.toThrow(/duplicate key|unique/i);

			// Board and Tracker creation each wrote exactly one event. The agent
			// dependency intentionally writes none (service-deps-board.ts, R6).
			const eventCount = async (cardId: number) =>
				(
					await rows(
						s,
						"SELECT count(*)::int AS n FROM card_events WHERE card_id = $1",
						[cardId],
					)
				)[0].n;
			expect(await eventCount(boardRes.body.id)).toBe(1);
			expect(await eventCount(trackerRes.body.id)).toBe(1);
			expect(await eventCount(agentCard.id)).toBe(0);
		});
	},
);
