// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/my-work/my-work.merged.integration.test.ts
// My Work, mark-done, focus and SSE ids on the merged `cards` table (single-table merge, T12).
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPublishEvent, mockCurrentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	mockCurrentUser: {
		id: 72001,
		username: "t12-alice",
		displayName: "Alice",
		email: "t12-alice@example.test",
		emailVerified: true,
		needsUsername: false,
	},
}));

vi.mock("../../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../../realtime.js", () => ({
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

import { db } from "../../db/kysely.js";
import { pool } from "../../db/pool.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { api } from "../../routes.js";
import {
	buildReadySessionInput,
	createFocusSessionRepo,
} from "../focus/index.js";

const ALICE = 72001;
const BOB = 72002;
const WS = 72011;

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);
app.use(createErrorHandler());

type Ids = {
	boardId: number;
	trackerId: number;
	bobOnlyId: number;
	statusDone: number;
	labelId: number;
};

async function cleanup() {
	await pool.query("DELETE FROM focus_sessions WHERE workspace_id = $1", [WS]);
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [WS]);
	await pool.query(
		"DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[WS],
	);
	await pool.query(
		"DELETE FROM card_assignees WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[WS],
	);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WS]);
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [WS]);
	await pool.query(
		"DELETE FROM tracker_item_assignees WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[WS],
	);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [WS]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [WS]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WS,
	]);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WS,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WS]);
	await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [ALICE, BOB]);
}

