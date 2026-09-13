// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/routes/my-work.integration.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
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

const { mockPublishEvent, mockCurrentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	mockCurrentUser: {
		id: 47001,
		username: "my-work-alice",
		displayName: "Alice",
		email: "alice@example.test",
		emailVerified: true,
		needsUsername: false,
	},
}));

// Redis/realtime are outside this integration boundary. Keep the HTTP, route,
// authorization, Kysely, and PostgreSQL paths real.
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

// Only the session seam is stubbed. Membership and item assignment queries
// continue to execute against the real database in every request.
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

const ALICE_ID = mockCurrentUser.id;
const BOB_ID = 47002;
const ATLAS_ID = 47011;
const ORBIT_ID = 47012;
const NEBULA_ID = 47013;
const WORKSPACE_IDS = [ATLAS_ID, ORBIT_ID, NEBULA_ID] as const;

type StatusIds = {
	backlog: number;
	inProgress: number;
	done: number;
	canceled: number;
};

type WorkspaceFixture = {
	id: number;
	name: string;
	todoColumnId: number;
	doneColumnId: number;
	statuses: StatusIds;
};

type ItemFixture = {
	id: number;
	keyNumber: number;
	key: string;
	version: number;
};

type Fixtures = {
	atlas: WorkspaceFixture;
	orbit: WorkspaceFixture;
	nebula: WorkspaceFixture;
	atlasShadow: ItemFixture;
	atlasBoard: ItemFixture;
	atlasTracker: ItemFixture;
	orbitBoard: ItemFixture;
	orbitTracker: ItemFixture;
	nebulaTracker: ItemFixture;
};

type BoardState = {
	column_id: number;
	status_id: number;
	version: number;
};

type TrackerState = {
	status_id: number;
	version: number;
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

async function query<T extends object>(
	text: string,
	values: unknown[] = [],
): Promise<T[]> {
	return (await pool.query<T>(text, values)).rows;
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
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query(
		"DELETE FROM tracker_item_labels WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query(
		"DELETE FROM tracker_item_assignees WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM workspace_settings WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		workspaceId,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
}

async function cleanupAll(): Promise<void> {
	for (const workspaceId of WORKSPACE_IDS) {
		await cleanupWorkspace(workspaceId);
	}
	await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [
		ALICE_ID,
		BOB_ID,
	]);
}

function statusIds(
	rows: Array<{ id: number; slot: string | null }>,
): StatusIds {
	const bySlot = new Map(rows.map((row) => [row.slot, row.id]));
	return {
		backlog: bySlot.get("backlog")!,
		inProgress: bySlot.get("in_progress")!,
		done: bySlot.get("done")!,
		canceled: bySlot.get("canceled")!,
	};
}

async function createWorkspace(
	id: number,
	name: string,
	ownerId: number,
	memberIds: number[],
): Promise<WorkspaceFixture> {
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal, tracker_key_counter)
     VALUES ($1, $2, $3, false, 0)`,
		[id, name, ownerId],
	);
	for (const memberId of memberIds) {
		await pool.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
			[id, memberId, memberId === ownerId ? "owner" : "member"],
		);
	}

	const vocabularyRows = await query<{ id: number; slot: string | null }>(
		`INSERT INTO tracker_vocabularies
       (workspace_id, kind, name, position, colour, category, slot)
     VALUES
       ($1, 'status', 'Backlog', 1024, 'blue', 'backlog', 'backlog'),
       ($1, 'status', 'In Progress', 2048, 'blue', 'started', 'in_progress'),
       ($1, 'status', 'Done', 3072, 'blue', 'completed', 'done'),
       ($1, 'status', 'Canceled', 4096, 'blue', 'canceled', 'canceled')
     RETURNING id, slot`,
		[id],
	);
	const statuses = statusIds(vocabularyRows);
	const columnRows = await query<{ id: number; is_done: boolean }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
     VALUES ($1, 'Todo', 1024, false), ($1, 'Done', 2048, true)
     RETURNING id, is_done`,
		[id],
	);
	return {
		id,
		name,
		todoColumnId: columnRows.find((row) => !row.is_done)!.id,
		doneColumnId: columnRows.find((row) => row.is_done)!.id,
		statuses,
	};
}

