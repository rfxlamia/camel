import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPublishEvent, mockCurrentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	mockCurrentUser: { id: 20410, username: "t7-actor", displayName: "T7 Actor" },
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
			req.user = mockCurrentUser;
			next();
		},
	};
});

import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

const WORKSPACE_ID = 2041;
const OTHER_WORKSPACE_ID = 2042;
const ASSIGNEE_ID = 20411;

type Fixtures = {
	statusId: number;
	priorityId: number;
	labelId: number;
	otherPriorityId: number;
	otherLabelId: number;
	projectId: number;
	phaseId: number;
	otherProjectId: number;
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

async function idFor(query: string, values: unknown[]): Promise<number> {
	const result = await pool.query<{ id: number }>(query, values);
	return result.rows[0]!.id;
}

async function cleanup(): Promise<void> {
	await pool.query(
		"DELETE FROM tracker_item_assignees WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id IN ($1, $2))",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM tracker_item_labels WHERE tracker_item_id IN (SELECT id FROM tracker_items WHERE workspace_id IN ($1, $2))",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM tracker_events WHERE workspace_id IN ($1, $2)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM tracker_phases WHERE project_id IN (SELECT id FROM tracker_projects WHERE workspace_id IN ($1, $2))",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM tracker_projects WHERE workspace_id IN ($1, $2)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query("DELETE FROM tracker_items WHERE workspace_id IN ($1, $2)", [
		WORKSPACE_ID,
		OTHER_WORKSPACE_ID,
	]);
	await pool.query(
		"DELETE FROM tracker_vocabularies WHERE workspace_id IN ($1, $2)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM workspace_members WHERE workspace_id IN ($1, $2)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID],
	);
	await pool.query("DELETE FROM workspaces WHERE id IN ($1, $2)", [
		WORKSPACE_ID,
		OTHER_WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [
		mockCurrentUser.id,
		ASSIGNEE_ID,
	]);
}

async function setup(): Promise<Fixtures> {
	await cleanup();
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 't7-actor', 'T7 Actor', 'test'), ($2, 't7-assignee', 'T7 Assignee', 'test')",
		[mockCurrentUser.id, ASSIGNEE_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'T7 Workspace', $3, false), ($2, 'T7 Other', $3, false)",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID, mockCurrentUser.id],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $3, 'owner'), ($1, $4, 'member'), ($2, $3, 'owner')",
		[WORKSPACE_ID, OTHER_WORKSPACE_ID, mockCurrentUser.id, ASSIGNEE_ID],
	);
	const statusId = await idFor(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'status', 'Backlog', 1, 'blue') RETURNING id",
		[WORKSPACE_ID],
	);
	const priorityId = await idFor(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'priority', 'T7 High', 2, 'blue') RETURNING id",
		[WORKSPACE_ID],
	);
	const labelId = await idFor(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'label', 'T7 Label', 3, 'blue') RETURNING id",
		[WORKSPACE_ID],
	);
	const otherPriorityId = await idFor(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'priority', 'T7 Other priority', 1, 'blue') RETURNING id",
		[OTHER_WORKSPACE_ID],
	);
	const otherLabelId = await idFor(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour) VALUES ($1, 'label', 'T7 Other label', 2, 'blue') RETURNING id",
		[OTHER_WORKSPACE_ID],
	);
	const projectId = await idFor(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'T7 Project', 1) RETURNING id",
		[WORKSPACE_ID],
	);
	const otherProjectId = await idFor(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'T7 Other project', 1) RETURNING id",
		[OTHER_WORKSPACE_ID],
	);
	const phaseId = await idFor(
		"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'T7 Phase', 1) RETURNING id",
		[projectId],
	);
	return {
		statusId,
		priorityId,
		labelId,
		otherPriorityId,
		otherLabelId,
		projectId,
		phaseId,
		otherProjectId,
	};
}

async function trackerCount(): Promise<number> {
	const result = await pool.query<{ count: string }>(
		"SELECT count(*)::text AS count FROM tracker_items WHERE workspace_id = $1",
		[WORKSPACE_ID],
	);
	return Number(result.rows[0]!.count);
}

beforeEach(async () => {
	await setup();
	mockPublishEvent.mockReset();
	mockPublishEvent.mockResolvedValue(undefined);
});

