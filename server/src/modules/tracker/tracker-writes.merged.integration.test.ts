// server/src/modules/tracker/tracker-writes.merged.integration.test.ts
// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/tracker/tracker-writes.merged.integration.test.ts
// Tracker item writes land on `cards` rows with NULL column_id (single-table merge, T10).
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCurrentUser } = vi.hoisted(() => ({
	mockCurrentUser: { id: 1, username: "testuser", displayName: "Test User" },
}));

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

import { pool } from "../../db/pool.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { api } from "../../routes.js";

const WORKSPACE_ID = 7101; // Isolated from every other integration test.
const BASE = `/api/workspaces/${WORKSPACE_ID}`;

const VOCAB = [
	["status", "Backlog", 1024, "backlog", "backlog"],
	["status", "Todo", 2048, "backlog", "todo"],
	["status", "In Progress", 3072, "started", "in_progress"],
	["status", "Done", 4096, "completed", "done"],
	["status", "Canceled", 5120, "canceled", "canceled"],
	["label", "Feature", 1024, null, null],
	["label", "Bug", 2048, null, null],
] as const;

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createTestApp();

async function cleanupWorkspace() {
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM tracker_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query(
		"UPDATE workspaces SET tracker_key_counter = 0, name = 'Camel' WHERE id = $1",
		[WORKSPACE_ID],
	);
}

