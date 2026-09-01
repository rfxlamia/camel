// server/src/routes/work-item-unified.integration.test.ts
// Run: RUN_INTEGRATION=1 npm run test -- server/src/routes/work-item-unified.integration.test.ts
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

const { mockPublishEvent, mockCurrentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	mockCurrentUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));
vi.mock("../realtime.js", () => ({
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

import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

const WORKSPACE_ID = 991;

type ColumnFixture = {
	backlogId: number;
	todoId: number;
	inProgressId: number;
	reviewId: number;
	doneId: number;
};

type StatusFixture = {
	backlogId: number;
	todoId: number;
	inProgressId: number;
	doneId: number;
	canceledId: number;
};

function createApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createApp();

async function resetWorkspace() {
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)", [WORKSPACE_ID]);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);

	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
		[
			mockCurrentUser.id,
			mockCurrentUser.username,
			mockCurrentUser.displayName,
			"hashed",
		],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal, tracker_key_counter)
     VALUES ($1, 'Test Enterprise', $2, false, 0)`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot)
     VALUES
       ($1, 'status', 'Backlog', 1024, 'blue', 'backlog'),
       ($1, 'status', 'Todo', 2048, 'blue', 'todo'),
       ($1, 'status', 'In Progress', 3072, 'blue', 'in_progress'),
       ($1, 'status', 'Done', 4096, 'blue', 'done'),
       ($1, 'status', 'Canceled', 5120, 'blue', 'canceled')`,
		[WORKSPACE_ID],
	);
	const inbox = await pool.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
     VALUES ($1, 'Requested', 1024, false) RETURNING id`,
		[WORKSPACE_ID],
	);
	await pool.query(
		`INSERT INTO columns (workspace_id, title, position, is_done)
     VALUES ($1, 'Finished', 2048, true)`,
		[WORKSPACE_ID],
	);
	return inbox.rows[0]!.id;
}

async function resetWorkspaceMultiColumn(): Promise<{
	columns: ColumnFixture;
	statuses: StatusFixture;
}> {
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query(
		"DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[WORKSPACE_ID],
	);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);

	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
		[
			mockCurrentUser.id,
			mockCurrentUser.username,
			mockCurrentUser.displayName,
			"hashed",
		],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal, tracker_key_counter)
     VALUES ($1, 'Test Enterprise', $2, false, 0)`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot)
     VALUES
       ($1, 'status', 'Backlog', 1024, 'blue', 'backlog'),
       ($1, 'status', 'Todo', 2048, 'blue', 'todo'),
       ($1, 'status', 'In Progress', 3072, 'blue', 'in_progress'),
       ($1, 'status', 'Done', 4096, 'blue', 'done'),
       ($1, 'status', 'Canceled', 5120, 'blue', 'canceled')`,
		[WORKSPACE_ID],
	);

	const backlog = await pool.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
     VALUES ($1, 'Requested', 1024, false) RETURNING id`,
		[WORKSPACE_ID],
	);
	const todo = await pool.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
     VALUES ($1, 'Ready', 2048, false) RETURNING id`,
		[WORKSPACE_ID],
	);
	const inProgress = await pool.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done, wip_limit)
     VALUES ($1, 'In Progress', 3072, false, 1) RETURNING id`,
		[WORKSPACE_ID],
	);
	const review = await pool.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
     VALUES ($1, 'In Review', 4096, false) RETURNING id`,
		[WORKSPACE_ID],
	);
	const done = await pool.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
     VALUES ($1, 'Finished', 5120, true) RETURNING id`,
		[WORKSPACE_ID],
	);

	const statuses = await pool.query<{ id: number; slot: string }>(
		`SELECT id, slot FROM tracker_vocabularies
     WHERE workspace_id = $1 AND kind = 'status'`,
		[WORKSPACE_ID],
	);
	const statusBySlot = Object.fromEntries(
		statuses.rows.map((row) => [row.slot, row.id]),
	) as Record<string, number>;

	return {
		columns: {
			backlogId: backlog.rows[0]!.id,
			todoId: todo.rows[0]!.id,
			inProgressId: inProgress.rows[0]!.id,
			reviewId: review.rows[0]!.id,
			doneId: done.rows[0]!.id,
		},
		statuses: {
			backlogId: statusBySlot.backlog!,
			todoId: statusBySlot.todo!,
			inProgressId: statusBySlot.in_progress!,
			doneId: statusBySlot.done!,
			canceledId: statusBySlot.canceled!,
		},
	};
}