async function insertBoardCard(
	workspace: WorkspaceFixture,
	keyNumber: number,
	title: string,
	assigneeIds: number[],
	position: number,
): Promise<ItemFixture> {
	const rows = await query<{ id: number; version: number }>(
		`INSERT INTO cards
       (workspace_id, column_id, title, description, position, key_number, status_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, version`,
		[
			workspace.id,
			workspace.todoColumnId,
			title,
			`${title} description`,
			position,
			keyNumber,
			workspace.statuses.backlog,
		],
	);
	const card = rows[0]!;
	for (const userId of assigneeIds) {
		await pool.query(
			"INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)",
			[card.id, userId],
		);
	}
	return {
		id: card.id,
		keyNumber,
		key: `${workspace.name.slice(0, 2).toUpperCase()}-${keyNumber}`,
		version: card.version,
	};
}

async function insertTrackerItem(
	workspace: WorkspaceFixture,
	keyNumber: number,
	title: string,
	assigneeIds: number[],
	position: number,
	statusId = workspace.statuses.inProgress,
): Promise<ItemFixture> {
	const rows = await query<{ id: number; version: number }>(
		`INSERT INTO tracker_items
       (workspace_id, key_number, title, description, status_id, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, version`,
		[
			workspace.id,
			keyNumber,
			title,
			`${title} description`,
			statusId,
			position,
		],
	);
	const item = rows[0]!;
	for (const userId of assigneeIds) {
		await pool.query(
			"INSERT INTO tracker_item_assignees (tracker_item_id, user_id) VALUES ($1, $2)",
			[item.id, userId],
		);
	}
	return {
		id: item.id,
		keyNumber,
		key: `${workspace.name.slice(0, 2).toUpperCase()}-${keyNumber}`,
		version: item.version,
	};
}