async function setupFixtures() {
	await pool.query(
		`INSERT INTO users (id, username, display_name, password_hash)
		 VALUES ($1, $2, $3, 'hashed') ON CONFLICT (id) DO NOTHING`,
		[mockCurrentUser.id, mockCurrentUser.username, mockCurrentUser.displayName],
	);
	await pool.query(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
		 VALUES ($1, 'Camel', $2, false) ON CONFLICT (id) DO NOTHING`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		`INSERT INTO workspace_members (workspace_id, user_id, role)
		 VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	for (const [kind, name, position, category, slot] of VOCAB) {
		await pool.query(
			`INSERT INTO tracker_vocabularies
			   (workspace_id, kind, name, position, colour, category, slot)
			 SELECT $1, $2, $3, $4, 'oklch(0.89 0.07 250)', $5, $6
			 WHERE NOT EXISTS (
			   SELECT 1 FROM tracker_vocabularies
			   WHERE workspace_id = $1 AND kind = $2 AND lower(name) = lower($3)
			 )`,
			[WORKSPACE_ID, kind, name, position, category, slot],
		);
	}
}

async function cardRows() {
	const { rows } = await pool.query(
		"SELECT * FROM cards WHERE workspace_id = $1 ORDER BY id",
		[WORKSPACE_ID],
	);
	return rows;
}

async function eventTypes(cardId: number): Promise<string[]> {
	const { rows } = await pool.query(
		"SELECT event_type FROM card_events WHERE card_id = $1 ORDER BY id",
		[cardId],
	);
	return rows.map((r) => r.event_type);
}

async function count(table: string): Promise<number> {
	const { rows } = await pool.query(
		`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`,
		[WORKSPACE_ID],
	);
	return rows[0].n;
}

beforeEach(async () => {
	await setupFixtures();
	await cleanupWorkspace();
});

afterAll(async () => {
	await cleanupWorkspace();
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM users WHERE id = 7101");
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"tracker writes on the merged table",
	() => {
		it("creates and updates an item as a column-less cards row", async () => {
			const first = await request(app)
				.post(`${BASE}/tracker/items`)
				.send({ title: "First" });
			expect(first.status).toBe(201);
			const second = await request(app)
				.post(`${BASE}/work-items`)
				.send({ title: "Second" });
			expect(second.status).toBe(201);
			expect(first.body.key).toBe("CA-1");
			expect(second.body.key).toBe("CA-2");

			const rows = await cardRows();
			expect(rows.map((r) => r.key_number)).toEqual([1, 2]);
			for (const row of rows) {
				expect(row.column_id).toBeNull();
				expect(row.plan_position).not.toBeNull();
				expect(row.position).toBe(0);
				expect(row.version).toBe(1);
				expect(row.updated_at).not.toBeNull();
			}
			expect(await count("tracker_items")).toBe(0);
			expect(await count("tracker_events")).toBe(0);
			expect(await eventTypes(first.body.id)).toEqual(["tracker_item_created"]);

			const patched = await request(app)
				.patch(`${BASE}/tracker/items/CA-1`)
				.send({ title: "First v2", version: 1 });
			expect(patched.status).toBe(200);
			expect(patched.body.title).toBe("First v2");
			expect(patched.body.version).toBe(2);
			expect((await cardRows())[0]).toMatchObject({
				title: "First v2",
				version: 2,
				column_id: null,
			});
			expect(await eventTypes(first.body.id)).toEqual([
				"tracker_item_created",
				"tracker_item_updated",
			]);

			const stale = await request(app)
				.patch(`${BASE}/tracker/items/CA-1`)
				.send({ title: "Stale", version: 1 });
			expect(stale.status).toBe(409);
			expect(stale.body.code).toBe("version_conflict");
			expect((await cardRows())[0]).toMatchObject({
				title: "First v2",
				version: 2,
			});
			expect(await eventTypes(first.body.id)).toHaveLength(2);
			expect(await count("tracker_items")).toBe(0);
			expect(await count("tracker_events")).toBe(0);
		});

		describe("soft-delete and reorder", () => {
			async function createThree() {
				const ids: number[] = [];
				for (const title of ["A", "B", "C"]) {
					const res = await request(app)
						.post(`${BASE}/tracker/items`)
						.send({ title });
					expect(res.status).toBe(201);
					ids.push(res.body.id);
				}
				return ids;
			}

			async function planPositions(): Promise<Record<string, number>> {
				const { rows } = await pool.query(
					"SELECT title, plan_position FROM cards WHERE workspace_id = $1",
					[WORKSPACE_ID],
				);
				return Object.fromEntries(rows.map((r) => [r.title, r.plan_position]));
			}

			it("reorders between neighbors by plan_position, never by board position", async () => {
				const [a, , c] = await createThree();
				// Board position is a placeholder; poison it so any read would reorder.
				await pool.query(
					"UPDATE cards SET position = 1000 - id WHERE workspace_id = $1",
					[WORKSPACE_ID],
				);
				const before = await planPositions();

				const res = await request(app)
					.patch(`${BASE}/tracker/items/CA-3/position`)
					.send({ beforeKey: "CA-1", afterKey: "CA-2" });
				expect(res.status).toBe(200);

				const after = await planPositions();
				expect(after.C).toBeGreaterThan(before.A);
				expect(after.C).toBeLessThan(before.B);
				expect(after.A).toBe(before.A);
				expect(after.B).toBe(before.B);
				const { rows } = await pool.query(
					"SELECT position, column_id FROM cards WHERE id = $1",
					[c],
				);
				expect(rows[0].column_id).toBeNull();
				expect(await eventTypes(c)).toEqual([
					"tracker_item_created",
					"tracker_item_updated",
				]);
				expect(await eventTypes(a)).toEqual(["tracker_item_created"]);
				expect(await count("tracker_items")).toBe(0);
			});

			it("rebalances plan_position when neighbors are too close", async () => {
				await createThree();
				await pool.query(
					"UPDATE cards SET plan_position = CASE title WHEN 'A' THEN 1 WHEN 'B' THEN 1.0000000000001 ELSE 5000 END WHERE workspace_id = $1",
					[WORKSPACE_ID],
				);
				const res = await request(app)
					.patch(`${BASE}/tracker/items/CA-3/position`)
					.send({ beforeKey: "CA-1", afterKey: "CA-2" });
				expect(res.status).toBe(200);
				const after = await planPositions();
				expect(after.A).toBeLessThan(after.C);
				expect(after.C).toBeLessThan(after.B);
				expect(after.B - after.A).toBeGreaterThan(1e-9);
			});

			it("soft-deletes with deleted_at, one event, 409 on stale version", async () => {
				const [, b] = await createThree();
				const stale = await request(app)
					.delete(`${BASE}/tracker/items/CA-2`)
					.send({ version: 9 });
				expect(stale.status).toBe(409);
				expect(stale.body.code).toBe("version_conflict");

				const del = await request(app)
					.delete(`${BASE}/tracker/items/CA-2`)
					.send({ version: 1 });
				expect(del.status).toBe(204);

				const { rows } = await pool.query(
					"SELECT deleted_at, column_id FROM cards WHERE id = $1",
					[b],
				);
				expect(rows[0].deleted_at).not.toBeNull();
				expect(rows[0].column_id).toBeNull();
				expect(await eventTypes(b)).toEqual([
					"tracker_item_created",
					"tracker_item_deleted",
				]);
				const again = await request(app)
					.delete(`${BASE}/tracker/items/CA-2`)
					.send({ version: 1 });
				expect(again.status).toBe(404);
				expect(await count("tracker_items")).toBe(0);
			});
		});

		describe("status change", () => {
			async function statusId(name: string): Promise<number> {
				const { rows } = await pool.query(
					"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'status' AND name = $2",
					[WORKSPACE_ID, name],
				);
				return rows[0].id;
			}

			async function row() {
				return (await cardRows())[0];
			}

			it("follows the tracker status rules and never assigns a column", async () => {
				const created = await request(app)
					.post(`${BASE}/tracker/items`)
					.send({ title: "Status item" });
				expect(created.body.status.name).toBe("Backlog");
				const id = created.body.id;

				const started = await request(app)
					.patch(`${BASE}/tracker/items/CA-1`)
					.send({ statusId: await statusId("In Progress"), version: 1 });
				expect(started.status).toBe(200);
				expect(started.body.status.name).toBe("In Progress");
				expect(started.body.version).toBe(2);
				expect(await row()).toMatchObject({
					status_id: await statusId("In Progress"),
					completed_at: null,
					version: 2,
					column_id: null,
				});

				const done = await request(app)
					.patch(`${BASE}/work-items/CA-1`)
					.send({ statusId: await statusId("Done"), version: 2 });
				expect(done.status).toBe(200);
				expect((await row()).completed_at).not.toBeNull();
				expect((await row()).version).toBe(3);

				const canceled = await request(app)
					.patch(`${BASE}/tracker/items/CA-1`)
					.send({ statusId: await statusId("Canceled"), version: 3 });
				expect(canceled.status).toBe(200);
				expect(await row()).toMatchObject({
					status_id: await statusId("Canceled"),
					completed_at: null,
					version: 4,
					column_id: null,
				});

				const { rows: events } = await pool.query(
					"SELECT event_type, payload FROM card_events WHERE card_id = $1 ORDER BY id",
					[id],
				);
				expect(events.map((e) => e.event_type)).toEqual([
					"tracker_item_created",
					"tracker_item_updated",
					"tracker_item_updated",
					"tracker_item_updated",
				]);
				expect(events[1].payload.changed).toEqual(["status"]);
				expect(await count("tracker_items")).toBe(0);
				expect(await count("tracker_events")).toBe(0);
			});

			it("returns 409 on a stale version and 400 on an unknown status", async () => {
				await request(app).post(`${BASE}/tracker/items`).send({ title: "S" });
				const stale = await request(app)
					.patch(`${BASE}/tracker/items/CA-1`)
					.send({ statusId: await statusId("Done"), version: 7 });
				expect(stale.status).toBe(409);
				expect(stale.body.code).toBe("version_conflict");
				expect(await row()).toMatchObject({ version: 1, completed_at: null });

				const invalid = await request(app)
					.patch(`${BASE}/tracker/items/CA-1`)
					.send({ statusId: 987654321, version: 1 });
				expect(invalid.status).toBe(400);
				expect(invalid.body.error).toBe("invalid status");
				expect((await row()).version).toBe(1);
			});
		});

		describe("labels and assignees", () => {
			const ASSIGNEE_ID = 7101;

			async function labelId(name: string): Promise<number> {
				const { rows } = await pool.query(
					"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'label' AND name = $2",
					[WORKSPACE_ID, name],
				);
				return rows[0].id;
			}

			async function junctions(cardId: number) {
				const labels = await pool.query(
					"SELECT vocabulary_id FROM card_labels WHERE card_id = $1 ORDER BY 1",
					[cardId],
				);
				const assignees = await pool.query(
					"SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY 1",
					[cardId],
				);
				const legacy = await pool.query(
					`SELECT
					   (SELECT count(*)::int FROM tracker_item_labels til
					      JOIN tracker_vocabularies v ON v.id = til.vocabulary_id
					      WHERE v.workspace_id = $2) AS labels,
					   (SELECT count(*)::int FROM tracker_item_assignees WHERE user_id = $1) AS assignees`,
					[ASSIGNEE_ID, WORKSPACE_ID],
				);
				return {
					labels: labels.rows.map((r) => r.vocabulary_id),
					assignees: assignees.rows.map((r) => r.user_id),
					legacy: legacy.rows[0],
				};
			}

			beforeEach(async () => {
				await pool.query(
					`INSERT INTO users (id, username, display_name, password_hash)
					 VALUES ($1, 'assignee7101', 'Assignee', 'hash') ON CONFLICT (id) DO NOTHING`,
					[ASSIGNEE_ID],
				);
				await pool.query(
					`INSERT INTO workspace_members (workspace_id, user_id, role)
					 VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
					[WORKSPACE_ID, ASSIGNEE_ID],
				);
			});

			it("adds then removes labels and assignees on card_labels / card_assignees", async () => {
				const bug = await labelId("Bug");
				const created = await request(app)
					.post(`${BASE}/tracker/items`)
					.send({
						title: "Tagged",
						labelIds: [bug],
						assigneeIds: [ASSIGNEE_ID],
					});
				expect(created.status).toBe(201);
				const id = created.body.id;
				expect(await junctions(id)).toMatchObject({
					labels: [bug],
					assignees: [ASSIGNEE_ID],
				});

				const feature = await labelId("Feature");
				const swapped = await request(app)
					.patch(`${BASE}/tracker/items/CA-1`)
					.send({ labelIds: [feature, bug], version: 1 });
				expect(swapped.status).toBe(200);
				expect(swapped.body.version).toBe(2);
				expect((await junctions(id)).labels).toEqual([bug, feature].sort());

				const cleared = await request(app)
					.patch(`${BASE}/tracker/items/CA-1`)
					.send({ labelIds: [], assigneeIds: [], version: 2 });
				expect(cleared.status).toBe(200);
				expect(cleared.body.labels).toEqual([]);
				expect(cleared.body.assignees).toEqual([]);
				expect(cleared.body.version).toBe(3);
				const after = await junctions(id);
				expect(after.labels).toEqual([]);
				expect(after.assignees).toEqual([]);
				expect(after.legacy).toEqual({ labels: 0, assignees: 0 });

				const events = await pool.query(
					"SELECT payload FROM card_events WHERE card_id = $1 AND event_type = 'tracker_item_updated' ORDER BY id",
					[id],
				);
				expect(events.rows.map((r) => r.payload.changed)).toEqual([
					["labels"],
					["assignees", "labels"],
				]);
				const stale = await request(app)
					.patch(`${BASE}/tracker/items/CA-1`)
					.send({ assigneeIds: [ASSIGNEE_ID], version: 1 });
				expect(stale.status).toBe(409);
				expect((await junctions(id)).assignees).toEqual([]);
			});
		});

		describe("promotion through PATCH", () => {
			it("rejects column_id with 400 {error, fieldErrors} and leaves the row unchanged", async () => {
				await request(app)
					.post(`${BASE}/tracker/items`)
					.send({ title: "Fixed" });
				const { rows: cols } = await pool.query(
					"SELECT id FROM columns ORDER BY id LIMIT 1",
				);
				const before = (await cardRows())[0];

				for (const body of [
					{ title: "Promoted", column_id: cols[0]?.id ?? 1, version: 1 },
					{ title: "Promoted", column_id: null, version: 1 },
				]) {
					const res = await request(app)
						.patch(`${BASE}/work-items/CA-1`)
						.send(body);
					expect(res.status).toBe(400);
					expect(typeof res.body.error).toBe("string");
					expect(res.body.fieldErrors).toEqual({
						column_id: expect.any(String),
					});
				}

				const after = (await cardRows())[0];
				expect(after).toMatchObject({
					title: before.title,
					version: before.version,
					column_id: null,
				});
				expect(await eventTypes(after.id)).toEqual(["tracker_item_created"]);
			});
		});
	},
);
