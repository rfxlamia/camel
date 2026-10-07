// Integration test: after the T7 merge copy, card_events holds tracker item events
// (card_id -> column-less card) and item-less project/phase/vocabulary events.
// GET /activity (board feed) must hide every tracker_* type and keep board output.
//
// The rows are seeded with raw SQL shaped exactly like the copy output instead of
// running applySchema(workItemMerge) against the shared dev DB (which would migrate it).
//
// Requires PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/activity/activity-feed-merged.integration.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import { pool } from "../../db/pool.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { activityRouter } from "./activity.js";

const { mockCurrentUser } = vi.hoisted(() => ({
	mockCurrentUser: {
		id: 32020,
		username: "p3-merged-actor",
		displayName: "P3 Merged Actor",
	},
}));

const WORKSPACE_ID = 3202;

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

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((req, _res, next) => {
	req.user = mockCurrentUser;
	next();
});
app.use("/workspaces/:workspaceId", activityRouter);
app.use(createErrorHandler());

async function idFor(sql: string, values: unknown[]): Promise<number> {
	return (await pool.query<{ id: number }>(sql, values)).rows[0]!.id;
}

async function cleanup(): Promise<void> {
	for (const t of ["card_events", "cards", "columns", "tracker_vocabularies"]) {
		await pool.query(`DELETE FROM ${t} WHERE workspace_id = $1`, [
			WORKSPACE_ID,
		]);
	}
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
}

async function insertEvent(
	eventType: string,
	cardId: number | null,
	payload: Record<string, unknown>,
	columnId: number | null = null,
): Promise<void> {
	await pool.query(
		`INSERT INTO card_events
			(workspace_id, card_id, actor_id, event_type, payload, from_column_id, to_column_id)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)`,
		[
			WORKSPACE_ID,
			cardId,
			mockCurrentUser.id,
			eventType,
			JSON.stringify(payload),
			columnId,
		],
	);
}

async function seedMerged() {
	await cleanup();
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, $2, $3, 'test') ON CONFLICT (id) DO NOTHING",
		[mockCurrentUser.id, mockCurrentUser.username, mockCurrentUser.displayName],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'P3 Merged WS', $2, false)",
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await seedTrackerVocabulary(db, WORKSPACE_ID);
	const statusId = await idFor(
		"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status' LIMIT 1",
		[WORKSPACE_ID],
	);
	const columnId = await idFor(
		"INSERT INTO columns (workspace_id, title, position) VALUES ($1, 'Todo', 1024) RETURNING id",
		[WORKSPACE_ID],
	);
	const boardCardId = await idFor(
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number) VALUES ($1, $2, 'Board card', 1024, $3, 1) RETURNING id",
		[WORKSPACE_ID, columnId, statusId],
	);
	const columnLessId = await idFor(
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number) VALUES ($1, NULL, 'Tracker item', 2048, $2, 2) RETURNING id",
		[WORKSPACE_ID, statusId],
	);
	await insertEvent("create", boardCardId, { cardTitle: "Board card" });
	await insertEvent("move", boardCardId, { cardTitle: "Board card" }, columnId);
	// Shaped like the T7 copy output.
	await insertEvent("tracker_item_created", columnLessId, { title: "T" });
	await insertEvent("tracker_item_updated", columnLessId, {});
	await insertEvent("tracker_item_deleted", columnLessId, { title: "T" });
	await insertEvent("tracker_vocabulary_created", null, { name: "Status" });
	await insertEvent("tracker_project_created", null, { title: "Roadmap" });
	await insertEvent("tracker_phase_deleted", null, { title: "Phase 1" });
}

beforeEach(async () => {
	await cleanup();
});

afterAll(async () => {
	await cleanup();
	await pool.query("DELETE FROM users WHERE id = $1", [mockCurrentUser.id]);
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"GET /activity after merge copy",
	() => {
		it("hides every tracker_* event and keeps board events unchanged", async () => {
			await seedMerged();

			const res = await request(app).get(
				`/workspaces/${WORKSPACE_ID}/activity`,
			);

			expect(res.status).toBe(200);
			const events = res.body.events as {
				type: string;
				cardTitle: string | null;
			}[];
			expect(events.map((e) => e.type)).toEqual(["move", "create"]);
			for (const e of events) {
				expect(e.type.startsWith("tracker_")).toBe(false);
				expect(e.cardTitle).toBe("Board card");
			}
		});
	},
);