async function setupFixtures(): Promise<Fixtures> {
	await cleanupAll();
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
     VALUES
       ($1, 'my-work-alice', 'Alice', 'test'),
       ($2, 'my-work-bob', 'Bob', 'test')`,
		[ALICE_ID, BOB_ID],
	);

	const atlas = await createWorkspace(ATLAS_ID, "Atlas", ALICE_ID, [ALICE_ID]);
	const orbit = await createWorkspace(ORBIT_ID, "Orbit", ALICE_ID, [ALICE_ID]);
	const nebula = await createWorkspace(NEBULA_ID, "Nebula", BOB_ID, [BOB_ID]);

	const atlasShadow = await insertBoardCard(
		atlas,
		17,
		"Atlas board shadow",
		[ALICE_ID],
		1024,
	);
	const atlasBoard = await insertBoardCard(
		atlas,
		18,
		"Atlas Board assigned work",
		[ALICE_ID],
		2048,
	);
	const atlasTracker = await insertTrackerItem(
		atlas,
		17,
		"Atlas tracker winner",
		[ALICE_ID, BOB_ID],
		1024,
	);
	const orbitBoard = await insertBoardCard(
		orbit,
		17,
		"Orbit Board same key",
		[ALICE_ID],
		1024,
	);
	const orbitTracker = await insertTrackerItem(
		orbit,
		4,
		"Orbit Tracker assigned work",
		[ALICE_ID, BOB_ID],
		1024,
	);
	const nebulaTracker = await insertTrackerItem(
		nebula,
		9,
		"Nebula secret assigned work",
		[ALICE_ID],
		1024,
	);

	return {
		atlas,
		orbit,
		nebula,
		atlasShadow,
		atlasBoard,
		atlasTracker,
		orbitBoard,
		orbitTracker,
		nebulaTracker,
	};
}

async function boardState(cardId: number): Promise<BoardState> {
	return (
		await query<BoardState>(
			"SELECT column_id, status_id, version FROM cards WHERE id = $1",
			[cardId],
		)
	)[0]!;
}

async function trackerState(itemId: number): Promise<TrackerState> {
	return (
		await query<TrackerState>(
			"SELECT status_id, version FROM tracker_items WHERE id = $1",
			[itemId],
		)
	)[0]!;
}

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("My Work server acceptance boundary", () => {
	let fixtures: Fixtures;

	beforeEach(async () => {
		fixtures = await setupFixtures();
		mockPublishEvent.mockClear();
	});

	afterEach(async () => {
		await cleanupAll();
	});

	afterAll(async () => {
		await cleanupAll();
		await pool.end();
	});

	// Cycle 1 — authorized cross-workspace rollup and composite identity.
	it("lists authorized Board/Tracker work once with tracker-wins composite identity", async () => {
		const response = await request(app).get("/api/my-work?scope=active");

		expect(response.status).toBe(200);
		expect(response.body.nextCursor).toBeNull();
		const items = response.body.items as Array<Record<string, any>>;
		expect(items).toHaveLength(4);
		expect(items.map((item) => item.identity)).toEqual(
			expect.arrayContaining([
				{ workspaceId: ATLAS_ID, source: "tracker", key: "AT-17" },
				{ workspaceId: ATLAS_ID, source: "board", key: "AT-18" },
				{ workspaceId: ORBIT_ID, source: "tracker", key: "OR-4" },
				{ workspaceId: ORBIT_ID, source: "board", key: "OR-17" },
			]),
		);
		expect(items.filter((item) => item.identity.key === "AT-17")).toHaveLength(
			1,
		);
		expect(items).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Atlas board shadow" }),
			]),
		);
		expect(items).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ title: "Nebula secret assigned work" }),
			]),
		);
		expect(
			items.find((item) => item.identity.key === "OR-4")?.assignees,
		).toHaveLength(2);
	});

	// Cycle 2 — detail reauthorization after membership/assignment revocation.
	it("reauthorizes detail and returns 404 without cached content", async () => {
		const listResponse = await request(app).get("/api/my-work?scope=active");
		expect(listResponse.status).toBe(200);
		expect(
			(listResponse.body.items as Array<Record<string, any>>).some(
				(item) => item.identity.key === "AT-18",
			),
		).toBe(true);

		const before = await request(app).get(
			`/api/my-work/${ATLAS_ID}/board/AT-18`,
		);
		expect(before.status).toBe(200);
		expect(before.body.title).toBe("Atlas Board assigned work");

		await pool.query(
			"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[ATLAS_ID, ALICE_ID],
		);
		const afterMembershipRevocation = await request(app).get(
			`/api/my-work/${ATLAS_ID}/board/AT-18`,
		);
		expect(afterMembershipRevocation.status).toBe(404);
		expect(afterMembershipRevocation.body).toEqual({ error: "Not found" });
		expect(JSON.stringify(afterMembershipRevocation.body)).not.toContain(
			"Atlas Board assigned work",
		);

		await pool.query(
			"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
			[ATLAS_ID, ALICE_ID],
		);
		await pool.query(
			"DELETE FROM card_assignees WHERE card_id = $1 AND user_id = $2",
			[fixtures.atlasBoard.id, ALICE_ID],
		);
		const afterAssignmentRevocation = await request(app).get(
			`/api/my-work/${ATLAS_ID}/board/AT-18`,
		);
		expect(afterAssignmentRevocation.status).toBe(404);
		expect(afterAssignmentRevocation.body).toEqual({ error: "Not found" });
		expect(JSON.stringify(afterAssignmentRevocation.body)).not.toContain(
			"Atlas Board assigned work",
		);
	});

	// Cycle 3 — Board Mark done and exactly-once activity/source isolation.
	it("marks a Board item done with one card activity and no Tracker write", async () => {
		const beforeTrackerRows = await query<TrackerState>(
			"SELECT status_id, version FROM tracker_items WHERE workspace_id = $1 ORDER BY id",
			[ATLAS_ID],
		);
		const response = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: fixtures.atlasBoard.version });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			source: "board",
			key: "AT-18",
			status: { slot: "done" },
			columnId: fixtures.atlas.doneColumnId,
		});
		expect(await boardState(fixtures.atlasBoard.id)).toEqual({
			column_id: fixtures.atlas.doneColumnId,
			status_id: fixtures.atlas.statuses.done,
			version: 2,
		});
		const cardEvents = await query<{
			event_type: string;
			from_column_id: number | null;
			to_column_id: number | null;
			actor_id: number | null;
		}>(
			"SELECT event_type, from_column_id, to_column_id, actor_id FROM card_events WHERE card_id = $1",
			[fixtures.atlasBoard.id],
		);
		expect(cardEvents).toEqual([
			{
				event_type: "move",
				from_column_id: fixtures.atlas.todoColumnId,
				to_column_id: fixtures.atlas.doneColumnId,
				actor_id: ALICE_ID,
			},
		]);
		expect(
			await query("SELECT id FROM tracker_events WHERE workspace_id = $1", [
				ATLAS_ID,
			]),
		).toHaveLength(0);
		expect(
			await query<TrackerState>(
				"SELECT status_id, version FROM tracker_items WHERE workspace_id = $1 ORDER BY id",
				[ATLAS_ID],
			),
		).toEqual(beforeTrackerRows);
	});

	// Cycle 4 — Tracker Mark done and exactly-once activity/source isolation.
	it("marks a Tracker item done with one tracker activity and no Board write", async () => {
		const beforeBoard = await boardState(fixtures.orbitBoard.id);
		const response = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: fixtures.orbitTracker.version });

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({
			source: "tracker",
			key: "OR-4",
			status: { slot: "done" },
		});
		expect(await trackerState(fixtures.orbitTracker.id)).toEqual({
			status_id: fixtures.orbit.statuses.done,
			version: 2,
		});
		const trackerEvents = await query<{
			event_type: string;
			tracker_item_id: number | null;
			actor_id: number | null;
		}>(
			"SELECT event_type, tracker_item_id, actor_id FROM tracker_events WHERE tracker_item_id = $1",
			[fixtures.orbitTracker.id],
		);
		expect(trackerEvents).toEqual([
			{
				event_type: "tracker_item_updated",
				tracker_item_id: fixtures.orbitTracker.id,
				actor_id: ALICE_ID,
			},
		]);
		expect(await boardState(fixtures.orbitBoard.id)).toEqual(beforeBoard);
		expect(
			await query("SELECT id FROM card_events WHERE workspace_id = $1", [
				ORBIT_ID,
			]),
		).toHaveLength(0);
	});

	// Cycle 5 — stale conflict and no partial source/activity write.
	it("returns version_conflict for stale Board and Tracker writes", async () => {
		const initialBoard = await boardState(fixtures.atlasBoard.id);
		await pool.query("UPDATE cards SET version = version + 1 WHERE id = $1", [
			fixtures.atlasBoard.id,
		]);
		const staleBoardResponse = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: initialBoard.version });
		expect(staleBoardResponse.status).toBe(409);
		expect(staleBoardResponse.body.code).toBe("version_conflict");
		expect(await boardState(fixtures.atlasBoard.id)).toEqual({
			...initialBoard,
			version: initialBoard.version + 1,
		});
		expect(
			await query("SELECT id FROM card_events WHERE card_id = $1", [
				fixtures.atlasBoard.id,
			]),
		).toHaveLength(0);

		const initialTracker = await trackerState(fixtures.orbitTracker.id);
		await pool.query(
			"UPDATE tracker_items SET version = version + 1 WHERE id = $1",
			[fixtures.orbitTracker.id],
		);
		const staleTrackerResponse = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: initialTracker.version });
		expect(staleTrackerResponse.status).toBe(409);
		expect(staleTrackerResponse.body.code).toBe("version_conflict");
		expect(await trackerState(fixtures.orbitTracker.id)).toEqual({
			...initialTracker,
			version: initialTracker.version + 1,
		});
		expect(
			await query("SELECT id FROM tracker_events WHERE tracker_item_id = $1", [
				fixtures.orbitTracker.id,
			]),
		).toHaveLength(0);
	});

	// Cycle 6 — idempotent retry and activity count.
	it("accepts retries after completion without duplicating activity", async () => {
		const boardDone = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: fixtures.atlasBoard.version });
		expect(boardDone.status).toBe(200);
		const boardRetry = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: fixtures.atlasBoard.version });
		expect(boardRetry.status).toBe(200);
		expect(boardRetry.body).toMatchObject({ source: "board", key: "AT-18" });
		expect(
			await query("SELECT id FROM card_events WHERE card_id = $1", [
				fixtures.atlasBoard.id,
			]),
		).toHaveLength(1);

		const trackerDone = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: fixtures.orbitTracker.version });
		expect(trackerDone.status).toBe(200);
		const trackerRetry = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: fixtures.orbitTracker.version });
		expect(trackerRetry.status).toBe(200);
		expect(trackerRetry.body).toMatchObject({ source: "tracker", key: "OR-4" });
		expect(
			await query("SELECT id FROM tracker_events WHERE tracker_item_id = $1", [
				fixtures.orbitTracker.id,
			]),
		).toHaveLength(1);
	});

	// Cycle 7 — revoked membership returns 404/not_found without any write.
	it("rejects Mark done after membership revocation without source activity", async () => {
		const before = await boardState(fixtures.atlasBoard.id);
		await pool.query(
			"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[ATLAS_ID, ALICE_ID],
		);
		const response = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: before.version });

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "Not found" });
		expect(await boardState(fixtures.atlasBoard.id)).toEqual(before);
		expect(
			await query("SELECT id FROM card_events WHERE card_id = $1", [
				fixtures.atlasBoard.id,
			]),
		).toHaveLength(0);
	});

	// Cycle 8 — removed assignment returns 404/not_found without any write.
	it("rejects Mark done after assignment removal without source activity", async () => {
		const before = await trackerState(fixtures.orbitTracker.id);
		await pool.query(
			"DELETE FROM tracker_item_assignees WHERE tracker_item_id = $1 AND user_id = $2",
			[fixtures.orbitTracker.id, ALICE_ID],
		);
		const response = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: before.version });

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: "Not found" });
		expect(await trackerState(fixtures.orbitTracker.id)).toEqual(before);
		expect(
			await query("SELECT id FROM tracker_events WHERE tracker_item_id = $1", [
				fixtures.orbitTracker.id,
			]),
		).toHaveLength(0);
	});

	// Cycle 9 — missing Board/Tracker done mappings return unmappable without a write.
	it("returns status_column_unmappable when either done mapping is absent", async () => {
		const beforeBoard = await boardState(fixtures.atlasBoard.id);
		await pool.query(
			"DELETE FROM columns WHERE workspace_id = $1 AND is_done = true",
			[ATLAS_ID],
		);
		const boardResponse = await request(app)
			.post(`/api/my-work/${ATLAS_ID}/board/AT-18/done`)
			.send({ version: beforeBoard.version });
		expect(boardResponse.status).toBe(409);
		expect(boardResponse.body.code).toBe("status_column_unmappable");
		expect(await boardState(fixtures.atlasBoard.id)).toEqual(beforeBoard);
		expect(
			await query("SELECT id FROM card_events WHERE card_id = $1", [
				fixtures.atlasBoard.id,
			]),
		).toHaveLength(0);

		const beforeTracker = await trackerState(fixtures.orbitTracker.id);
		await pool.query(
			"DELETE FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status' AND slot = 'done'",
			[ORBIT_ID],
		);
		const trackerResponse = await request(app)
			.post(`/api/my-work/${ORBIT_ID}/tracker/OR-4/done`)
			.send({ version: beforeTracker.version });
		expect(trackerResponse.status).toBe(409);
		expect(trackerResponse.body.code).toBe("status_column_unmappable");
		expect(await trackerState(fixtures.orbitTracker.id)).toEqual(beforeTracker);
		expect(
			await query("SELECT id FROM tracker_events WHERE tracker_item_id = $1", [
				fixtures.orbitTracker.id,
			]),
		).toHaveLength(0);
	});
});
