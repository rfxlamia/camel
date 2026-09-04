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
	mockCurrentUser: {
		id: 21010,
		username: "t10-actor",
		displayName: "T10 Actor",
	},
}));

const BOARD_WORKSPACE_ID = 2101;
const TRACKER_WORKSPACE_ID = 2102;
const CLEANUP_WORKSPACE_ID = 2103;

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
		CLEANUP_WORKSPACE_ID,
	]) {
		await cleanupWorkspace(workspaceId);
	}
	await pool.query("DELETE FROM users WHERE id = $1", [mockCurrentUser.id]);
}

type PhaseFixtures = {
	columnId: number;
	statusId: number;
	projectId: number;
	phaseId: number;
};

async function setupBoardWorkspace(): Promise<PhaseFixtures> {
	await cleanupWorkspace(BOARD_WORKSPACE_ID);
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 't10-actor', 'T10 Actor', 'test') ON CONFLICT (id) DO NOTHING",
		[mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T10 Board Workspace', $2, false)",
		[BOARD_WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[BOARD_WORKSPACE_ID, mockCurrentUser.id],
	);
	await seedTrackerVocabulary(db, BOARD_WORKSPACE_ID);
	const columnId = await idFor(
		"INSERT INTO columns (workspace_id, title, position) VALUES ($1, 'Todo', 1024) RETURNING id",
		[BOARD_WORKSPACE_ID],
	);
	const projectId = await idFor(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Web', 1024) RETURNING id",
		[BOARD_WORKSPACE_ID],
	);
	const phaseId = await idFor(
		"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'Build', 1024) RETURNING id",
		[projectId],
	);
	const statusId = await idFor(
		"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status' LIMIT 1",
		[BOARD_WORKSPACE_ID],
	);
	return { columnId, statusId, projectId, phaseId };
}

async function setupTrackerWorkspace(): Promise<PhaseFixtures> {
	await cleanupWorkspace(TRACKER_WORKSPACE_ID);
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 't10-actor', 'T10 Actor', 'test') ON CONFLICT (id) DO NOTHING",
		[mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T10 Tracker Workspace', $2, false)",
		[TRACKER_WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[TRACKER_WORKSPACE_ID, mockCurrentUser.id],
	);
	const statusId = await idFor(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'status', 'Backlog', 1, 'blue') RETURNING id",
		[TRACKER_WORKSPACE_ID],
	);
	const projectId = await idFor(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Web', 1024) RETURNING id",
		[TRACKER_WORKSPACE_ID],
	);
	const phaseId = await idFor(
		"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'Build', 1024) RETURNING id",
		[projectId],
	);
	const columnId = 0;
	return { columnId, statusId, projectId, phaseId };
}

async function setupCleanupWorkspace(): Promise<PhaseFixtures> {
	await cleanupWorkspace(CLEANUP_WORKSPACE_ID);
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 't10-actor', 'T10 Actor', 'test') ON CONFLICT (id) DO NOTHING",
		[mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T10 Cleanup Workspace', $2, false)",
		[CLEANUP_WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[CLEANUP_WORKSPACE_ID, mockCurrentUser.id],
	);
	await seedTrackerVocabulary(db, CLEANUP_WORKSPACE_ID);
	const columnId = await idFor(
		"INSERT INTO columns (workspace_id, title, position) VALUES ($1, 'Todo', 1024) RETURNING id",
		[CLEANUP_WORKSPACE_ID],
	);
	const projectId = await idFor(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Web', 1024) RETURNING id",
		[CLEANUP_WORKSPACE_ID],
	);
	const phaseId = await idFor(
		"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'Build', 1024) RETURNING id",
		[projectId],
	);
	const statusId = await idFor(
		"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status' LIMIT 1",
		[CLEANUP_WORKSPACE_ID],
	);
	return { columnId, statusId, projectId, phaseId };
}

async function assertNoBoardArtifacts(workspaceId: number): Promise<void> {
	expect(
		await query("SELECT id FROM cards WHERE workspace_id = $1", [workspaceId]),
	).toHaveLength(0);
	expect(
		await query("SELECT id FROM card_events WHERE workspace_id = $1", [
			workspaceId,
		]),
	).toHaveLength(0);
}