async function createBoardCard(columnId: number, title: string) {
	const createRes = await request(app)
		.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
		.send({ columnId, title });
	expect(createRes.status).toBe(201);
	return createRes.body as {
		key: string;
		version: number;
		columnId: number;
		status?: { id: number };
	};
}

async function patchBoardStatus(
	key: string,
	statusId: number,
	version: number,
	pathPrefix: "tracker/items" | "work-items" = "tracker/items",
) {
	return request(app)
		.patch(`/api/workspaces/${WORKSPACE_ID}/${pathPrefix}/${key}`)
		.send({ statusId, version });
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"unified work item list",
	() => {
		let inboxColumnId: number;

		beforeEach(async () => {
			inboxColumnId = await resetWorkspace();
		});

		afterAll(async () => {
			await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
		});

		it("lists board cards in GET /tracker/items with source=board", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId: inboxColumnId, title: "ppo" });
			expect(createRes.status).toBe(201);
			const cardKey = createRes.body.key as string;
			expect(cardKey).toBeTruthy();

			const listRes = await request(app).get(
				`/api/workspaces/${WORKSPACE_ID}/tracker/items`,
			);
			expect(listRes.status).toBe(200);
			const match = listRes.body.find(
				(item: { key: string }) => item.key === cardKey,
			);
			expect(match).toMatchObject({
				key: cardKey,
				source: "board",
				title: "ppo",
			});
		});

		it("lists board cards in GET /work-items with source=board", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId: inboxColumnId, title: "via work-items" });
			const cardKey = createRes.body.key as string;

			const listRes = await request(app).get(
				`/api/workspaces/${WORKSPACE_ID}/work-items`,
			);
			expect(listRes.status).toBe(200);
			const match = listRes.body.find(
				(item: { key: string }) => item.key === cardKey,
			);
			expect(match).toMatchObject({
				key: cardKey,
				source: "board",
				title: "via work-items",
			});
		});

		it("GET /tracker/items/:key resolves board cards", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId: inboxColumnId, title: "board detail" });
			const cardKey = createRes.body.key as string;

			const getRes = await request(app).get(
				`/api/workspaces/${WORKSPACE_ID}/tracker/items/${cardKey}`,
			);
			expect(getRes.status).toBe(200);
			expect(getRes.body).toMatchObject({
				key: cardKey,
				source: "board",
				columnId: inboxColumnId,
				columnName: "Requested",
			});
		});

		it("rejects non-status PATCH on board items via tracker API", async () => {
			const createRes = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId: inboxColumnId, title: "prio card" });
			const cardKey = createRes.body.key as string;

			const patchRes = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/tracker/items/${cardKey}`)
				.send({ priorityId: null, version: 1 });
			expect(patchRes.status).toBe(409);
			expect(patchRes.body.code).toBe("board_item_use_card_api");
		});

		it("moves board card to done column when status changes to Done", async () => {
			const backlog = await pool.query<{ id: number }>(
				`SELECT id FROM tracker_vocabularies
         WHERE workspace_id = $1 AND kind = 'status' AND slot = 'backlog'`,
				[WORKSPACE_ID],
			);
			const done = await pool.query<{ id: number }>(
				`SELECT id FROM tracker_vocabularies
         WHERE workspace_id = $1 AND kind = 'status' AND slot = 'done'`,
				[WORKSPACE_ID],
			);
			const finished = await pool.query<{ id: number }>(
				`SELECT id FROM columns WHERE workspace_id = $1 AND is_done = true`,
				[WORKSPACE_ID],
			);

			const createRes = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({ columnId: inboxColumnId, title: "move me" });
			const cardKey = createRes.body.key as string;
			expect(createRes.body.status?.id).toBe(backlog.rows[0]!.id);

			const patchRes = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/tracker/items/${cardKey}`)
				.send({ statusId: done.rows[0]!.id, version: 1 });
			expect(patchRes.status).toBe(200);
			expect(patchRes.body).toMatchObject({
				source: "board",
				columnId: finished.rows[0]!.id,
			});
			expect(patchRes.body.status.id).toBe(done.rows[0]!.id);
		});
	},
);

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"unified work item hybrid reverse",
	() => {
		let columns: ColumnFixture;
		let statuses: StatusFixture;

		beforeEach(async () => {
			({ columns, statuses } = await resetWorkspaceMultiColumn());
		});

		afterAll(async () => {
			await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
		});

		it("moves board card to in_progress column on multi-column board", async () => {
			const card = await createBoardCard(columns.backlogId, "start work");
			const patchRes = await patchBoardStatus(
				card.key,
				statuses.inProgressId,
				card.version,
			);
			expect(patchRes.status).toBe(200);
			expect(patchRes.body).toMatchObject({
				source: "board",
				columnId: columns.inProgressId,
			});
		});

		it("keeps column when status changes to Canceled", async () => {
			const card = await createBoardCard(columns.backlogId, "cancel me");
			const patchRes = await patchBoardStatus(
				card.key,
				statuses.canceledId,
				card.version,
			);
			expect(patchRes.status).toBe(200);
			expect(patchRes.body).toMatchObject({
				source: "board",
				columnId: columns.backlogId,
			});
			expect(patchRes.body.status.id).toBe(statuses.canceledId);
		});

		it("returns status_column_unmappable for in_progress on two-column board", async () => {
			await pool.query("DELETE FROM columns WHERE workspace_id = $1", [
				WORKSPACE_ID,
			]);
			const inbox = await pool.query<{ id: number }>(
				`INSERT INTO columns (workspace_id, title, position, is_done)
         VALUES ($1, 'Requested', 1024, false) RETURNING id`,
				[WORKSPACE_ID],
			);
			await pool.query(
				`INSERT INTO columns (workspace_id, title, position, is_done)
         VALUES ($1, 'Finished', 2048, true)`,
				[WORKSPACE_ID],
			);
			const card = await createBoardCard(inbox.rows[0]!.id, "stuck");
			const patchRes = await patchBoardStatus(
				card.key,
				statuses.inProgressId,
				card.version,
			);
			expect(patchRes.status).toBe(409);
			expect(patchRes.body.code).toBe("status_column_unmappable");
		});

		it("moves done card back to backlog column", async () => {
			const card = await createBoardCard(columns.backlogId, "reopen me");
			const doneRes = await patchBoardStatus(
				card.key,
				statuses.doneId,
				card.version,
			);
			expect(doneRes.status).toBe(200);
			expect(doneRes.body.columnId).toBe(columns.doneId);

			const reopenRes = await patchBoardStatus(
				card.key,
				statuses.backlogId,
				doneRes.body.version,
			);
			expect(reopenRes.status).toBe(200);
			expect(reopenRes.body.columnId).toBe(columns.backlogId);
		});

		it("keeps card in in_progress column when already there", async () => {
			const card = await createBoardCard(columns.inProgressId, "already active");
			const patchRes = await patchBoardStatus(
				card.key,
				statuses.inProgressId,
				card.version,
			);
			expect(patchRes.status).toBe(200);
			expect(patchRes.body.columnId).toBe(columns.inProgressId);
		});

		it("rejects move when WIP limit is reached", async () => {
			await createBoardCard(columns.inProgressId, "active card");
			const card = await createBoardCard(columns.backlogId, "needs slot");
			const patchRes = await patchBoardStatus(
				card.key,
				statuses.inProgressId,
				card.version,
			);
			expect(patchRes.status).toBe(409);
			expect(patchRes.body.error).toContain("WIP limit");
		});

		it("moves board card via canonical PATCH /work-items/:key", async () => {
			const card = await createBoardCard(columns.backlogId, "canonical path");
			const patchRes = await patchBoardStatus(
				card.key,
				statuses.doneId,
				card.version,
				"work-items",
			);
			expect(patchRes.status).toBe(200);
			expect(patchRes.body).toMatchObject({
				source: "board",
				columnId: columns.doneId,
			});
		});
	},
);
