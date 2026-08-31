// Integration coverage for transactional column is_done remapping.
// Requires PostgreSQL and is intentionally gated for the normal fast test path.
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
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
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
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";
import * as routeHelpers from "./helpers.js";

const WORKSPACE_ID = 98;

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createTestApp();

type ColumnRow = {
	id: number;
	title: string;
	position: number;
	is_done: boolean;
};
type CardRow = {
	id: number;
	column_id: number;
	status_id: number | null;
	version: number;
	started_at: Date | null;
	done_at: Date | null;
};
type ActivityRow = {
	card_id: number | null;
	event_type: string;
	payload: Record<string, unknown>;
};

async function cleanup() {
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
}

async function setup() {
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
		 VALUES ($1, 'Column Remap Test', $2, false)
		 ON CONFLICT (id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
		 VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[WORKSPACE_ID, mockTestUser.id],
	);
	await cleanup();
	for (const [name, slot, position] of [
		["Backlog", "backlog", 1024],
		["Todo", "todo", 2048],
		["In Progress", "in_progress", 3072],
		["Done", "done", 4096],
		["Canceled", "canceled", 5120],
	] as const) {
		await pool.query(
			`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot)
			 VALUES ($1, 'status', $2, $3, 'neutral', $4)`,
			[WORKSPACE_ID, name, position, slot],
		);
	}
}

async function columns() {
	const result = await pool.query<ColumnRow>(
		"SELECT id, title, position, is_done FROM columns WHERE workspace_id = $1 ORDER BY position",
		[WORKSPACE_ID],
	);
	return result.rows;
}

async function statusId(slot: string) {
	const result = await pool.query<{ id: number }>(
		"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND slot = $2",
		[WORKSPACE_ID, slot],
	);
	return result.rows[0].id;
}