async function _assertNoTrackerArtifacts(workspaceId: number): Promise<void> {
	expect(
		await query("SELECT id FROM tracker_items WHERE workspace_id = $1", [
			workspaceId,
		]),
	).toHaveLength(0);
	expect(
		await query("SELECT id FROM tracker_events WHERE workspace_id = $1", [
			workspaceId,
		]),
	).toHaveLength(0);
}

async function assertCompleteBoardPhaseOutcome(
	workspaceId: number,
	projectId: number,
	phaseId: number,
): Promise<void> {
	const cards = await query<{
		id: number;
		project_id: number | null;
		phase_id: number | null;
	}>("SELECT id, project_id, phase_id FROM cards WHERE workspace_id = $1", [
		workspaceId,
	]);
	if (cards.length === 0) {
		await assertNoBoardArtifacts(workspaceId);
		return;
	}
	expect(cards).toHaveLength(1);
	const card = cards[0]!;
	if (card.phase_id != null) {
		expect(card.project_id).toBe(projectId);
		expect(card.phase_id).toBe(phaseId);
		const phase = await query(
			`SELECT id FROM tracker_phases
       WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
			[card.phase_id, card.project_id],
		);
		expect(phase).toHaveLength(1);
	} else if (card.project_id != null) {
		const project = await query(
			"SELECT id FROM tracker_projects WHERE id = $1 AND deleted_at IS NULL",
			[card.project_id],
		);
		expect(project).toHaveLength(1);
	}
	const events = await query<{ event_type: string }>(
		"SELECT event_type FROM card_events WHERE card_id = $1 ORDER BY id",
		[card.id],
	);
	expect(events.length).toBeGreaterThanOrEqual(1);
	expect(events[0]?.event_type).toBe("create");
}

async function assertNoTrackerCreateArtifacts(
	workspaceId: number,
): Promise<void> {
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
}

async function assertCompleteTrackerPhaseOutcome(
	workspaceId: number,
	projectId: number,
	phaseId: number,
): Promise<void> {
	const items = await query<{
		id: number;
		project_id: number | null;
		phase_id: number | null;
	}>(
		"SELECT id, project_id, phase_id FROM tracker_items WHERE workspace_id = $1",
		[workspaceId],
	);
	if (items.length === 0) {
		await assertNoTrackerCreateArtifacts(workspaceId);
		return;
	}
	expect(items).toHaveLength(1);
	const item = items[0]!;
	if (item.phase_id != null) {
		expect(item.project_id).toBe(projectId);
		expect(item.phase_id).toBe(phaseId);
		const phase = await query(
			`SELECT id FROM tracker_phases
       WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
			[item.phase_id, item.project_id],
		);
		expect(phase).toHaveLength(1);
	} else if (item.project_id != null) {
		const project = await query(
			"SELECT id FROM tracker_projects WHERE id = $1 AND deleted_at IS NULL",
			[item.project_id],
		);
		expect(project).toHaveLength(1);
	}
	const events = await query(
		"SELECT id FROM tracker_events WHERE tracker_item_id = $1",
		[item.id],
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

integration("phase removal concurrency", () => {
	it("serializes Board create against phase removal", async () => {
		const fixtures = await setupBoardWorkspace();
		const holder = await holdWorkspaceRow(BOARD_WORKSPACE_ID);
		const phaseRemove = request(app).delete(
			`/api/workspaces/${BOARD_WORKSPACE_ID}/tracker/phases/${fixtures.phaseId}`,
		);
		const boardCreate = request(app)
			.post(`/api/workspaces/${BOARD_WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Concurrent board card",
				projectId: fixtures.projectId,
				phaseId: fixtures.phaseId,
			});
		void phaseRemove.then(() => {});
		void boardCreate.then(() => {});
		try {
			await waitForPeerWaitingOnWorkspaceLock(holder.pid);
			await holder.client.query("COMMIT");
		} finally {
			holder.client.release();
		}

		const [removeResponse, createResponse] = await Promise.all([
			phaseRemove,
			boardCreate,
		]);
		expect(removeResponse.status).toBe(204);
		expect([201, 400]).toContain(createResponse.status);
		await assertCompleteBoardPhaseOutcome(
			BOARD_WORKSPACE_ID,
			fixtures.projectId,
			fixtures.phaseId,
		);
	}, 30000);

	it("serializes Tracker create against phase removal", async () => {
		const fixtures = await setupTrackerWorkspace();
		const holder = await holdWorkspaceRow(TRACKER_WORKSPACE_ID);
		const phaseRemove = request(app).delete(
			`/api/workspaces/${TRACKER_WORKSPACE_ID}/tracker/phases/${fixtures.phaseId}`,
		);
		const trackerCreate = request(app)
			.post(`/api/workspaces/${TRACKER_WORKSPACE_ID}/work-items`)
			.send({
				title: "Concurrent tracker item",
				statusId: fixtures.statusId,
				projectId: fixtures.projectId,
				phaseId: fixtures.phaseId,
			});
		void phaseRemove.then(() => {});
		void trackerCreate.then(() => {});
		try {
			await waitForPeerWaitingOnWorkspaceLock(holder.pid);
			await holder.client.query("COMMIT");
		} finally {
			holder.client.release();
		}

		const [removeResponse, createResponse] = await Promise.all([
			phaseRemove,
			trackerCreate,
		]);
		expect(removeResponse.status).toBe(204);
		expect([201, 400]).toContain(createResponse.status);
		if (createResponse.status === 400) {
			expect(createResponse.body.fieldErrors?.phaseId).toEqual(
				expect.any(String),
			);
		}
		await assertCompleteTrackerPhaseOutcome(
			TRACKER_WORKSPACE_ID,
			fixtures.projectId,
			fixtures.phaseId,
		);
	}, 30000);

	it("clears Board card phase metadata on phase removal", async () => {
		const fixtures = await setupCleanupWorkspace();
		const createResponse = await request(app)
			.post(`/api/workspaces/${CLEANUP_WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Phase-bound card",
				projectId: fixtures.projectId,
				phaseId: fixtures.phaseId,
			});
		expect(createResponse.status).toBe(201);
		const cardId = createResponse.body.id as number;

		const before = await query<{
			project_id: number | null;
			phase_id: number | null;
			version: number;
		}>("SELECT project_id, phase_id, version FROM cards WHERE id = $1", [
			cardId,
		]);
		expect(before[0]).toEqual({
			project_id: fixtures.projectId,
			phase_id: fixtures.phaseId,
			version: 1,
		});

		const removeResponse = await request(app).delete(
			`/api/workspaces/${CLEANUP_WORKSPACE_ID}/tracker/phases/${fixtures.phaseId}`,
		);
		expect(removeResponse.status).toBe(204);

		const after = await query<{
			project_id: number | null;
			phase_id: number | null;
			version: number;
		}>("SELECT project_id, phase_id, version FROM cards WHERE id = $1", [
			cardId,
		]);
		expect(after[0]?.project_id).toBe(fixtures.projectId);
		expect(after[0]?.phase_id).toBeNull();
		expect(after[0]?.version).toBe(2);

		const events = await query<{ event_type: string; payload: unknown }>(
			"SELECT event_type, payload FROM card_events WHERE card_id = $1 ORDER BY id",
			[cardId],
		);
		expect(events).toHaveLength(2);
		expect(events[1]?.event_type).toBe("update");
		const updatePayload =
			typeof events[1]!.payload === "string"
				? JSON.parse(events[1]!.payload)
				: events[1]!.payload;
		expect(updatePayload).toEqual(
			expect.objectContaining({
				cardTitle: "Phase-bound card",
				changed: ["phase"],
			}),
		);

		expect(mockPublishEvent).toHaveBeenCalledWith(
			CLEANUP_WORKSPACE_ID,
			expect.objectContaining({
				type: "card.updated",
				cardId,
				actor: expect.objectContaining({ id: mockCurrentUser.id }),
			}),
		);
	}, 30000);
});
