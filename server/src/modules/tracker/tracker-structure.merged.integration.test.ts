// server/src/modules/tracker/tracker-structure.merged.integration.test.ts
// Requires PostgreSQL. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/tracker/tracker-structure.merged.integration.test.ts
// Project, phase, vocabulary and member-removal paths on the merged `cards` table (single-table merge, T11).
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCurrentUser } = vi.hoisted(() => ({
	mockCurrentUser: { id: 7111, username: "t11-user", displayName: "T11 User" },
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

const WORKSPACE_ID = 7111; // Isolated from every other integration test.
const MEMBER_ID = 7112;
const BASE = `/api/workspaces/${WORKSPACE_ID}`;

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(cookieParser());
	app.use("/api", api);
	app.use(createErrorHandler());
	return app;
}

const app = createTestApp();

async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
	return (await pool.query(text, params)).rows as T[];
}

async function cleanupWorkspace() {
	await q("DELETE FROM card_events WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q("DELETE FROM tracker_events WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q(
		"DELETE FROM card_assignees WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[WORKSPACE_ID],
	);
	await q("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q("DELETE FROM columns WHERE workspace_id = $1", [WORKSPACE_ID]);
	await q(
		"DELETE FROM tracker_phases WHERE project_id IN (SELECT id FROM tracker_projects WHERE workspace_id = $1)",
		[WORKSPACE_ID],
	);
	await q("DELETE FROM tracker_projects WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await q(
		"DELETE FROM tracker_vocabularies WHERE workspace_id = $1 AND name <> 'Todo'",
		[WORKSPACE_ID],
	);
}

type Fixture = { columnId: number; statusId: number };

async function setupFixtures(): Promise<Fixture> {
	for (const [id, name] of [
		[mockCurrentUser.id, mockCurrentUser.username],
		[MEMBER_ID, "t11-member"],
	] as const) {
		await q(
			`INSERT INTO users (id, username, display_name, password_hash)
			 VALUES ($1, $2, $2, 'hashed') ON CONFLICT (id) DO NOTHING`,
			[id, name],
		);
	}
	await q(
		`INSERT INTO workspaces (id, name, owner_user_id, is_personal)
		 VALUES ($1, 'Camel', $2, false) ON CONFLICT (id) DO NOTHING`,
		[WORKSPACE_ID, mockCurrentUser.id],
	);
	for (const [id, role] of [
		[mockCurrentUser.id, "owner"],
		[MEMBER_ID, "member"],
	] as const) {
		await q(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
			 VALUES ($1, $2, $3) ON CONFLICT (workspace_id, user_id) DO NOTHING`,
			[WORKSPACE_ID, id, role],
		);
	}
	await cleanupWorkspace();
	const [status] = await q<{ id: number }>(
		`INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, category, slot)
		 VALUES ($1, 'status', 'Todo', 1024, 'blue', 'backlog', 'todo')
		 ON CONFLICT DO NOTHING RETURNING id`,
		[WORKSPACE_ID],
	);
	const statusId =
		status?.id ??
		(
			await q<{ id: number }>(
				"SELECT id FROM tracker_vocabularies WHERE workspace_id = $1 AND name = 'Todo'",
				[WORKSPACE_ID],
			)
		)[0].id;
	const [col] = await q<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
		 VALUES ($1, 'Requested', 1024, false) RETURNING id`,
		[WORKSPACE_ID],
	);
	return { columnId: col.id, statusId };
}

let fx: Fixture;
let keyCounter = 0;

async function insertProject(name: string): Promise<number> {
	return (
		await q<{ id: number }>(
			`INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, $2, 1024) RETURNING id`,
			[WORKSPACE_ID, name],
		)
	)[0].id;
}

async function insertPhase(projectId: number, name: string): Promise<number> {
	return (
		await q<{ id: number }>(
			`INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, $2, 1024) RETURNING id`,
			[projectId, name],
		)
	)[0].id;
}

/** Inserts a `cards` row; `columnId: null` makes it a Tracker item. */
async function insertCard(opts: {
	title: string;
	columnId: number | null;
	projectId?: number | null;
	phaseId?: number | null;
	planPosition?: number | null;
}): Promise<number> {
	keyCounter += 1;
	const columnLess = opts.columnId === null;
	return (
		await q<{ id: number }>(
			`INSERT INTO cards
			 (workspace_id, column_id, title, position, project_id, phase_id,
			  key_number, status_id, plan_position)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
			[
				WORKSPACE_ID,
				opts.columnId,
				opts.title,
				columnLess ? 0 : 1024,
				opts.projectId ?? null,
				opts.phaseId ?? null,
				keyCounter,
				fx.statusId,
				columnLess ? (opts.planPosition ?? 1024 * keyCounter) : null,
			],
		)
	)[0].id;
}

async function card(id: number) {
	return (await q("SELECT * FROM cards WHERE id = $1", [id]))[0];
}

async function structureEvents(type: string) {
	return q(
		"SELECT * FROM card_events WHERE workspace_id = $1 AND event_type = $2",
		[WORKSPACE_ID, type],
	);
}

async function legacyCount(table: string): Promise<number> {
	return (
		await q<{ n: number }>(
			`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`,
			[WORKSPACE_ID],
		)
	)[0].n;
}

beforeEach(async () => {
	keyCounter = 0;
	fx = await setupFixtures();
});

afterAll(async () => {
	await cleanupWorkspace();
	await q("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await q("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await q("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await q("DELETE FROM users WHERE id IN ($1, $2)", [
		mockCurrentUser.id,
		MEMBER_ID,
	]);
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"project, phase and vocabulary paths on the merged table",
	() => {
		it("project deletion releases column-less items and board cards", async () => {
			const project = await insertProject("Alpha");
			const phase = await insertPhase(project, "P1");
			const itemA = await insertCard({
				title: "item A",
				columnId: null,
				projectId: project,
				phaseId: phase,
			});
			const itemB = await insertCard({
				title: "item B",
				columnId: null,
				projectId: project,
			});
			const boardCard = await insertCard({
				title: "board",
				columnId: fx.columnId,
				projectId: project,
				phaseId: phase,
			});

			const res = await request(app).delete(
				`${BASE}/tracker/projects/${project}`,
			);
			expect(res.status).toBe(204);

			for (const id of [itemA, itemB, boardCard]) {
				expect(await card(id)).toMatchObject({
					project_id: null,
					phase_id: null,
				});
			}
			const events = await structureEvents("tracker_project_deleted");
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				card_id: null,
				workspace_id: WORKSPACE_ID,
				actor_id: mockCurrentUser.id,
			});
			expect(events[0].payload.projectId).toBe(project);
			expect(
				[...events[0].payload.released].sort(
					(a: any, b: any) => a.itemId - b.itemId,
				),
			).toEqual([
				{ itemId: itemA, projectId: project, phaseId: phase },
				{ itemId: itemB, projectId: project, phaseId: null },
			]);
			expect(await legacyCount("tracker_events")).toBe(0);
		});

		it("phase deletion releases items to the no-phase bucket", async () => {
			const project = await insertProject("Beta");
			const phase = await insertPhase(project, "P1");
			const resident = await insertCard({
				title: "resident",
				columnId: null,
				projectId: project,
				planPosition: 5000,
			});
			const itemA = await insertCard({
				title: "item A",
				columnId: null,
				projectId: project,
				phaseId: phase,
				planPosition: 1,
			});
			const itemB = await insertCard({
				title: "item B",
				columnId: null,
				projectId: project,
				phaseId: phase,
				planPosition: 2,
			});
			const boardCard = await insertCard({
				title: "board",
				columnId: fx.columnId,
				projectId: project,
				phaseId: phase,
			});

			const res = await request(app).delete(`${BASE}/tracker/phases/${phase}`);
			expect(res.status).toBe(204);

			const [a, b, r, c] = await Promise.all(
				[itemA, itemB, resident, boardCard].map(card),
			);
			expect(a).toMatchObject({ project_id: project, phase_id: null });
			expect(b).toMatchObject({ project_id: project, phase_id: null });
			expect(a.plan_position).toBeGreaterThan(r.plan_position);
			expect(b.plan_position).toBeGreaterThan(a.plan_position);
			expect(c).toMatchObject({ project_id: project, phase_id: null });
			const events = await structureEvents("tracker_phase_deleted");
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				card_id: null,
				workspace_id: WORKSPACE_ID,
			});
			expect(events[0].payload.released).toEqual([
				{ itemId: itemA, projectId: project, phaseId: phase },
				{ itemId: itemB, projectId: project, phaseId: phase },
			]);
			expect(await legacyCount("tracker_events")).toBe(0);
		});

		it("creating a vocabulary entry records one workspace-scoped event", async () => {
			const res = await request(app)
				.post(`${BASE}/tracker/vocabularies`)
				.send({ kind: "label", name: "Chore", position: 5000 });
			expect(res.status).toBe(201);

			const events = await structureEvents("tracker_vocabulary_created");
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				card_id: null,
				workspace_id: WORKSPACE_ID,
			});
			expect(events[0].payload).toMatchObject({
				kind: "label",
				name: "Chore",
			});
			expect(await legacyCount("tracker_events")).toBe(0);
		});
	},
);