async function seed(): Promise<Ids> {
	await cleanup();
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
		 VALUES ($1, 't12-alice', 'Alice', 'x'), ($2, 't12-bob', 'Bob', 'x')`,
		[ALICE, BOB],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal, tracker_key_counter)
		 VALUES ($1, 'Merge', $2, false, 10)`,
		[WS, ALICE],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
		 VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
		[WS, ALICE, BOB],
	);
	const vocab = await pool.query<{ id: number; slot: string | null }>(
		`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, category, slot)
		 VALUES ($1, 'status', 'Backlog', 1024, 'blue', 'backlog', 'backlog'),
		        ($1, 'status', 'In Progress', 2048, 'blue', 'started', 'in_progress'),
		        ($1, 'status', 'Done', 3072, 'blue', 'completed', 'done'),
		        ($1, 'label', 'Urgent', 4096, 'red', NULL, NULL)
		 RETURNING id, slot`,
		[WS],
	);
	const bySlot = new Map(vocab.rows.map((r) => [r.slot, r.id]));
	const labelId = vocab.rows.find((r) => r.slot === null)!.id;
	const col = await pool.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
		 VALUES ($1, 'Todo', 1024, false), ($1, 'Done', 2048, true) RETURNING id`,
		[WS],
	);
	const todo = col.rows[0]!.id;
	const insert = async (
		columnId: number | null,
		key: number,
		title: string,
		statusId: number,
	) =>
		(
			await pool.query<{ id: number }>(
				`INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number)
				 VALUES ($1, $2, $3, 1024, $4, $5) RETURNING id`,
				[WS, columnId, title, statusId, key],
			)
		).rows[0]!.id;
	const boardId = await insert(todo, 1, "Board work", bySlot.get("backlog")!);
	const trackerId = await insert(
		null,
		2,
		"Tracker work",
		bySlot.get("in_progress")!,
	);
	const bobOnlyId = await insert(
		null,
		3,
		"Bob only",
		bySlot.get("in_progress")!,
	);
	await pool.query(
		`INSERT INTO card_assignees (card_id, user_id)
		 VALUES ($1, $3), ($2, $3), ($2, $4), ($5, $4)`,
		[boardId, trackerId, ALICE, BOB, bobOnlyId],
	);
	await pool.query(
		"INSERT INTO card_labels (card_id, vocabulary_id) VALUES ($1, $2)",
		[trackerId, labelId],
	);
	// Decoy legacy rows: if My Work still read the tracker tables it would list this.
	const decoy = await pool.query<{ id: number }>(
		`INSERT INTO tracker_items (workspace_id, key_number, title, description, status_id, position)
		 VALUES ($1, 9, 'Legacy decoy', '', $2, 1024) RETURNING id`,
		[WS, bySlot.get("in_progress")!],
	);
	await pool.query(
		"INSERT INTO tracker_item_assignees (tracker_item_id, user_id) VALUES ($1, $2)",
		[decoy.rows[0]!.id, ALICE],
	);
	return {
		boardId,
		trackerId,
		bobOnlyId,
		statusDone: bySlot.get("done")!,
		labelId,
	};
}

type Listed = {
	id: number;
	title: string;
	identity: { workspaceId: number; source: string; key: string };
	assignees: Array<{ id: number }>;
	labels: Array<{ name: string }>;
};

let ids: Ids;

const itRun = describe.skipIf(!process.env.RUN_INTEGRATION);

itRun("My Work on the merged table", () => {
	beforeEach(async () => {
		ids = await seed();
		mockPublishEvent.mockClear();
	});

	afterAll(async () => {
		await cleanup();
		await pool.end();
	});

	// Cycle 1 — list and detail.
	it("lists merged items once with source derived from column_id", async () => {
		const res = await request(app).get(`/api/my-work?scope=active`);
		expect(res.status).toBe(200);
		const items = (res.body.items as Listed[]).filter(
			(i) => i.identity.workspaceId === WS,
		);
		expect(
			items.map((i) => i.identity).sort((a, b) => (a.key < b.key ? -1 : 1)),
		).toEqual([
			{ workspaceId: WS, source: "board", key: "ME-1" },
			{ workspaceId: WS, source: "tracker", key: "ME-2" },
		]);
		const tracker = items.find((i) => i.identity.source === "tracker")!;
		expect(tracker.id).toBe(ids.trackerId);
		expect(tracker.assignees.map((a) => a.id).sort()).toEqual([ALICE, BOB]);
		expect(tracker.labels.map((l) => l.name)).toEqual(["Urgent"]);
		expect(items.find((i) => i.identity.source === "board")!.id).toBe(
			ids.boardId,
		);
		expect(items.map((i) => i.title)).not.toContain("Legacy decoy");
		expect(items.map((i) => i.title)).not.toContain("Bob only");
	});

	it("loads tracker detail by key from the merged table", async () => {
		const res = await request(app).get(`/api/my-work/${WS}/tracker/ME-2`);
		expect(res.status).toBe(200);
		expect(res.body.id).toBe(ids.trackerId);
		expect(res.body.assignees).toHaveLength(2);
		expect(res.body.labels.map((l: { name: string }) => l.name)).toEqual([
			"Urgent",
		]);
		const decoy = await request(app).get(`/api/my-work/${WS}/tracker/ME-9`);
		expect(decoy.status).toBe(404);
		const bobOnly = await request(app).get(`/api/my-work/${WS}/tracker/ME-3`);
		expect(bobOnly.status).toBe(404);
	});

	it("marks a column-less item done on cards with version++ and writes no tracker rows", async () => {
		const before = (
			await pool.query("SELECT version, status_id FROM cards WHERE id = $1", [
				ids.trackerId,
			])
		).rows[0];
		const res = await request(app)
			.post(`/api/my-work/${WS}/tracker/ME-2/done`)
			.send({ version: before.version });
		expect(res.status).toBe(200);
		const after = (
			await pool.query(
				"SELECT version, status_id, column_id FROM cards WHERE id = $1",
				[ids.trackerId],
			)
		).rows[0];
		expect(after.status_id).toBe(ids.statusDone);
		expect(after.version).toBe(before.version + 1);
		expect(after.column_id).toBeNull();
		const legacy = await pool.query(
			"SELECT (SELECT count(*) FROM tracker_events WHERE workspace_id = $1)::int AS ev, (SELECT count(*) FROM tracker_items WHERE workspace_id = $1 AND key_number = 2)::int AS items",
			[WS],
		);
		expect(legacy.rows[0]).toEqual({ ev: 0, items: 0 });
		expect(mockPublishEvent).toHaveBeenCalledWith(
			WS,
			expect.objectContaining({
				type: "tracker.updated",
				trackerItemId: ids.trackerId,
			}),
		);
	});

	it("rejects a stale mark-done version with 409 and leaves the card untouched", async () => {
		const before = (
			await pool.query("SELECT version, status_id FROM cards WHERE id = $1", [
				ids.trackerId,
			])
		).rows[0];
		await pool.query("UPDATE cards SET version = version + 1 WHERE id = $1", [
			ids.trackerId,
		]);
		const res = await request(app)
			.post(`/api/my-work/${WS}/tracker/ME-2/done`)
			.send({ version: before.version });
		expect(res.status).toBe(409);
		expect(res.body.code).toBe("version_conflict");
		const after = (
			await pool.query("SELECT version, status_id FROM cards WHERE id = $1", [
				ids.trackerId,
			])
		).rows[0];
		expect(after).toEqual({
			version: before.version + 1,
			status_id: before.status_id,
		});
	});
	// Cycle 2 — focus sessions and SSE carry the new id.
	it("resolves a migrated focus task from cards where column_id IS NULL", async () => {
		const repo = createFocusSessionRepo(db);
		const task = await repo.findTask("tracker", ids.trackerId, WS);
		expect(task).toEqual({
			id: ids.trackerId,
			keyNumber: 2,
			title: "Tracker work",
			workspaceName: "Merge",
		});
		expect(await repo.findTask("tracker", ids.boardId, WS)).toBeNull();
		expect(await repo.findTask("board", ids.trackerId, WS)).toBeNull();
		await pool.query("UPDATE cards SET deleted_at = now() WHERE id = $1", [
			ids.trackerId,
		]);
		expect(await repo.findTask("tracker", ids.trackerId, WS)).toBeNull();
	});

	it("keeps the /tracker/<key> return path for a tracker focus task", async () => {
		const task = await createFocusSessionRepo(db).findTask(
			"tracker",
			ids.trackerId,
			WS,
		);
		const input = buildReadySessionInput({
			userId: ALICE,
			workspaceId: WS,
			source: "tracker",
			taskId: ids.trackerId,
			task: task!,
		});
		expect(input).toMatchObject({
			task_source: "tracker",
			task_id: ids.trackerId,
			task_key: "ME-2",
			return_path: "/tracker/ME-2",
		});
	});

	it("keeps an active tracker focus session alive on load instead of auto-finishing it", async () => {
		await pool.query(
			`INSERT INTO focus_sessions
			   (user_id, workspace_id, task_source, task_id, task_key, return_path, state)
			 VALUES ($1, $2, 'tracker', $3, 'ME-2', '/tracker/ME-2', 'ready')`,
			[ALICE, WS, ids.trackerId],
		);
		const res = await request(app).get(`/api/workspaces/${WS}/focus-session`);
		expect(res.status).toBe(200);
		expect(res.body.session).toMatchObject({
			state: "ready",
			source: "tracker",
			taskId: ids.trackerId,
			returnPath: "/tracker/ME-2",
		});
	});

	it("publishes the card id as trackerItemId for every Tracker write route", async () => {
		const base = `/api/workspaces/${WS}/tracker/items`;
		const published = () =>
			mockPublishEvent.mock.calls.map(([, event]) => ({
				type: event.type,
				trackerItemId: event.trackerItemId,
			}));
		const title = await request(app)
			.patch(`${base}/ME-2`)
			.send({ title: "Renamed" });
		expect(title.status).toBe(200);
		expect(published()).toContainEqual({
			type: "tracker.updated",
			trackerItemId: ids.trackerId,
		});
		mockPublishEvent.mockClear();
		const status = await request(app)
			.patch(`${base}/ME-2`)
			.send({ statusId: ids.statusDone });
		expect(status.status).toBe(200);
		expect(published()).toContainEqual({
			type: "tracker.updated",
			trackerItemId: ids.trackerId,
		});
		mockPublishEvent.mockClear();
		const created = await request(app)
			.post(base)
			.send({ title: "Created via route" });
		expect(created.status).toBe(201);
		const createdCard = await pool.query<{
			id: number;
			column_id: number | null;
		}>(
			"SELECT id, column_id FROM cards WHERE workspace_id = $1 AND title = 'Created via route'",
			[WS],
		);
		expect(createdCard.rows[0]!.column_id).toBeNull();
		expect(published()).toContainEqual({
			type: "tracker.created",
			trackerItemId: createdCard.rows[0]!.id,
		});
		mockPublishEvent.mockClear();
		const removed = await request(app).delete(`${base}/ME-2`);
		expect(removed.status).toBeLessThan(300);
		expect(published()).toContainEqual({
			type: "tracker.deleted",
			trackerItemId: ids.trackerId,
		});
	});
});
