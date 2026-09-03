import "dotenv/config";
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
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import { domainBus, EVENTS } from "../events.js";
import { createErrorHandler } from "../middleware/error-handler.js";

const { mockPublishEvent, currentUser } = vi.hoisted(() => ({
	mockPublishEvent: vi.fn().mockResolvedValue(undefined),
	currentUser: { id: 1, username: "card-create-owner", displayName: "Owner" },
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
			req.user = currentUser;
			next();
		},
	};
});

import { api } from "../routes.js";

const WORKSPACE_ID = 106;
const RAFI_ID = 2;
const MAYA_ID = 3;
const app = express();
app.use(express.json());
app.use("/api", api);
app.use(createErrorHandler());

type Fixtures = {
	columnId: number;
	signableColumnId: number;
	priorityId: number;
	labelId: number;
	projectId: number;
	phaseId: number;
	otherProjectId: number;
	otherPhaseId: number;
};

async function query<T extends object>(text: string, values: unknown[] = []) {
	return (await pool.query<T>(text, values)).rows;
}

async function cleanup() {
	await pool.query("DELETE FROM card_events WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query(
		"DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[WORKSPACE_ID],
	);
	await pool.query(
		"DELETE FROM card_assignees WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[WORKSPACE_ID],
	);
	await pool.query("DELETE FROM cards WHERE workspace_id = $1", [WORKSPACE_ID]);
	await pool.query(
		"DELETE FROM tracker_phases WHERE project_id IN (SELECT id FROM tracker_projects WHERE workspace_id = $1)",
		[WORKSPACE_ID],
	);
	await pool.query("DELETE FROM tracker_projects WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM columns WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM tracker_vocabularies WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [
		WORKSPACE_ID,
	]);
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
}