async function addCard(
	columnId: number,
	statusSlot: string,
	version = 1,
	startedAt: string | null = null,
	doneAt: string | null = null,
) {
	const result = await pool.query<{ id: number }>(
		`INSERT INTO cards (workspace_id, column_id, title, position, status_id, version, started_at, done_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		[
			WORKSPACE_ID,
			columnId,
			`Card ${statusSlot}`,
			version * 100,
			await statusId(statusSlot),
			version,
			startedAt,
			doneAt,
		],
	);
	return result.rows[0].id;
}

async function readCard(id: number) {
	const result = await pool.query<CardRow>(
		"SELECT id, column_id, status_id, version, started_at, done_at FROM cards WHERE id = $1",
		[id],
	);
	return result.rows[0];
}

async function cardActivities(cardIds: number[]) {
	const result = await pool.query<ActivityRow>(
		`SELECT card_id, event_type, payload
		 FROM card_events
		 WHERE workspace_id = $1 AND card_id = ANY($2::int[])
		 ORDER BY id`,
		[WORKSPACE_ID, cardIds],
	);
	return result.rows;
}

async function trackerEventCount() {
	const result = await pool.query<{ count: string }>(
		"SELECT count(*)::text AS count FROM tracker_events WHERE workspace_id = $1",
		[WORKSPACE_ID],
	);
	return Number(result.rows[0].count);
}

beforeEach(async () => {
	await setup();
	vi.clearAllMocks();
});
afterEach(cleanup);
afterAll(async () => {
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"column is_done remapping",
	() => {
		it("swaps live card status slots, versions, timestamps, and activity in place", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false), ($1, 'Doing', 2000, false), ($1, 'Finished', 3000, true)
			 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [inbox, doing, finished] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const doingCard = await addCard(doing, "todo");
			const finishedCard = await addCard(finished, "done");
			const todoId = await statusId("todo");
			const doneId = await statusId("done");
			const beforeUpdate = Date.now();

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${doing}`)
				.send({ isDone: true });

			expect(response.status).toBe(200);
			expect(response.body).toEqual({
				id: doing,
				title: "Doing",
				position: 2000,
				wip_limit: null,
				policy: "",
				is_done: true,
				is_signable: false,
				signable_assignee_id: null,
				color: null,
			});
			expect((await readCard(doingCard)).status_id).toBe(doneId);
			expect((await readCard(finishedCard)).status_id).toBe(todoId);
			expect((await readCard(doingCard)).column_id).toBe(doing);
			expect((await readCard(finishedCard)).column_id).toBe(finished);
			expect((await readCard(doingCard)).version).toBe(2);
			expect((await readCard(finishedCard)).version).toBe(2);
			const doingAfter = await readCard(doingCard);
			const finishedAfter = await readCard(finishedCard);
			expect(doingAfter.column_id).toBe(doing);
			expect(finishedAfter.column_id).toBe(finished);
			expect(doingAfter.version).toBe(2);
			expect(finishedAfter.version).toBe(2);
			expect(doingAfter.done_at).not.toBeNull();
			expect(finishedAfter.done_at).toBeNull();
			expect(doingAfter.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(finishedAfter.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(
				(await columns()).find((column) => column.id === inbox)?.is_done,
			).toBe(false);

			const published = mockPublishEvent.mock.calls.map((call) => call[1]);
			expect(published.slice(0, 2)).toEqual([
				{
					type: "card.updated",
					actor: mockTestUser,
					cardId: doingCard,
					payload: {
						columnId: doing,
						statusId: doneId,
						version: 2,
						startedAt: doingAfter.started_at?.toISOString(),
						doneAt: doingAfter.done_at?.toISOString(),
					},
				},
				{
					type: "card.updated",
					actor: mockTestUser,
					cardId: finishedCard,
					payload: {
						columnId: finished,
						statusId: todoId,
						version: 2,
						startedAt: finishedAfter.started_at?.toISOString(),
						doneAt: null,
					},
				},
			]);
			expect(published[2]).toEqual({
				type: "column.updated",
				actor: mockTestUser,
				payload: {
					columnTitle: "Doing",
					isDone: true,
					isSignable: false,
					signableAssigneeId: null,
					color: null,
				},
			});
			expect(published.map((event) => event.type)).toEqual([
				"card.updated",
				"card.updated",
				"column.updated",
			]);
			expect(await cardActivities([doingCard, finishedCard])).toEqual([
				{
					card_id: doingCard,
					event_type: "update",
					payload: { changed: ["status"], statusId: doneId },
				},
				{
					card_id: finishedCard,
					event_type: "update",
					payload: { changed: ["status"], statusId: todoId },
				},
			]);
			expect(await trackerEventCount()).toBe(0);
		});

		it("preserves null timestamps when a first column leaves Done", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
				 VALUES ($1, 'Finished', 1000, true), ($1, 'Todo', 2000, false)
				 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [finished, todo] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const cardId = await addCard(finished, "done");
			const backlogId = await statusId("backlog");

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${finished}`)
				.send({ isDone: false });

			expect(response.status).toBe(200);
			expect((await readCard(cardId)).status_id).toBe(backlogId);
			expect((await readCard(cardId)).version).toBe(2);
			expect((await readCard(cardId)).started_at).toBeNull();
			expect((await readCard(cardId)).done_at).toBeNull();
			expect(await cardActivities([cardId])).toEqual([
				{
					card_id: cardId,
					event_type: "update",
					payload: { changed: ["status"], statusId: backlogId },
				},
			]);
			expect(mockPublishEvent.mock.calls[0][1]).toMatchObject({
				type: "card.updated",
				cardId,
				payload: {
					columnId: finished,
					statusId: backlogId,
					version: 2,
					startedAt: null,
					doneAt: null,
				},
			});
			expect(todo).toBeGreaterThan(finished);
			expect(await trackerEventCount()).toBe(0);
		});

		it("starts a preexisting-done card when leaving a non-first Done column", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
				 VALUES ($1, 'Inbox', 1000, false), ($1, 'Finished', 2000, true)
				 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [, finished] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const cardId = await addCard(finished, "done");
			const todoId = await statusId("todo");
			const beforeUpdate = Date.now();

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${finished}`)
				.send({ isDone: false });

			expect(response.status).toBe(200);
			const card = await readCard(cardId);
			expect(card.status_id).toBe(todoId);
			expect(card.version).toBe(2);
			expect(card.started_at).not.toBeNull();
			expect(card.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(card.done_at).toBeNull();
			expect(await cardActivities([cardId])).toHaveLength(1);
			expect(mockPublishEvent.mock.calls[0][1]).toMatchObject({
				type: "card.updated",
				cardId,
				payload: {
					columnId: finished,
					statusId: todoId,
					version: 2,
					doneAt: null,
				},
			});
			expect(await trackerEventCount()).toBe(0);
		});

		it("keeps preexisting timestamps when a card enters Done", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
				 VALUES ($1, 'Inbox', 1000, false), ($1, 'Doing', 2000, false)
				 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [, doing] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const startedAt = "2026-01-02T03:04:05.000Z";
			const doneAt = "2026-01-03T03:04:05.000Z";
			const cardId = await addCard(doing, "todo", 7, startedAt, doneAt);
			const doneId = await statusId("done");

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${doing}`)
				.send({ isDone: true });

			expect(response.status).toBe(200);
			const card = await readCard(cardId);
			expect(card.status_id).toBe(doneId);
			expect(card.version).toBe(8);
			expect(card.started_at?.toISOString()).toBe(startedAt);
			expect(card.done_at?.toISOString()).toBe(doneAt);
			expect(mockPublishEvent.mock.calls[0][1]).toMatchObject({
				type: "card.updated",
				cardId,
				payload: {
					columnId: doing,
					statusId: doneId,
					version: 8,
					startedAt,
					doneAt,
				},
			});
		});

		it("clears the last Done column and remaps according to final geometry", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false), ($1, 'Finished', 2000, true)
			 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [inbox, finished] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const cardId = await addCard(finished, "done");
			const todoId = await statusId("todo");
			const beforeUpdate = Date.now();
			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${finished}`)
				.send({ isDone: false });

			expect(response.status).toBe(200);
			expect(response.body).toMatchObject({
				id: finished,
				title: "Finished",
				position: 2000,
				is_done: false,
			});
			const card = await readCard(cardId);
			expect(card.status_id).toBe(todoId);
			expect(card.version).toBe(2);
			expect(card.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(card.done_at).toBeNull();
			expect(await cardActivities([cardId])).toEqual([
				{
					card_id: cardId,
					event_type: "update",
					payload: { changed: ["status"], statusId: todoId },
				},
			]);
			expect(mockPublishEvent.mock.calls.map((call) => call[1].type)).toEqual([
				"card.updated",
				"column.updated",
			]);
			expect(await trackerEventCount()).toBe(0);
			expect(
				(await columns()).find((column) => column.id === inbox)?.is_done,
			).toBe(false);
			expect(
				(await columns()).find((column) => column.id === finished)?.is_done,
			).toBe(false);
		});

		it("does not bump unchanged cards and preserves soft-deleted cards", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES
				($1, 'Inbox', 1000, false),
				($1, 'Doing', 2000, false),
				($1, 'Review', 3000, false),
				($1, 'Finished', 4000, true),
				($1, 'Archive', 5000, false)
			 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [inbox, , , done, stable] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const unchanged = await addCard(stable, "in_progress");
			const deleted = await addCard(done, "done");
			await pool.query("UPDATE cards SET deleted_at = now() WHERE id = $1", [
				deleted,
			]);

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${inbox}`)
				.send({ isDone: true });

			expect(response.status).toBe(200);
			expect((await readCard(unchanged)).status_id).toBe(
				await statusId("in_progress"),
			);
			expect((await readCard(unchanged)).version).toBe(1);
			expect((await readCard(deleted)).version).toBe(1);
			expect((await readCard(deleted)).status_id).toBe(await statusId("done"));
			expect(await cardActivities([unchanged, deleted])).toEqual([]);
			expect(mockPublishEvent.mock.calls.map((call) => call[1].type)).toEqual([
				"column.updated",
			]);
			expect(await trackerEventCount()).toBe(0);
		});

		it("appends columns without remapping and leaves metadata patches status-neutral", async () => {
			const original = await pool.query<{ id: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false) RETURNING id`,
				[WORKSPACE_ID],
			);
			const cardId = await addCard(original.rows[0].id, "backlog");
			const backlogId = await statusId("backlog");
			const created = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/columns`)
				.send({ title: "Doing" });
			expect(created.status).toBe(201);
			expect(created.body.position).toBeGreaterThan(1000);
			expect((await readCard(cardId)).version).toBe(1);

			for (const body of [
				{ title: "Title update" },
				{ color: "oklch(88% 0.09 47.3)" },
				{ wipLimit: 3 },
				{ title: "Renamed" },
			]) {
				const patch = await request(app)
					.patch(
						`/api/workspaces/${WORKSPACE_ID}/columns/${original.rows[0].id}`,
					)
					.send(body);
				expect(patch.status).toBe(200);
				const card = await readCard(cardId);
				expect(card.status_id).toBe(backlogId);
				expect(card.version).toBe(1);
			}
			expect(await cardActivities([cardId])).toEqual([]);
			expect(await trackerEventCount()).toBe(0);
		});

		it("keeps append-right overlays unchanged for Inbox and Finished boards", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false), ($1, 'Finished', 2000, true)
			 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [inbox, finished] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const inboxCard = await addCard(inbox, "backlog");
			const finishedCard = await addCard(finished, "done");
			const blocked = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/columns`)
				.send({ title: "Blocked" });
			expect(blocked.status).toBe(201);
			expect((await readCard(inboxCard)).status_id).toBe(
				await statusId("backlog"),
			);
			expect((await readCard(finishedCard)).status_id).toBe(
				await statusId("done"),
			);

			await setup();
			const single = await pool.query<{ id: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false) RETURNING id`,
				[WORKSPACE_ID],
			);
			const singleCard = await addCard(single.rows[0].id, "backlog");
			const doing = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/columns`)
				.send({ title: "Doing" });
			expect(doing.status).toBe(201);
			expect((await readCard(singleCard)).status_id).toBe(
				await statusId("backlog"),
			);
		});

		it("rejects a stale card patch after a remap", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false), ($1, 'Done', 2000, true)
			 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [inbox, done] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const cardId = await addCard(done, "done");
			await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${inbox}`)
				.send({ isDone: true });
			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${cardId}`)
				.send({ title: "stale", version: 1 });
			expect(response.status).toBe(409);
		});

		it("rolls back card, activity, column, and publish state after mutation", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false), ($1, 'Finished', 2000, true)
			 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [inbox, finished] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const cardId = await addCard(inbox, "backlog");
			const beforeCard = await readCard(cardId);
			const beforeColumns = await columns();
			const beforeActivities = await cardActivities([cardId]);
			const original = routeHelpers.recordActivity;
			const spy = vi
				.spyOn(routeHelpers, "recordActivity")
				.mockImplementationOnce(async (...args) => {
					await original(...args);
					throw new Error("injected transaction failure after activity");
				});
			try {
				const response = await request(app)
					.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${inbox}`)
					.send({ isDone: true });
				expect(response.status).toBe(500);
				expect(await readCard(cardId)).toEqual(beforeCard);
				expect(await columns()).toEqual(beforeColumns);
				expect(await cardActivities([cardId])).toEqual(beforeActivities);
				expect(await trackerEventCount()).toBe(0);
				expect(mockPublishEvent).not.toHaveBeenCalled();
			} finally {
				spy.mockRestore();
			}
			expect(finished).toBeGreaterThan(inbox);
		});

		it("serializes concurrent true/false changes on the workspace row", async () => {
			const inserted = await pool.query<{ id: number; position: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'A', 1000, false), ($1, 'B', 2000, false)
			 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [a, b] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const aCard = await addCard(a, "backlog");
			const bCard = await addCard(b, "todo");
			const doneId = await statusId("done");
			const backlogId = await statusId("backlog");
			const beforeUpdate = Date.now();
			const responses = await Promise.all([
				request(app)
					.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${a}`)
					.send({ isDone: true }),
				request(app)
					.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${b}`)
					.send({ isDone: false }),
			]);
			expect(responses.every((response) => response.status === 200)).toBe(true);
			const doneColumns = (await columns()).filter((column) => column.is_done);
			expect(doneColumns).toHaveLength(1);
			expect(doneColumns[0].id).toBe(a);

			const finalA = await readCard(aCard);
			const finalB = await readCard(bCard);
			expect(finalA).toMatchObject({
				column_id: a,
				status_id: doneId,
				version: 2,
				done_at: expect.any(Date),
			});
			expect(finalB).toMatchObject({
				column_id: b,
				status_id: backlogId,
				version: 2,
				started_at: expect.any(Date),
				done_at: null,
			});
			expect(finalA.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			expect(finalB.started_at?.getTime()).toBeGreaterThanOrEqual(
				beforeUpdate - 1000,
			);
			const activities = await cardActivities([aCard, bCard]);
			expect(activities).toHaveLength(2);
			expect(activities.map((event) => event.card_id)).toEqual([aCard, bCard]);
			expect(await trackerEventCount()).toBe(0);

			const published = mockPublishEvent.mock.calls.map((call) => call[1]);
			expect(
				published.filter((event) => event.type === "card.updated"),
			).toEqual(
				expect.arrayContaining([
					{
						type: "card.updated",
						actor: mockTestUser,
						cardId: aCard,
						payload: {
							columnId: a,
							statusId: doneId,
							version: 2,
							startedAt: finalA.started_at?.toISOString(),
							doneAt: finalA.done_at?.toISOString(),
						},
					},
					{
						type: "card.updated",
						actor: mockTestUser,
						cardId: bCard,
						payload: {
							columnId: b,
							statusId: backlogId,
							version: 2,
							startedAt: finalB.started_at?.toISOString(),
							doneAt: null,
						},
					},
				]),
			);
			expect(
				published.filter((event) => event.type === "column.updated"),
			).toHaveLength(2);
		});
	},
);
