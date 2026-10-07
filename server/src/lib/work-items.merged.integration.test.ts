// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/lib/work-items.merged.integration.test.ts
// Seeds the merged `cards` table directly (column-less rows have column_id NULL).
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCurrentUser } = vi.hoisted(() => ({
	mockCurrentUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));
vi.mock("../realtime.js", () => ({
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

import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";
import { computeCardUpdatedAt } from "./card-response.js";
import {
	getUnifiedWorkspaceActivity,
	getWorkItemEvents,
} from "./work-item-events.js";
import { listMergedWorkItems } from "./work-item-response.js";

const WORKSPACE_ID = 992;
const PREFIX = "TE";
const BOARD_COUNT = 25;
const COLUMN_LESS_COUNT = 53;

const TRACKER_KEYS = [
	"id",
	"key",
	"source",
	"title",
	"description",
	"projectId",
	"phaseId",
	"startDate",
	"endDate",
	"completedAt",
	"position",
	"status",
	"priority",
	"labels",
	"assignees",
	"version",
	"createdAt",
	"updatedAt",
];
const BOARD_KEYS = [
	...TRACKER_KEYS,
	"columnId",
	"columnName",
	"dueDate",
	"startedAt",
	"doneAt",
];

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);
app.use(createErrorHandler());

/** pg parses DATE as local midnight and the serializer slices toISOString(), so
 * the expected day is computed the same way (stays identical to today's output). */
const dateOnly = (y: number, m: number, d: number) =>
	new Date(y, m - 1, d).toISOString().slice(0, 10);

type Fixture = {
	columnId: number;
	statusId: number;
	priorityId: number;
	labelId: number;
};

async function q<T = any>(text: string, values: unknown[] = []): Promise<T[]> {
	return (await pool.query(text, values)).rows as T[];
}

async function cleanWorkspace() {
	await q("DELETE FROM card_events WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q(
		"DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[WORKSPACE_ID],
	);
	await q(
		"DELETE FROM card_assignees WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[WORKSPACE_ID],
	);
	await q("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q("DELETE FROM tracker_events WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q("DELETE FROM tracker_items WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q("DELETE FROM columns WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q("DELETE FROM agent_boards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await q("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await q("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
}

async function resetWorkspace(): Promise<Fixture> {
	await cleanWorkspace();
	await q(
		`INSERT INTO users (id, username, display_name, password_hash)
		 VALUES ($1, $2, $3, 'hashed') ON CONFLICT (id) DO NOTHING`,
		[mockCurrentUser.id, mockCurrentUser.username, mockCurrentUser.displayName],
	);
	await q(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal, tracker_key_counter)
		 VALUES ($1, 'Test Enterprise', $2, false, 0)`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await q(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
		 VALUES ($1, $2, 'owner')`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	const vocab = async (kind: string, name: string, slot: string | null) =>
		(
			await q<{ id: number }>(
				`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot)
				 VALUES ($1, $2, $3, 1024, 'blue', $4) RETURNING id`,
				[WORKSPACE_ID, kind, name, slot],
			)
		)[0].id;
	const statusId = await vocab("status", "Todo", "todo");
	const priorityId = await vocab("priority", "High", null);
	const labelId = await vocab("label", "Bug", null);
	const [col] = await q<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
		 VALUES ($1, 'Requested', 1024, false) RETURNING id`,
		[WORKSPACE_ID],
	);
	return { columnId: col.id, statusId, priorityId, labelId };
}

async function insertCard(
	fx: Fixture,
	key: number,
	opts: {
		columnId?: number | null;
		deletedAt?: string | null;
		createdAt?: string;
		updatedAt?: string | null;
		title?: string;
	} = {},
): Promise<number> {
	const columnId = opts.columnId === undefined ? fx.columnId : opts.columnId;
	const columnLess = columnId === null;
	const [row] = await q<{ id: number }>(
		`INSERT INTO cards
		 (workspace_id, column_id, title, description, position, version, deleted_at,
		  created_at, updated_at, status_id, priority_id, key_number,
		  start_date, end_date, completed_at, plan_position)
		 VALUES ($1, $2, $3, 'desc', $4, 3, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		 RETURNING id`,
		[
			WORKSPACE_ID,
			columnId,
			opts.title ?? `item-${key}`,
			columnLess ? 0 : key * 1024,
			opts.deletedAt ?? null,
			opts.createdAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, key)).toISOString(),
			opts.updatedAt === undefined
				? columnLess
					? "2026-02-01T00:00:00.000Z"
					: null
				: opts.updatedAt,
			fx.statusId,
			fx.priorityId,
			key,
			columnLess ? "2026-03-01" : null,
			columnLess ? "2026-03-09" : null,
			columnLess ? "2026-03-05T00:00:00.000Z" : null,
			columnLess ? 2048 + key : null,
		],
	);
	return row.id;
}

async function seedReferenceWorkspace(fx: Fixture) {
	for (let key = 1; key <= BOARD_COUNT; key++) await insertCard(fx, key);
	const ids: number[] = [];
	for (let i = 0; i < COLUMN_LESS_COUNT; i++) {
		ids.push(await insertCard(fx, BOARD_COUNT + 1 + i, { columnId: null }));
	}
	await insertCard(fx, 900, {
		columnId: null,
		deletedAt: "2026-04-01T00:00:00Z",
	});
	return ids;
}

const listUrl = `/api/workspaces/${WORKSPACE_ID}/work-items`;

describe.skipIf(!process.env.RUN_INTEGRATION)("merged work item reads", () => {
	let fx: Fixture;

	beforeEach(async () => {
		fx = await resetWorkspace();
	});

	afterAll(async () => {
		await cleanWorkspace();
		await pool.end();
	});

	it("Reference workspace reads identically after merge", async () => {
		const columnLessIds = await seedReferenceWorkspace(fx);
		await q(
			"INSERT INTO card_labels (card_id, vocabulary_id) VALUES ($1, $2)",
			[columnLessIds[0], fx.labelId],
		);
		await q("INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2)", [
			columnLessIds[0],
			mockCurrentUser.id,
		]);

		const [user] = await q<{ username: string; display_name: string }>(
			"SELECT username, display_name FROM users WHERE id = $1",
			[mockCurrentUser.id],
		);
		const fromFunction = await listMergedWorkItems(
			db,
			WORKSPACE_ID,
			PREFIX,
			"",
		);
		const res = await request(app).get(listUrl);
		expect(res.status).toBe(200);
		const items = res.body as Array<Record<string, unknown>>;
		expect(JSON.parse(JSON.stringify(fromFunction))).toEqual(items);

		expect(items).toHaveLength(BOARD_COUNT + COLUMN_LESS_COUNT);
		expect(items.map((i) => i.key)).toEqual(
			Array.from({ length: 78 }, (_, i) => `${PREFIX}-${i + 1}`),
		);
		expect(items.find((i) => i.key === `${PREFIX}-900`)).toBeUndefined();
		for (const item of items) {
			const keyNumber = Number((item.key as string).split("-")[1]);
			expect(item.source).toBe(keyNumber <= BOARD_COUNT ? "board" : "tracker");
		}

		const board = items[0];
		expect(Object.keys(board)).toEqual(BOARD_KEYS);
		expect(board).toEqual({
			id: expect.any(Number),
			key: "TE-1",
			source: "board",
			title: "item-1",
			description: "desc",
			projectId: null,
			phaseId: null,
			startDate: null,
			endDate: null,
			completedAt: null,
			position: 1024,
			status: {
				id: fx.statusId,
				kind: "status",
				name: "Todo",
				position: 1024,
				colour: "blue",
				category: null,
				slot: "todo",
			},
			priority: {
				id: fx.priorityId,
				kind: "priority",
				name: "High",
				position: 1024,
				colour: "blue",
			},
			labels: [],
			assignees: [],
			version: 3,
			createdAt: "2026-01-01T00:00:01.000Z",
			updatedAt: "2026-01-01T00:00:01.000Z",
			columnId: fx.columnId,
			columnName: "Requested",
			dueDate: null,
			startedAt: null,
			doneAt: null,
		});

		const tracker = items[BOARD_COUNT];
		expect(Object.keys(tracker)).toEqual(TRACKER_KEYS);
		expect(tracker).toEqual({
			id: columnLessIds[0],
			key: "TE-26",
			source: "tracker",
			title: "item-26",
			description: "desc",
			projectId: null,
			phaseId: null,
			startDate: dateOnly(2026, 3, 1),
			endDate: dateOnly(2026, 3, 9),
			completedAt: "2026-03-05T00:00:00.000Z",
			position: 2048 + 26,
			status: board.status,
			priority: board.priority,
			labels: [
				{
					id: fx.labelId,
					kind: "label",
					name: "Bug",
					position: 1024,
					colour: "blue",
				},
			],
			assignees: [
				{
					id: mockCurrentUser.id,
					username: user.username,
					displayName: user.display_name,
				},
			],
			version: 3,
			createdAt: "2026-01-01T00:00:26.000Z",
			updatedAt: "2026-02-01T00:00:00.000Z",
		});
	});
	// Labeled regression guard: the single-query rewrite already keeps the
	// (column_id IS NULL OR board_id IS NULL) predicate, so this passes at first
	// run. It was proven able to fail by removing that predicate temporarily.
	it("Non-default-board cards stay excluded", async () => {
		for (let key = 1; key <= BOARD_COUNT; key++) await insertCard(fx, key);
		const [agentBoard] = await q<{ id: number }>(
			`INSERT INTO agent_boards (workspace_id, user_id, template_id, original_intent, status)
			 VALUES ($1, $2, 'status-report', 'test', 'approved') RETURNING id`,
			[WORKSPACE_ID, mockCurrentUser.id],
		);
		const [agentColumn] = await q<{ id: number }>(
			`INSERT INTO columns (workspace_id, board_id, title, position, slug)
			 VALUES ($1, $2, 'Analyst', 3072, 'analyst') RETURNING id`,
			[WORKSPACE_ID, agentBoard.id],
		);
		for (let key = 200; key < 218; key++) {
			await insertCard(fx, key, { columnId: agentColumn.id });
		}

		const res = await request(app).get(listUrl);

		expect(res.status).toBe(200);
		expect(res.body).toHaveLength(BOARD_COUNT);
		expect(
			res.body.some((i: { key: string }) => Number(i.key.split("-")[1]) >= 200),
		).toBe(false);
	});

	it("updatedAt falls back to the computed value", async () => {
		const stored = "2026-05-05T05:05:05.000Z";
		await insertCard(fx, 1, { columnId: null, updatedAt: stored });
		await insertCard(fx, 2, { columnId: null, updatedAt: null });
		await insertCard(fx, 3, { updatedAt: null });
		await insertCard(fx, 4, { updatedAt: stored });
		await q(
			"UPDATE cards SET started_at = $2, done_at = $3 WHERE workspace_id = $1 AND key_number IN (3, 4)",
			[WORKSPACE_ID, "2026-04-01T00:00:00Z", "2026-04-02T00:00:00Z"],
		);

		const res = await request(app).get(listUrl);

		expect(res.status).toBe(200);
		const byKey = Object.fromEntries(
			res.body.map((i: { key: string }) => [i.key, i]),
		);
		const computed = (key: number) =>
			computeCardUpdatedAt({
				done_at: key >= 3 ? "2026-04-02T00:00:00.000Z" : null,
				started_at: key >= 3 ? "2026-04-01T00:00:00.000Z" : null,
				created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, key)),
			});
		// Column-less item with a stored value: stored.
		expect(byKey["TE-1"].updatedAt).toBe(stored);
		// Column-less item with NULL: computed (created_at, nothing newer exists).
		expect(byKey["TE-2"].updatedAt).toBe(computed(2));
		// Board card with NULL: computed (done_at wins).
		expect(byKey["TE-3"].updatedAt).toBe(computed(3));
		expect(byKey["TE-3"].updatedAt).toBe("2026-04-02T00:00:00.000Z");
		// Board card with a stored value: stored.
		expect(byKey["TE-4"].updatedAt).toBe(stored);
	});

	describe("activity feed", () => {
		async function insertEvent(
			cardId: number | null,
			eventType: string,
			createdAt: string,
			payload: unknown = {},
			toColumnId: number | null = null,
		) {
			await q(
				`INSERT INTO card_events
				 (card_id, to_column_id, actor_id, event_type, payload, workspace_id, created_at)
				 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
				[
					cardId,
					toColumnId,
					mockCurrentUser.id,
					eventType,
					JSON.stringify(payload),
					WORKSPACE_ID,
					createdAt,
				],
			);
		}

		it("Unified feed shows each event once", async () => {
			const boardCard = await insertCard(fx, 1);
			const goneCard = await insertCard(fx, 2, {
				deletedAt: "2026-04-01T00:00:00Z",
			});
			const planned = await insertCard(fx, 26, { columnId: null });
			// Copied tracker events live in card_events (item and item-less).
			await insertEvent(
				planned,
				"tracker_item_created",
				"2026-01-10T00:00:00Z",
				{
					title: "item-26",
				},
			);
			await insertEvent(
				planned,
				"tracker_item_updated",
				"2026-01-11T00:00:00Z",
			);
			await insertEvent(boardCard, "create", "2026-01-12T00:00:00Z", {
				cardTitle: "item-1",
			});
			await insertEvent(
				boardCard,
				"move",
				"2026-01-13T00:00:00Z",
				{},
				fx.columnId,
			);
			await insertEvent(goneCard, "update", "2026-01-14T00:00:00Z", {
				cardTitle: "Gone",
			});
			await insertEvent(
				null,
				"tracker_project_created",
				"2026-01-15T00:00:00Z",
				{
					title: "Roadmap",
				},
			);
			// Pre-soft-delete board delete events (card_id NULL, not tracker_*) were
			// never part of the unified feed and stay out of it.
			await insertEvent(null, "delete", "2026-01-16T00:00:00Z", {
				cardTitle: "Ancient",
			});
			// The untouched legacy table holds the same events plus one more.
			const [legacy] = await q<{ id: number }>(
				`INSERT INTO tracker_items (workspace_id, key_number, title, status_id)
				 VALUES ($1, 26, 'item-26', $2) RETURNING id`,
				[WORKSPACE_ID, fx.statusId],
			);
			for (const [itemId, type, at] of [
				[legacy.id, "tracker_item_created", "2026-01-10T00:00:00Z"],
				[legacy.id, "tracker_item_updated", "2026-01-11T00:00:00Z"],
				[null, "tracker_project_created", "2026-01-15T00:00:00Z"],
				[legacy.id, "tracker_item_updated", "2026-01-20T00:00:00Z"],
			] as const) {
				await q(
					`INSERT INTO tracker_events (tracker_item_id, actor_id, event_type, payload, workspace_id, created_at)
					 VALUES ($1, $2, $3, '{"title":"Roadmap"}'::jsonb, $4, $5)`,
					[itemId, mockCurrentUser.id, type, WORKSPACE_ID, at],
				);
			}

			const events = await getUnifiedWorkspaceActivity(WORKSPACE_ID, 50);

			expect(events.map((e) => [e.source, e.eventType, e.title])).toEqual([
				["tracker", "tracker_project_created", "Roadmap"],
				["board", "tracker_item_updated", "Gone"],
				["board", "tracker_item_updated", "item-1"],
				["board", "tracker_item_created", "item-1"],
				["tracker", "tracker_item_updated", "item-26"],
				["tracker", "tracker_item_created", "item-26"],
			]);
			expect(new Set(events.map((e) => e.eventKey)).size).toBe(events.length);
			expect(events[2].payload).toEqual({
				field: "status",
				from: null,
				to: "Requested",
			});
		});

		it("Item events are read from card_events", async () => {
			const planned = await insertCard(fx, 26, { columnId: null });
			await insertEvent(
				planned,
				"tracker_item_created",
				"2026-01-10T00:00:00Z",
			);
			await insertEvent(
				planned,
				"tracker_item_updated",
				"2026-01-11T00:00:00Z",
			);

			const events = await getWorkItemEvents(db, WORKSPACE_ID, 26);

			expect(events?.map((e) => e.eventType)).toEqual([
				"tracker_item_updated",
				"tracker_item_created",
			]);
			expect(events?.[0].trackerItemId).toBe(planned);
			expect(await getWorkItemEvents(db, WORKSPACE_ID, 27)).toBeNull();
		});
	});
});
