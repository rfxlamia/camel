import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import type { PoolClient } from "pg";
import request from "supertest";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

const { mockPublishEvent, mockCurrentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	mockCurrentUser: { id: 20810, username: "t8-actor", displayName: "T8 Actor" },
}));

const ASSIGNEE_ID = 20811;
const BOARD_WORKSPACE_ID = 2081;
const TRACKER_WORKSPACE_ID = 2082;
const LOCK_WORKSPACE_ID = 2083;

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

function createApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createApp();

async function query<T extends object>(
	text: string,
	values: unknown[] = [],
): Promise<T[]> {
	return (await pool.query<T>(text, values)).rows;
}

async function idFor(sql: string, values: unknown[]): Promise<number> {
	return (await pool.query<{ id: number }>(sql, values)).rows[0]!.id;
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupWorkspace(workspaceId: number): Promise<void> {
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query(
		"DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query(
		"DELETE FROM card_assignees WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [workspaceId]);
	await pool.query(
		"DELETE FROM tracker_item_assignees WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query(
		"DELETE FROM tracker_item_labels WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query(
		"DELETE FROM tracker_phases WHERE project_id IN (SELECT id FROM tracker_projects WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query("DELETE FROM tracker_projects WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [workspaceId]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
}

async function cleanupAll(): Promise<void> {
	for (const workspaceId of [
		BOARD_WORKSPACE_ID,
		TRACKER_WORKSPACE_ID,
		LOCK_WORKSPACE_ID,
	]) {
		await cleanupWorkspace(workspaceId);
	}
	await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [
		mockCurrentUser.id,
		ASSIGNEE_ID,
	]);
}

type BoardFixtures = { columnId: number };
type TrackerFixtures = { statusId: number };

async function setupBoardWorkspace(): Promise<BoardFixtures> {
	await cleanupWorkspace(BOARD_WORKSPACE_ID);
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 't8-actor', 'T8 Actor', 'test'), ($2, 't8-assignee', 'T8 Assignee', 'test') ON CONFLICT (id) DO NOTHING",
		[mockCurrentUser.id, ASSIGNEE_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T8 Board Workspace', $2, false)",
		[BOARD_WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
		[BOARD_WORKSPACE_ID, mockCurrentUser.id, ASSIGNEE_ID],
	);
	await seedTrackerVocabulary(db, BOARD_WORKSPACE_ID);
	const columnId = await idFor(
		"INSERT INTO columns (workspace_id, title, position) VALUES ($1, 'Todo', 1024) RETURNING id",
		[BOARD_WORKSPACE_ID],
	);
	return { columnId };
}

async function setupTrackerWorkspace(): Promise<TrackerFixtures> {
	await cleanupWorkspace(TRACKER_WORKSPACE_ID);
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 't8-actor', 'T8 Actor', 'test'), ($2, 't8-assignee', 'T8 Assignee', 'test') ON CONFLICT (id) DO NOTHING",
		[mockCurrentUser.id, ASSIGNEE_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T8 Tracker Workspace', $2, false)",
		[TRACKER_WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
		[TRACKER_WORKSPACE_ID, mockCurrentUser.id, ASSIGNEE_ID],
	);
	const statusId = await idFor(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'status', 'Backlog', 1, 'blue') RETURNING id",
		[TRACKER_WORKSPACE_ID],
	);
	return { statusId };
}

async function setupLockWorkspace(): Promise<void> {
	await cleanupWorkspace(LOCK_WORKSPACE_ID);
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 't8-actor', 'T8 Actor', 'test'), ($2, 't8-assignee', 'T8 Assignee', 'test') ON CONFLICT (id) DO NOTHING",
		[mockCurrentUser.id, ASSIGNEE_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T8 Lock Workspace', $2, false)",
		[LOCK_WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')",
		[LOCK_WORKSPACE_ID, mockCurrentUser.id, ASSIGNEE_ID],
	);
}

async function removeAssignee(workspaceId: number): Promise<void> {
	const response = await request(app).delete(
		`/api/workspaces/${workspaceId}/members/${ASSIGNEE_ID}`,
	);
	expect(response.status).toBe(204);
}

async function assertNoBoardArtifacts(workspaceId: number): Promise<void> {
	expect(
		await query("SELECT id FROM cards WHERE workspace_id = $1", [workspaceId]),
	).toHaveLength(0);
	expect(
		await query(
			"SELECT ca.* FROM card_assignees AS ca JOIN cards AS c ON c.id = ca.card_id WHERE c.workspace_id = $1",
			[workspaceId],
		),
	).toHaveLength(0);
	expect(
		await query("SELECT id FROM card_events WHERE workspace_id = $1", [
			workspaceId,
		]),
	).toHaveLength(0);
}

async function assertNoTrackerArtifacts(workspaceId: number): Promise<void> {
	expect(
		await query("SELECT id FROM tracker_items WHERE workspace_id = $1", [
			workspaceId,
		]),
	).toHaveLength(0);
	expect(
		await query(
			"SELECT tia.* FROM tracker_item_assignees AS tia JOIN tracker_items AS ti ON ti.id = tia.tracker_item_id WHERE ti.workspace_id = $1",
			[workspaceId],
		),
	).toHaveLength(0);
	expect(
		await query("SELECT id FROM tracker_events WHERE workspace_id = $1", [
			workspaceId,
		]),
	).toHaveLength(0);
}

async function assertCompleteBoardOutcome(workspaceId: number): Promise<void> {
	const cards = await query<{ id: number }>(
		"SELECT id FROM cards WHERE workspace_id = $1",
		[workspaceId],
	);
	if (cards.length === 0) {
		await assertNoBoardArtifacts(workspaceId);
		return;
	}
	expect(cards).toHaveLength(1);
	const cardId = cards[0]!.id;
	const events = await query(
		"SELECT id FROM card_events WHERE card_id = $1",
		[cardId],
	);
	expect(events).toHaveLength(1);
}

async function assertCompleteTrackerOutcome(
	workspaceId: number,
): Promise<void> {
	const items = await query<{ id: number }>(
		"SELECT id FROM tracker_items WHERE workspace_id = $1",
		[workspaceId],
	);
	if (items.length === 0) {
		await assertNoTrackerArtifacts(workspaceId);
		return;
	}
	expect(items).toHaveLength(1);
	const itemId = items[0]!.id;
	const events = await query(
		"SELECT id FROM tracker_events WHERE tracker_item_id = $1",
		[itemId],
	);
	expect(events).toHaveLength(1);
}

async function waitForPeerWaitingOnWorkspaceLock(
	holderPid: number,
	timeoutMs = 5000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const waiting = await pool.query<{ count: string }>(
			`SELECT count(*)::text AS count
       FROM pg_stat_activity AS a
       JOIN pg_locks AS l ON l.pid = a.pid AND NOT l.granted
       WHERE a.datname = current_database()
         AND a.pid <> $1
         AND a.wait_event_type = 'Lock'`,
			[holderPid],
		);
		if (Number(waiting.rows[0]!.count) > 0) return;
		await sleep(25);
	}
	throw new Error("timed out waiting for peer to block on workspace lock");
}

