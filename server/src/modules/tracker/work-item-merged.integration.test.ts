// Requires PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/tracker/work-item-merged.integration.test.ts
// Reference workspace (anonymized) migrated on a scratch schema, then read over HTTP.
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// DATE columns are parsed by pg in the local zone and serialized via
// toISOString (pre-existing behavior); pin UTC so the date assertions do not
// depend on the machine zone.
const { SCHEMA, mockCurrentUser } = vi.hoisted(() => {
	process.env.TZ = "UTC";
	return {
		SCHEMA: `wim_ref_${process.pid}_${crypto.randomUUID().replaceAll("-", "")}`,
		mockCurrentUser: { id: 0, username: "ref-user", displayName: "Ref User" },
	};
});

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
import { rows } from "../../db/work-item-merge.test-support.js";
import {
	BOARD_CARDS,
	DONE,
	FOCUS_KEY,
	IN_PROGRESS,
	type ReferenceFixture,
	seedReferenceWorkspace,
	TRACKER_ITEMS,
} from "../../db/work-item-merged-fixture.test-support.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { api } from "../../routes.js";

const ENABLED = { workItemMerge: true };
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);
app.use(createErrorHandler());

type Item = Record<string, any>;

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"reference workspace after the merge",
	() => {
		let s: ScratchSchema;
		let fx: ReferenceFixture;
		let base: string;
		let list: Item[];
		let prefix: string;
		const key = (n: number) => `${prefix}-${n}`;

		beforeAll(async () => {
			s = await createScratchSchema("wim_ref", { schema: SCHEMA });
			await applySchema(s.client);
			fx = await seedReferenceWorkspace(s, "reference");
			mockCurrentUser.id = fx.userId;
			await applySchema(s.client, ENABLED);
			base = `/api/workspaces/${fx.workspaceId}`;
			const res = await request(app).get(`${base}/work-items`);
			expect(res.status).toBe(200);
			list = res.body;
			prefix = (list[0].key as string).replace(/-\d+$/, "");
		});

		afterAll(async () => {
			await s?.drop();
			await pool.end();
		});

		describe("Reference workspace is preserved", () => {
			it("GET /work-items lists 78 items and the key set is unchanged", async () => {
				expect(list).toHaveLength(BOARD_CARDS + TRACKER_ITEMS);
				expect(list.filter((i) => i.source === "board")).toHaveLength(
					BOARD_CARDS,
				);
				expect(list.filter((i) => i.source === "tracker")).toHaveLength(
					TRACKER_ITEMS,
				);
				const expected = [...fx.boardKeys, ...fx.trackerKeys].map(key);
				expect(list.map((i) => i.key).sort()).toEqual(expected.sort());
				expect(list.map((i) => i.title)).not.toContain("gone-item");
				expect(list.map((i) => i.title)).not.toContain("gone-card");
			});

			it("GET /board shows 25 cards with header 6 in progress / 16 done", async () => {
				const res = await request(app).get(`${base}/board`);
				expect(res.status).toBe(200);
				const columns = res.body.columns as Item[];
				const cards = columns.flatMap((c) => c.cards as Item[]);
				expect(cards).toHaveLength(BOARD_CARDS);
				// Same derivation as the client BoardToolbar stat chips.
				const done = cards.filter((c) => c.doneAt).length;
				const active = cards.filter((c) => !c.doneAt && c.startedAt).length;
				expect({ active, done }).toEqual({ active: IN_PROGRESS, done: DONE });
				expect(cards.map((c) => c.key).sort()).toEqual(
					fx.boardKeys.map(key).sort(),
				);
				const inProgress = columns.find((c) => c.title === "In Progress")!;
				expect(inProgress.wipLimit).toBe(8);
				expect(inProgress.cards).toHaveLength(IN_PROGRESS);
			});

			it("every tracker item keeps its fields and relations", async () => {
				for (const legacy of fx.trackerItems) {
					const item = list.find((i) => i.key === key(legacy.key))!;
					expect(item, `KEY ${legacy.key}`).toMatchObject({
						source: "tracker",
						title: legacy.title,
						description: legacy.description,
						projectId: legacy.projectId,
						phaseId: legacy.phaseId,
						startDate: legacy.startDate,
						endDate: legacy.endDate,
						version: legacy.version,
						position: legacy.position,
					});
					expect(item.status.id).toBe(legacy.statusId);
					expect(item.priority.id).toBe(legacy.priorityId);
					expect(item.labels.map((l: Item) => l.id).sort()).toEqual(
						[...legacy.labelIds].sort(),
					);
					expect(item.assignees.map((a: Item) => a.id).sort()).toEqual(
						[...legacy.assigneeIds].sort(),
					);
				}
				const focused = list.find((i) => i.key === key(FOCUS_KEY))!;
				const events = await request(app).get(
					`${base}/work-items/${key(FOCUS_KEY)}/events`,
				);
				expect(events.status).toBe(200);
				expect(events.body.events).toHaveLength(5);
				expect(focused.assignees).toHaveLength(2);
			});

			it("/cards/:id of a tracker item is 404", async () => {
				const tracker = list.find((i) => i.source === "tracker")!;
				const res = await request(app).get(`${base}/cards/${tracker.id}`);
				expect(res.status).toBe(404);
				const board = list.find((i) => i.source === "board")!;
				expect(
					(await request(app).get(`${base}/cards/${board.id}`)).status,
				).toBe(200);
			});

			it("activity, unified feed and flow metrics never count tracker rows as cards", async () => {
				const activity = await request(app).get(`${base}/activity?limit=200`);
				expect(activity.status).toBe(200);
				expect(activity.body.events).toHaveLength(BOARD_CARDS);
				const unified = await request(app).get(
					`${base}/activity/unified?limit=200`,
				);
				expect(unified.status).toBe(200);
				const trackerEvents = fx.trackerItems.reduce((n, i) => n + i.events, 0);
				expect(unified.body.events).toHaveLength(BOARD_CARDS + trackerEvents);

				const metrics = await request(app).get(`${base}/metrics`);
				expect(metrics.status).toBe(200);
				expect(metrics.body).toMatchObject({
					throughput: DONE,
					wipCount: IN_PROGRESS,
				});
			});

			it("My Work lists the user's active tracker items and the focus session follows its task", async () => {
				const res = await request(app).get("/api/my-work?scope=active");
				expect(res.status).toBe(200);
				const expected = fx.trackerItems
					.filter((i) => i.assigneeIds.includes(fx.userId) && !i.isDone)
					.map((i) => key(i.key));
				expect(
					(res.body.items as Item[]).map((i) => i.identity.key).sort(),
				).toEqual(expected.sort());
				for (const item of res.body.items as Item[]) {
					expect(item.identity).toMatchObject({
						workspaceId: fx.workspaceId,
						source: "tracker",
					});
				}

				const focus = await request(app).get(`${base}/focus-session`);
				expect(focus.status).toBe(200);
				const focused = list.find((i) => i.key === key(FOCUS_KEY))!;
				expect(focus.body.session).toMatchObject({
					source: "tracker",
					taskId: focused.id,
				});
				const orphans = await rows(
					s,
					`SELECT 1 FROM focus_sessions f WHERE f.task_source = 'tracker'
					 AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.id = f.task_id)`,
				);
				expect(orphans).toHaveLength(0);
			});
		});

		describe("Restart after go-live and late writes", () => {
			const counts = async () =>
				(
					await rows(
						s,
						`SELECT (SELECT count(*) FROM cards) AS cards,
						        (SELECT count(*) FROM card_events) AS events,
						        (SELECT count(*) FROM card_labels) AS labels,
						        (SELECT count(*) FROM card_assignees) AS assignees,
						        (SELECT tracker_key_counter FROM workspaces WHERE id = $1) AS counter`,
						[fx.workspaceId],
					)
				)[0];

			it("a second migration run keeps post-go-live edits and copies nothing", async () => {
				const target = list.find((i) => i.key === key(fx.trackerKeys[0]))!;
				const edit = await request(app)
					.patch(`${base}/work-items/${target.key}`)
					.send({ title: "edited after go-live", version: target.version });
				expect(edit.status).toBe(200);
				const created = await request(app).post(`${base}/cards`).send({
					columnId: fx.columnIds.requested,
					title: "born after go-live",
				});
				expect(created.status).toBe(201);
				const before = await counts();

				await applySchema(s.client, ENABLED);
				await applySchema(s.client);

				expect(await counts()).toEqual(before);
				const after = await request(app).get(`${base}/work-items`);
				expect(after.body).toHaveLength(BOARD_CARDS + TRACKER_ITEMS + 1);
				const titles = (after.body as Item[]).map((i) => i.title);
				expect(titles).toContain("edited after go-live");
				expect(titles).toContain("born after go-live");
			});

			it("a legacy insert into tracker_items raises", async () => {
				await expect(
					s.client.query(
						`INSERT INTO tracker_items (workspace_id, key_number, title, status_id)
						 VALUES ($1, 9999, 'late write', $2)`,
						[fx.workspaceId, fx.trackerItems[0].statusId],
					),
				).rejects.toThrow(/work-item-merge: tracker_items is closed/);
			});
		});
	},
);
