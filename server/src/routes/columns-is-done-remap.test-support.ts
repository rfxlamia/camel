import { afterEach, beforeEach, vi } from "vitest";

const { mockPublishEventImpl, mockTestUser } = vi.hoisted(() => ({
	mockPublishEventImpl: vi.fn().mockResolvedValue(undefined),
	mockTestUser: {
		id: 1,
		username: "testuser",
		displayName: "Test User",
		email: null,
		emailVerified: false,
		needsUsername: false,
	},
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));

vi.mock("../realtime.js", () => ({
	publishEvent: mockPublishEventImpl,
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
		requireAuth: (req: Request, _res: Response, next: NextFunction) => {
			(req as Request & { user: AuthUser }).user = mockTestUser as AuthUser;
			next();
		},
	};
});

import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { pool as dbPool } from "../db/pool.js";
import type { AuthUser } from "../auth.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { publishEvent } from "../realtime.js";
import { api } from "../routes.js";

export const WORKSPACE_ID = 98;
export const pool = dbPool;
export const request = supertest;
export { mockTestUser };
export const mockPublishEvent = vi.mocked(publishEvent);

export const app = (() => {
	const testApp = express();
	testApp.use(express.json());
	testApp.use(cookieParser());
	testApp.use("/api", api);
	testApp.use(createErrorHandler());
	return testApp;
})();

export type ColumnRow = {
	id: number;
	title: string;
	position: number;
	is_done: boolean;
};
export type CardRow = {
	id: number;
	column_id: number;
	status_id: number | null;
	version: number;
	started_at: Date | null;
	done_at: Date | null;
};
export type ActivityRow = {
	card_id: number | null;
	event_type: string;
	payload: Record<string, unknown>;
};

export async function cleanup() {
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

export async function setup() {
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
	await pool.query(
		`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot)
		 VALUES ($1, 'status', $2, $3, 'neutral', $4)`,
		[WORKSPACE_ID, "Backlog", 1024, "backlog"],
	);
	for (const [name, slot, position] of [
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

export async function insertColumns(
	definitions: Array<{ title: string; position: number; isDone: boolean }>,
) {
	const inserted = await pool.query<{ id: number; position: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
		 SELECT $1, definition.title, definition.position, definition.is_done
		 FROM jsonb_to_recordset($2::jsonb) AS definition(title text, position double precision, is_done boolean)
		 RETURNING id, position`,
		[
			WORKSPACE_ID,
			JSON.stringify(
				definitions.map((definition) => ({
					title: definition.title,
					position: definition.position,
					is_done: definition.isDone,
				})),
			),
		],
	);
	return inserted.rows
		.sort((left, right) => left.position - right.position)
		.map((row) => row.id);
}

export async function statusId(slot: string) {
	const result = await pool.query<{ id: number }>(
		"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND slot = $2",
		[WORKSPACE_ID, slot],
	);
	return result.rows[0].id;
}

export async function addCard(
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

export async function readCard(id: number) {
	const result = await pool.query<CardRow>(
		"SELECT id, column_id, status_id, version, started_at, done_at FROM cards WHERE id = $1",
		[id],
	);
	return result.rows[0];
}

export async function columns() {
	const result = await pool.query<ColumnRow>(
		"SELECT id, title, position, is_done FROM columns WHERE workspace_id = $1 ORDER BY position",
		[WORKSPACE_ID],
	);
	return result.rows;
}

export async function cardActivities(cardIds: number[]) {
	const result = await pool.query<ActivityRow>(
		`SELECT card_id, event_type, payload
		 FROM card_events
		 WHERE workspace_id = $1 AND card_id = ANY($2::int[])
		 ORDER BY id`,
		[WORKSPACE_ID, cardIds],
	);
	return result.rows;
}

export async function trackerEventCount() {
	const result = await pool.query<{ count: string }>(
		"SELECT count(*)::text AS count FROM tracker_events WHERE workspace_id = $1",
		[WORKSPACE_ID],
	);
	return Number(result.rows[0].count);
}

export function installDatabaseHooks() {
	beforeEach(async () => {
		await setup();
		vi.clearAllMocks();
	});
	afterEach(cleanup);
}

export async function destroyWorkspace() {
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
}
