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
	started_at: string | null;
	done_at: string | null;
};

async function cleanup() {
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

async function addCard(columnId: number, statusSlot: string, version = 1) {
	const result = await pool.query<{ id: number }>(
		`INSERT INTO cards (workspace_id, column_id, title, position, status_id, version)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		[
			WORKSPACE_ID,
			columnId,
			`Card ${statusSlot}`,
			version * 100,
			await statusId(statusSlot),
			version,
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

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${doing}`)
				.send({ isDone: true });

			expect(response.status).toBe(200);
			expect((await readCard(doingCard)).status_id).toBe(
				await statusId("done"),
			);
			expect((await readCard(finishedCard)).status_id).toBe(
				await statusId("todo"),
			);
			expect((await readCard(doingCard)).column_id).toBe(doing);
			expect((await readCard(finishedCard)).column_id).toBe(finished);
			expect((await readCard(doingCard)).version).toBe(2);
			expect((await readCard(finishedCard)).version).toBe(2);
			expect((await readCard(doingCard)).done_at).not.toBeNull();
			expect((await readCard(finishedCard)).done_at).toBeNull();
			expect(
				(await columns()).find((column) => column.id === inbox)?.is_done,
			).toBe(false);
			expect(mockPublishEvent.mock.calls.map((call) => call[1].type)).toEqual([
				"card.updated",
				"card.updated",
				"column.updated",
			]);
			const events = await pool.query<{ card_id: number | null }>(
				"SELECT card_id FROM card_events WHERE workspace_id = $1 ORDER BY id",
				[WORKSPACE_ID],
			);
			expect(events.rows.filter((row) => row.card_id !== null)).toHaveLength(2);
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
			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${finished}`)
				.send({ isDone: false });

			expect(response.status).toBe(200);
			expect((await readCard(cardId)).status_id).toBe(await statusId("todo"));
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
			 VALUES ($1, 'Inbox', 1000, false), ($1, 'Done', 2000, true)
			 RETURNING id, position`,
				[WORKSPACE_ID],
			);
			const [inbox, done] = inserted.rows
				.sort((left, right) => left.position - right.position)
				.map((row) => row.id);
			const unchanged = await addCard(inbox, "backlog");
			const deleted = await addCard(done, "done");
			await pool.query("UPDATE cards SET deleted_at = now() WHERE id = $1", [
				deleted,
			]);

			const response = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${inbox}`)
				.send({ isDone: true });

			expect(response.status).toBe(200);
			expect((await readCard(unchanged)).version).toBe(1);
			expect((await readCard(deleted)).version).toBe(1);
			expect(mockPublishEvent).toHaveBeenCalledTimes(1);
		});

		it("appends columns without remapping and leaves metadata patches status-neutral", async () => {
			const original = await pool.query<{ id: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false) RETURNING id`,
				[WORKSPACE_ID],
			);
			const cardId = await addCard(original.rows[0].id, "backlog");
			const created = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/columns`)
				.send({ title: "Doing" });
			expect(created.status).toBe(201);
			expect(created.body.position).toBeGreaterThan(1000);
			expect((await readCard(cardId)).version).toBe(1);

			const patch = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${original.rows[0].id}`)
				.send({ title: "Renamed", color: "oklch(88% 0.09 47.3)", wipLimit: 3 });
			expect(patch.status).toBe(200);
			expect((await readCard(cardId)).version).toBe(1);
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

			await cleanup();
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

		it("does not publish events when activity failure rolls the transaction back", async () => {
			const column = await pool.query<{ id: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
			 VALUES ($1, 'Inbox', 1000, false) RETURNING id`,
				[WORKSPACE_ID],
			);
			const spy = vi
				.spyOn(routeHelpers, "recordActivity")
				.mockImplementationOnce(async () => {
					throw new Error("injected transaction failure");
				});
			try {
				const response = await request(app)
					.patch(`/api/workspaces/${WORKSPACE_ID}/columns/${column.rows[0].id}`)
					.send({ isDone: true });
				expect(response.status).toBe(500);
				expect(mockPublishEvent).not.toHaveBeenCalled();
				expect(
					(await columns()).find((row) => row.id === column.rows[0].id)
						?.is_done,
				).toBe(false);
			} finally {
				spy.mockRestore();
			}
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
		});
	},
);
