// Requires PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/tracker/work-item-merged-workspace.integration.test.ts
// A workspace created after the merge works end to end and never touches the old tracker tables.
import "dotenv/config";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { SCHEMA, mockCurrentUser } = vi.hoisted(() => ({
	SCHEMA: `wim_ws_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`,
	mockCurrentUser: { id: 0, username: "ws-user", displayName: "Owner" },
}));

vi.mock("../../db/pool.js", async () => {
	const { createScratchPool } = await import(
		"../../db/scratch-pool-test-support.js"
	);
	return { pool: createScratchPool(SCHEMA) };
});
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

import { applySchema } from "../../db/migrate.js";
import { pool } from "../../db/pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "../../db/scratch-schema-test-support.js";
import {
	rows,
	seedEvents,
	seedItem,
	seedWorkspace,
} from "../../db/work-item-merge.test-support.js";
import {
	createMergedApp,
	createWorkspaceThroughRoutes,
	insertUser,
} from "../../db/work-item-merged-app.test-support.js";

const app = createMergedApp();

const OLD_TABLES = [
	"tracker_items",
	"tracker_item_labels",
	"tracker_item_assignees",
	"tracker_events",
] as const;

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"brand-new workspace after the merge",
	() => {
		let s: ScratchSchema;

		const oldTableCounts = async () => {
			const counts: Record<string, number> = {};
			for (const table of OLD_TABLES) {
				counts[table] = (
					await rows(s, `SELECT count(*)::int AS n FROM ${table}`)
				)[0].n;
			}
			return counts;
		};

		beforeAll(async () => {
			s = await createScratchSchema("wim_ws", { schema: SCHEMA });
			await applySchema(s.client);
			// Pre-merge tracker rows make the migration create the late-write trigger.
			const legacy = await seedWorkspace(s, "legacy");
			const itemId = await seedItem(s, legacy, 1);
			await seedEvents(s, legacy, itemId, 2);
			await s.client.query(
				"INSERT INTO tracker_item_assignees (tracker_item_id, user_id) VALUES ($1, $2)",
				[itemId, legacy.userId],
			);
			await s.client.query(
				"INSERT INTO tracker_item_labels (tracker_item_id, vocabulary_id) VALUES ($1, $2)",
				[itemId, legacy.labelId],
			);
			await applySchema(s.client, { workItemMerge: true });
			mockCurrentUser.id = await insertUser(s, "ws-owner");
		});

		afterAll(async () => {
			await s?.drop();
			await pool.end();
		});

		it("creates a workspace, a first Tracker item and a first card without touching the old tables", async () => {
			const trigger = await rows(
				s,
				"SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tracker_items_block_insert'",
			);
			expect(trigger).toHaveLength(1);
			const before = await oldTableCounts();

			const ws = await createWorkspaceThroughRoutes(app, "Fresh Workspace");
			const base = `/api/workspaces/${ws.id}`;
			const [label] = await rows(
				s,
				"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'label' ORDER BY id",
				[ws.id],
			);
			expect(label).toBeDefined();

			const tracker = await request(app)
				.post(`${base}/tracker/items`)
				.send({
					title: "first tracker item",
					assigneeIds: [mockCurrentUser.id],
					labelIds: [label.id],
				});
			expect(tracker.status).toBe(201);
			const card = await request(app)
				.post(`${base}/cards`)
				.send({ columnId: ws.columns[0].id, title: "first card" });
			expect(card.status).toBe(201);

			const keyNumber = (key: string) => Number(key.split("-").pop());
			expect([keyNumber(tracker.body.key), keyNumber(card.body.key)]).toEqual([
				1, 2,
			]);
			expect(tracker.body.assignees).toHaveLength(1);
			expect(tracker.body.labels).toHaveLength(1);

			const list = await request(app).get(`${base}/work-items`);
			expect(list.status).toBe(200);
			expect(
				(list.body as { source: string }[]).map((i) => i.source).sort(),
			).toEqual(["board", "tracker"]);
			const [newRows] = await rows(
				s,
				`SELECT count(*) FILTER (WHERE column_id IS NULL)::int AS tracker_rows,
				        count(*) FILTER (WHERE column_id IS NOT NULL)::int AS board_rows
				 FROM cards WHERE workspace_id = $1`,
				[ws.id],
			);
			expect(newRows).toEqual({ tracker_rows: 1, board_rows: 1 });

			// No row reached any old table, for any workspace.
			expect(await oldTableCounts()).toEqual(before);
		});
	},
);