async function setup(): Promise<Fixtures> {
	await cleanup();
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES (1, $1, $2, 'test'), (2, 'card-create-rafi', 'Rafi', 'test'), (3, 'card-create-maya', 'Maya', 'test') ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name",
		[currentUser.username, currentUser.displayName],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'Card Create Workspace', 1, false)",
		[WORKSPACE_ID],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, 1, 'owner'), ($1, 2, 'member'), ($1, 3, 'member')",
		[WORKSPACE_ID],
	);
	await seedTrackerVocabulary(db, WORKSPACE_ID);
	const columns = await query<{ id: number }>(
		"INSERT INTO columns (workspace_id, title, position, is_signable, signable_assignee_id) VALUES ($1, 'To do', 1024, false, NULL), ($1, 'Done', 2048, true, 2) RETURNING id",
		[WORKSPACE_ID],
	);
	const vocabularies = await query<{ id: number; kind: string }>(
		"SELECT id, kind FROM tracker_vocabularies WHERE workspace_id = $1",
		[WORKSPACE_ID],
	);
	const priorityId = vocabularies.find((v) => v.kind === "priority")!.id;
	const labelId = vocabularies.find((v) => v.kind === "label")!.id;
	const projects = await query<{ id: number }>(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Project A', 1024), ($1, 'Project B', 2048) RETURNING id",
		[WORKSPACE_ID],
	);
	const phases = await query<{ id: number }>(
		"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'Phase A', 1024), ($2, 'Phase B', 2048) RETURNING id",
		[projects[0]!.id, projects[1]!.id],
	);
	return {
		columnId: columns[0]!.id,
		signableColumnId: columns[1]!.id,
		priorityId,
		labelId,
		projectId: projects[0]!.id,
		otherProjectId: projects[1]!.id,
		phaseId: phases[0]!.id,
		otherPhaseId: phases[1]!.id,
	};
}

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("POST /cards — atomic metadata create", () => {
	let fixtures: Fixtures;

	beforeEach(async () => {
		mockPublishEvent.mockReset().mockResolvedValue(undefined);
		domainBus.removeAllListeners();
		fixtures = await setup();
	});
	afterEach(async () => {
		domainBus.removeAllListeners();
		await cleanup();
	});
	afterAll(async () => {
		await cleanup();
		await pool.end();
	});

	it("Deduplicate the same automatic and explicit assignee", async () => {
		const assigned: unknown[] = [];
		domainBus.on(EVENTS.CARD_ASSIGNED, (event) => assigned.push(event));
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.signableColumnId,
				title: "Same assignee",
				assigneeIds: [RAFI_ID],
			});
		expect(response.status).toBe(201);
		expect(
			await query("SELECT user_id FROM card_assignees WHERE card_id = $1", [
				response.body.id,
			]),
		).toHaveLength(1);
		expect(assigned).toHaveLength(1);
	});

	it("Create a fully configured Board card", async () => {
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Fix login",
				description: "Repair the login flow",
				dueDate: "2026-09-30",
				priorityId: fixtures.priorityId,
				labelIds: [fixtures.labelId],
				assigneeIds: [MAYA_ID],
				projectId: fixtures.projectId,
				phaseId: fixtures.phaseId,
			});
		expect(response.status).toBe(201);
		expect(response.body.title).toBe("Fix login");
		expect(response.body.description).toBe("Repair the login flow");
		expect(response.body.dueDate).toBe("2026-09-30");
		expect(response.body.priority.id).toBe(fixtures.priorityId);
		expect(
			response.body.labels.map((label: { id: number }) => label.id),
		).toEqual([fixtures.labelId]);
		expect(
			response.body.assignees.map((user: { id: number }) => user.id),
		).toEqual([MAYA_ID]);
		expect(
			await query("SELECT event_type FROM card_events WHERE card_id = $1", [
				response.body.id,
			]),
		).toHaveLength(1);
	});

	it("Merge explicit and signable-column assignees", async () => {
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.signableColumnId,
				title: "Two assignees",
				assigneeIds: [MAYA_ID],
			});
		expect(response.status).toBe(201);
		expect(
			response.body.assignees.map((user: { id: number }) => user.id).sort(),
		).toEqual([RAFI_ID, MAYA_ID]);
	});

	it("Reject a stale signable-column assignee", async () => {
		await pool.query(
			"DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
			[WORKSPACE_ID, RAFI_ID],
		);
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({ columnId: fixtures.signableColumnId, title: "Stale assignee" });
		expect(response.status).toBe(400);
		expect(response.body.fieldErrors.columnId).toMatch(/member/);
		expect(
			await query("SELECT id FROM cards WHERE workspace_id = $1", [
				WORKSPACE_ID,
			]),
		).toHaveLength(0);
	});

	it("Roll back every side effect on invalid create", async () => {
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Invalid",
				assigneeIds: [99999],
				labelIds: [99999],
				dueDate: "2026-02-30",
			});
		expect(response.status).toBe(400);
		expect(response.body.fieldErrors).toEqual(
			expect.objectContaining({
				assigneeIds: expect.any(String),
				labelIds: expect.any(String),
				dueDate: expect.any(String),
			}),
		);
		expect(
			await query("SELECT id FROM cards WHERE workspace_id = $1", [
				WORKSPACE_ID,
			]),
		).toHaveLength(0);
		expect(
			await query("SELECT id FROM card_events WHERE workspace_id = $1", [
				WORKSPACE_ID,
			]),
		).toHaveLength(0);
	});

	it("keeps committed Board success after publisher failure", async () => {
		mockPublishEvent.mockRejectedValueOnce(new Error("realtime unavailable"));
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({ columnId: fixtures.columnId, title: "Publisher failure" });
		expect(response.status).toBe(201);
		expect(
			await query("SELECT id FROM cards WHERE workspace_id = $1", [
				WORKSPACE_ID,
			]),
		).toHaveLength(1);
	});

	it("does not emit a due-date-change notification at creation", async () => {
		const dueDateEvents: unknown[] = [];
		domainBus.on(EVENTS.CARD_DUE_DATE_CHANGED, (event) =>
			dueDateEvents.push(event),
		);
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Initial due date",
				dueDate: "2026-10-01",
			});
		expect(response.status).toBe(201);
		expect(dueDateEvents).toHaveLength(0);
		const events = await query<{ payload: { dueDate?: string } }>(
			"SELECT payload FROM card_events WHERE card_id = $1",
			[response.body.id],
		);
		expect(events[0]!.payload.dueDate).toBe("2026-10-01");
	});

	it("rejects malformed Board due date atomically", async () => {
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Bad date",
				dueDate: "2026-13-40",
			});
		expect(response.status).toBe(400);
		expect(response.body.fieldErrors.dueDate).toBeDefined();
		expect(
			await query("SELECT id FROM cards WHERE workspace_id = $1", [
				WORKSPACE_ID,
			]),
		).toHaveLength(0);
	});

	it("preserves Board Phase inference and mismatch rejection", async () => {
		const inferred = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Inferred phase",
				phaseId: fixtures.phaseId,
			});
		expect(inferred.status).toBe(201);
		expect(inferred.body.projectId).toBe(fixtures.projectId);
		const mismatch = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Mismatched phase",
				projectId: fixtures.otherProjectId,
				phaseId: fixtures.phaseId,
			});
		expect(mismatch.status).toBe(400);
		expect(mismatch.body.fieldErrors.projectId).toBeDefined();
	});

	it("returns all invalid Board fields", async () => {
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.columnId,
				title: "Multiple invalid",
				priorityId: fixtures.labelId,
				labelIds: [fixtures.priorityId],
				projectId: fixtures.otherProjectId,
				phaseId: fixtures.phaseId,
				assigneeIds: [99999],
			});
		expect(response.status).toBe(400);
		expect(response.body.fieldErrors).toEqual(
			expect.objectContaining({
				priorityId: expect.any(String),
				labelIds: expect.any(String),
				projectId: expect.any(String),
				phaseId: expect.any(String),
				assigneeIds: expect.any(String),
			}),
		);
	});

	it("keeps Board success when assignment notification fails", async () => {
		let publications = 0;
		domainBus.on(EVENTS.CARD_ASSIGNED, () => {
			publications += 1;
			throw new Error("assignment publisher unavailable");
		});
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({
				columnId: fixtures.signableColumnId,
				title: "Notification failure",
			});
		expect(response.status).toBe(201);
		expect(publications).toBe(1);
	});

	it("constructs the Board response before commit completes", async () => {
		const response = await request(app)
			.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
			.send({ columnId: fixtures.columnId, title: "Hydrated before commit" });
		expect(response.status).toBe(201);
		expect(response.body.id).toBeDefined();
		expect(response.body.assignees).toEqual([]);
	});
});