afterAll(async () => {
	await cleanup();
});

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("strict Tracker item creation", () => {
	it("Create a fully configured Tracker item", async () => {
		const fixtures = await setup();
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/work-items`)
			.send({
				title: "Ship onboarding",
				description: "All supported fields",
				statusId: fixtures.statusId,
				priorityId: fixtures.priorityId,
				labelIds: [fixtures.labelId],
				assigneeIds: [ASSIGNEE_ID],
				projectId: fixtures.projectId,
				phaseId: fixtures.phaseId,
				startDate: "2026-09-21",
				endDate: "2026-09-30",
			});

		expect(res.status).toBe(201);
		expect(res.body).toMatchObject({
			title: "Ship onboarding",
			source: "tracker",
			projectId: fixtures.projectId,
			phaseId: fixtures.phaseId,
		});
		const item = await pool.query<{
			id: number;
			start_date: string;
			end_date: string;
		}>(
			"SELECT id, start_date::text, end_date::text FROM tracker_items WHERE workspace_id = $1",
			[WORKSPACE_ID],
		);
		expect(item.rows[0]).toMatchObject({
			start_date: "2026-09-21",
			end_date: "2026-09-30",
		});
		expect(item.rows).toHaveLength(1);
		const labels = await pool.query(
			"SELECT * FROM tracker_item_labels WHERE tracker_item_id = $1",
			[item.rows[0]!.id],
		);
		const assignees = await pool.query(
			"SELECT * FROM tracker_item_assignees WHERE tracker_item_id = $1",
			[item.rows[0]!.id],
		);
		expect(labels.rows).toHaveLength(1);
		expect(assignees.rows).toHaveLength(1);
		const events = await pool.query(
			"SELECT * FROM tracker_events WHERE workspace_id = $1 AND tracker_item_id = $2",
			[WORKSPACE_ID, item.rows[0]!.id],
		);
		expect(events.rows).toHaveLength(1);
		const cards = await pool.query(
			"SELECT id FROM cards WHERE workspace_id = $1",
			[WORKSPACE_ID],
		);
		expect(cards.rows).toHaveLength(0);
	});

	it("rejects invalid Tracker metadata atomically", async () => {
		const fixtures = await setup();
		await pool.query(
			"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[WORKSPACE_ID, ASSIGNEE_ID],
		);
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/work-items`)
			.send({
				title: "Invalid metadata",
				statusId: fixtures.priorityId,
				priorityId: fixtures.otherPriorityId,
				labelIds: [fixtures.otherLabelId],
				assigneeIds: [ASSIGNEE_ID],
				projectId: fixtures.otherProjectId,
				phaseId: fixtures.phaseId,
				startDate: "2026-09-40",
				endDate: "2026-09-01",
			});

		expect(res.status).toBe(400);
		expect(res.body.fieldErrors).toEqual(
			expect.objectContaining({
				statusId: expect.any(String),
				priorityId: expect.any(String),
				labelIds: expect.any(String),
				assigneeIds: expect.any(String),
				projectId: expect.any(String),
				phaseId: expect.any(String),
				startDate: expect.any(String),
				endDate: expect.any(String),
			}),
		);
		expect(await trackerCount()).toBe(0);
		expect(
			(await pool.query("SELECT * FROM tracker_events WHERE workspace_id = $1", [
				WORKSPACE_ID,
			])).rows,
		).toHaveLength(0);
	});

	it("rolls back invalid Tracker create side effects", async () => {
		const fixtures = await setup();
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/work-items`)
			.send({
				title: "Rollback invalid",
				statusId: fixtures.priorityId,
				priorityId: fixtures.otherPriorityId,
				labelIds: [fixtures.otherLabelId],
				startDate: "not-a-date",
				endDate: "2026-09-01",
			});
		expect(res.status).toBe(400);
		expect(await trackerCount()).toBe(0);
		expect(
			(
				await pool.query(
					"SELECT til.* FROM tracker_item_labels AS til JOIN tracker_items AS ti ON ti.id = til.tracker_item_id WHERE ti.workspace_id = $1",
					[WORKSPACE_ID],
				)
			).rows,
		).toHaveLength(0);
		expect(mockPublishEvent).not.toHaveBeenCalled();
	});

	it("keeps committed Tracker success after publisher failure", async () => {
		const fixtures = await setup();
		mockPublishEvent.mockRejectedValueOnce(new Error("publisher unavailable"));
		const res = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/work-items`)
			.send({ title: "Publisher failure", statusId: fixtures.statusId });
		expect(res.status).toBe(201);
		expect(res.body.title).toBe("Publisher failure");
		expect(await trackerCount()).toBe(1);
	});

	it("preserves Tracker Phase inference and mismatch rejection", async () => {
		const fixtures = await setup();
		const inferred = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/work-items`)
			.send({ title: "Inferred phase", phaseId: fixtures.phaseId });
		expect(inferred.status).toBe(201);
		expect(inferred.body.projectId).toBe(fixtures.projectId);

		const mismatch = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/work-items`)
			.send({
				title: "Mismatched phase",
				projectId: fixtures.otherProjectId,
				phaseId: fixtures.phaseId,
			});
		expect(mismatch.status).toBe(400);
		expect(mismatch.body.fieldErrors).toEqual(
			expect.objectContaining({
				projectId: expect.any(String),
				phaseId: expect.any(String),
			}),
		);
		expect(await trackerCount()).toBe(1);
	});

	it("constructs the Tracker response before commit completes", async () => {
		const fixtures = await setup();
		const statements: string[] = [];
		const originalConnect = pool.connect.bind(pool);
		const connectSpy = vi.spyOn(pool, "connect").mockImplementation((async () => {
			const client = await originalConnect();
			const originalQuery = client.query.bind(client);
			(client as any).query = (...args: any[]) => {
				const query = args[0];
				statements.push(String(typeof query === "string" ? query : query.text));
				return originalQuery(...args);
			};
			return client;
		}) as any);
		try {
			const res = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/work-items`)
				.send({ title: "Hydrated before commit", statusId: fixtures.statusId });
			expect(res.status).toBe(201);
			const commitIndex = statements.findIndex((sql) => /^COMMIT/i.test(sql));
			expect(commitIndex).toBeGreaterThan(-1);
			const hydrationQueries = statements.filter((sql) =>
				/SELECT .*tracker_(items|item_assignees|item_labels)/is.test(sql),
			);
			expect(hydrationQueries.length).toBeGreaterThan(0);
			const firstHydration = statements.findIndex((sql) =>
				/SELECT .*tracker_(items|item_assignees|item_labels)/is.test(sql),
			);
			expect(firstHydration).toBeLessThan(commitIndex);
		} finally {
			connectSpy.mockRestore();
		}
	});
});