async function lockMembershipNowait(
	workspaceId: number,
	userId: number,
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const locked = await client.query(
			`SELECT user_id
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2
       FOR UPDATE NOWAIT`,
			[workspaceId, userId],
		);
		expect(locked.rows).toHaveLength(1);
		await client.query("ROLLBACK");
	} finally {
		client.release();
	}
}

async function holdWorkspaceRow(
	workspaceId: number,
): Promise<{ client: PoolClient; pid: number }> {
	const client = await pool.connect();
	await client.query("BEGIN");
	const pidResult = await client.query<{ pid: number }>(
		"SELECT pg_backend_pid() AS pid",
	);
	await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [
		workspaceId,
	]);
	return { client, pid: pidResult.rows[0]!.pid };
}

beforeEach(async () => {
	await cleanupAll();
	mockPublishEvent.mockReset();
	mockPublishEvent.mockResolvedValue(undefined);
});

afterEach(async () => {
	await cleanupAll();
}, 30000);

afterAll(async () => {
	await cleanupAll();
});

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("member removal concurrency", () => {
	it("Reject a revoked assignee", async () => {
		const board = await setupBoardWorkspace();
		await removeAssignee(BOARD_WORKSPACE_ID);

		const boardResponse = await request(app)
			.post(`/api/workspaces/${BOARD_WORKSPACE_ID}/cards`)
			.send({
				columnId: board.columnId,
				title: "Revoked assignee board",
				assigneeIds: [ASSIGNEE_ID],
			});
		expect(boardResponse.status).toBe(400);
		expect(boardResponse.body.fieldErrors.assigneeIds).toEqual(
			expect.any(String),
		);
		await assertNoBoardArtifacts(BOARD_WORKSPACE_ID);

		const tracker = await setupTrackerWorkspace();
		await removeAssignee(TRACKER_WORKSPACE_ID);

		const trackerResponse = await request(app)
			.post(`/api/workspaces/${TRACKER_WORKSPACE_ID}/work-items`)
			.send({
				title: "Revoked assignee tracker",
				statusId: tracker.statusId,
				assigneeIds: [ASSIGNEE_ID],
			});
		expect(trackerResponse.status).toBe(400);
		expect(trackerResponse.body.fieldErrors.assigneeIds).toEqual(
			expect.any(String),
		);
		await assertNoTrackerArtifacts(TRACKER_WORKSPACE_ID);
	});

	it("Resolve a concurrent reference deletion atomically", async () => {
		const board = await setupBoardWorkspace();
		const boardHolder = await holdWorkspaceRow(BOARD_WORKSPACE_ID);
		const boardRemove = request(app).delete(
			`/api/workspaces/${BOARD_WORKSPACE_ID}/members/${ASSIGNEE_ID}`,
		);
		const boardCreate = request(app)
			.post(`/api/workspaces/${BOARD_WORKSPACE_ID}/cards`)
			.send({
				columnId: board.columnId,
				title: "Concurrent board",
				assigneeIds: [ASSIGNEE_ID],
			});
		void boardRemove.then(() => {});
		void boardCreate.then(() => {});
		try {
			await waitForPeerWaitingOnWorkspaceLock(boardHolder.pid);
			await boardHolder.client.query("COMMIT");
		} finally {
			boardHolder.client.release();
		}

		const [removeResponse, createResponse] = await Promise.all([
			boardRemove,
			boardCreate,
		]);
		expect(removeResponse.status).toBe(204);
		expect([201, 400]).toContain(createResponse.status);
		await assertCompleteBoardOutcome(BOARD_WORKSPACE_ID);

		const tracker = await setupTrackerWorkspace();
		const trackerHolder = await holdWorkspaceRow(TRACKER_WORKSPACE_ID);
		const trackerRemove = request(app).delete(
			`/api/workspaces/${TRACKER_WORKSPACE_ID}/members/${ASSIGNEE_ID}`,
		);
		const trackerCreate = request(app)
			.post(`/api/workspaces/${TRACKER_WORKSPACE_ID}/work-items`)
			.send({
				title: "Concurrent tracker",
				statusId: tracker.statusId,
				assigneeIds: [ASSIGNEE_ID],
			});
		void trackerRemove.then(() => {});
		void trackerCreate.then(() => {});
		try {
			await waitForPeerWaitingOnWorkspaceLock(trackerHolder.pid);
			await trackerHolder.client.query("COMMIT");
		} finally {
			trackerHolder.client.release();
		}

		const [trackerRemoveResponse, trackerCreateResponse] = await Promise.all([
			trackerRemove,
			trackerCreate,
		]);
		expect(trackerRemoveResponse.status).toBe(204);
		expect([201, 400]).toContain(trackerCreateResponse.status);
		await assertCompleteTrackerOutcome(TRACKER_WORKSPACE_ID);
	}, 30000);

	it("waits on workspace lock before deleting membership", async () => {
		await setupLockWorkspace();
		const holder = await holdWorkspaceRow(LOCK_WORKSPACE_ID);
		const removePromise = request(app).delete(
			`/api/workspaces/${LOCK_WORKSPACE_ID}/members/${ASSIGNEE_ID}`,
		);
		void removePromise.then(() => {});

		try {
			await waitForPeerWaitingOnWorkspaceLock(holder.pid);
			await lockMembershipNowait(LOCK_WORKSPACE_ID, ASSIGNEE_ID);
			await holder.client.query("COMMIT");
		} finally {
			holder.client.release();
		}

		const removeResponse = await removePromise;
		expect(removeResponse.status).toBe(204);
		expect(
			await query(
				"SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
				[LOCK_WORKSPACE_ID, ASSIGNEE_ID],
			),
		).toHaveLength(0);
	}, 30000);
});
