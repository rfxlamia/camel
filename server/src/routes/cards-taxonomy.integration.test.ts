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

const { currentUser } = vi.hoisted(() => ({
	currentUser: {
		id: 1,
		username: "taxonomy-user",
		displayName: "Taxonomy User",
	},
}));

vi.mock("../db/redis.js", () => ({
	getRedisClient: vi.fn(),
	connectRedis: vi.fn(),
}));
vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn().mockResolvedValue(undefined),
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

import { pool } from "../db/pool.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { api } from "../routes.js";

const WORKSPACE_ID = 104;
const OTHER_WORKSPACE_ID = 105;
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);
app.use(createErrorHandler());

async function query<T extends object>(text: string, values: unknown[] = []) {
	return (await pool.query<T>(text, values)).rows;
}

async function cleanupWorkspace(workspaceId: number) {
	await pool.query(
		"DELETE FROM card_events WHERE workspace_id = $1",
		[workspaceId],
	);
	await pool.query(
		"DELETE FROM card_labels WHERE card_id IN (SELECT id FROM cards WHERE workspace_id = $1)",
		[workspaceId],
	);
	await pool.query(
		"DELETE FROM cards WHERE workspace_id = $1",
		[workspaceId],
	);
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
}

async function cleanup() {
	await cleanupWorkspace(WORKSPACE_ID);
	await cleanupWorkspace(OTHER_WORKSPACE_ID);
}

async function setupWorkspace(workspaceId: number, name: string) {
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, $2, 1, false) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
		[workspaceId, name],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, 1, 'owner') ON CONFLICT DO NOTHING",
		[workspaceId],
	);
	await pool.query(
		"INSERT INTO columns (workspace_id, title, position) VALUES ($1, 'Todo', 1024)",
		[workspaceId],
	);
	await pool.query(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, category, slot) VALUES ($1, 'status', 'Todo', 1024, 'blue', 'backlog', 'todo'), ($1, 'priority', 'High', 1024, 'red', NULL, NULL), ($1, 'priority', 'Low', 2048, 'green', NULL, NULL), ($1, 'label', 'Bug', 1024, 'orange', NULL, NULL), ($1, 'label', 'Feature', 2048, 'purple', NULL, NULL) ON CONFLICT DO NOTHING",
		[workspaceId],
	);
}

async function setup() {
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES (1, $1, $2, 'test') ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name",
		[currentUser.username, currentUser.displayName],
	);
	await setupWorkspace(WORKSPACE_ID, "Taxonomy WS");
	await setupWorkspace(OTHER_WORKSPACE_ID, "Other WS");
}

type Fixtures = {
	columnId: number;
	statusId: number;
	highPriorityId: number;
	lowPriorityId: number;
	bugLabelId: number;
	featureLabelId: number;
	projectAId: number;
	projectBId: number;
	phaseAId: number;
	phaseBId: number;
	otherWorkspacePriorityId: number;
	otherWorkspaceLabelId: number;
};

async function loadFixtures(workspaceId: number): Promise<Omit<
	Fixtures,
	"otherWorkspacePriorityId" | "otherWorkspaceLabelId"
>> {
	const [column] = await query<{ id: number }>(
		"SELECT id FROM columns WHERE workspace_id = $1",
		[workspaceId],
	);
	const vocabs = await query<{
		id: number;
		kind: string;
		name: string;
	}>("SELECT id, kind, name FROM tracker_vocabularies WHERE workspace_id = $1", [
		workspaceId,
	]);
	const status = vocabs.find((v) => v.kind === "status")!;
	const high = vocabs.find((v) => v.name === "High")!;
	const low = vocabs.find((v) => v.name === "Low")!;
	const bug = vocabs.find((v) => v.name === "Bug")!;
	const feature = vocabs.find((v) => v.name === "Feature")!;
	const [projectA, projectB] = await query<{ id: number }>(
		"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Project A', 1024), ($1, 'Project B', 2048) RETURNING id",
		[workspaceId],
	);
	const [phaseA, phaseB] = await query<{ id: number }>(
		"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'Phase A', 1024), ($2, 'Phase B', 2048) RETURNING id",
		[projectA.id, projectB.id],
	);
	return {
		columnId: column.id,
		statusId: status.id,
		highPriorityId: high.id,
		lowPriorityId: low.id,
		bugLabelId: bug.id,
		featureLabelId: feature.id,
		projectAId: projectA.id,
		projectBId: projectB.id,
		phaseAId: phaseA.id,
		phaseBId: phaseB.id,
	};
}

async function createCard(
	fixtures: Omit<
		Fixtures,
		"otherWorkspacePriorityId" | "otherWorkspaceLabelId"
	>,
	opts?: {
		projectId?: number | null;
		phaseId?: number | null;
		priorityId?: number | null;
	},
) {
	const [card] = await query<{ id: number; version: number }>(
		"INSERT INTO cards (workspace_id, column_id, title, position, status_id, project_id, phase_id, priority_id) VALUES ($1, $2, 'Card', 1024, $3, $4, $5, $6) RETURNING id, version",
		[
			WORKSPACE_ID,
			fixtures.columnId,
			fixtures.statusId,
			opts?.projectId ?? null,
			opts?.phaseId ?? null,
			opts?.priorityId ?? null,
		],
	);
	return card;
}

beforeEach(async () => {
	await cleanup();
	await setup();
});
afterEach(cleanup);
afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"PATCH /api/workspaces/:wid/cards/:id — taxonomy",
	() => {
		it("sets priority, labels, project, and phase with version bump, card_events, and GET hydration", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures);

			const patchRes = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({
					version: card.version,
					priorityId: fixtures.highPriorityId,
					labelIds: [fixtures.bugLabelId, fixtures.featureLabelId],
					projectId: fixtures.projectAId,
					phaseId: fixtures.phaseAId,
				});
			expect(patchRes.status).toBe(200);
			expect(patchRes.body.version).toBe(card.version + 1);
			expect(patchRes.body.priority?.id).toBe(fixtures.highPriorityId);
			expect(patchRes.body.labels.map((l: { id: number }) => l.id)).toEqual([
				fixtures.bugLabelId,
				fixtures.featureLabelId,
			]);
			expect(patchRes.body.projectId).toBe(fixtures.projectAId);
			expect(patchRes.body.phaseId).toBe(fixtures.phaseAId);

			const events = await query<{ event_type: string }>(
				"SELECT event_type FROM card_events WHERE card_id = $1 AND workspace_id = $2",
				[card.id, WORKSPACE_ID],
			);
			expect(events.some((e) => e.event_type === "update")).toBe(true);

			const getRes = await request(app).get(
				`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`,
			);
			expect(getRes.status).toBe(200);
			expect(getRes.body.priority?.id).toBe(fixtures.highPriorityId);
			expect(getRes.body.projectId).toBe(fixtures.projectAId);
			expect(getRes.body.phaseId).toBe(fixtures.phaseAId);
		});

		it("clears priority and labels to null/empty", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures, {
				priorityId: fixtures.highPriorityId,
				projectId: fixtures.projectAId,
				phaseId: fixtures.phaseAId,
			});
			await pool.query(
				"INSERT INTO card_labels (card_id, vocabulary_id) VALUES ($1, $2)",
				[card.id, fixtures.bugLabelId],
			);

			const patchRes = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({
					version: card.version,
					priorityId: null,
					labelIds: [],
					projectId: null,
					phaseId: null,
				});
			expect(patchRes.status).toBe(200);
			expect(patchRes.body.priority).toBeNull();
			expect(patchRes.body.labels).toEqual([]);
			expect(patchRes.body.projectId).toBeNull();
			expect(patchRes.body.phaseId).toBeNull();
		});

		it("returns 409 version_conflict with card payload when version is stale", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures, {
				priorityId: fixtures.lowPriorityId,
			});

			const patchRes = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({
					version: card.version - 1,
					priorityId: fixtures.highPriorityId,
				});
			expect(patchRes.status).toBe(409);
			expect(patchRes.body.code).toBe("version_conflict");
			expect(patchRes.body.card?.priority?.id).toBe(fixtures.lowPriorityId);

			const row = await query<{ priority_id: number }>(
				"SELECT priority_id FROM cards WHERE id = $1",
				[card.id],
			);
			expect(row[0]?.priority_id).toBe(fixtures.lowPriorityId);
		});

		it("rejects cross-workspace priority before mutation", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const otherVocabs = await query<{ id: number; kind: string }>(
				"SELECT id, kind FROM tracker_vocabularies WHERE workspace_id = $1 AND kind = 'priority'",
				[OTHER_WORKSPACE_ID],
			);
			const card = await createCard(fixtures);

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ priorityId: otherVocabs[0]!.id });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);

			const row = await query<{ priority_id: number | null }>(
				"SELECT priority_id FROM cards WHERE id = $1",
				[card.id],
			);
			expect(row[0]?.priority_id).toBeNull();
		});

		it("rejects wrong-kind vocabulary used as label before mutation", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures);

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ labelIds: [fixtures.highPriorityId] });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);

			const labels = await query(
				"SELECT vocabulary_id FROM card_labels WHERE card_id = $1",
				[card.id],
			);
			expect(labels).toHaveLength(0);
		});

		it("rejects cross-workspace project before mutation", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const [otherProject] = await query<{ id: number }>(
				"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Other', 1024) RETURNING id",
				[OTHER_WORKSPACE_ID],
			);
			const card = await createCard(fixtures);

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ projectId: otherProject.id });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);

			const row = await query<{ project_id: number | null }>(
				"SELECT project_id FROM cards WHERE id = $1",
				[card.id],
			);
			expect(row[0]?.project_id).toBeNull();
		});

		it("rejects phase-only PATCH when card has no project", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures);

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ phaseId: fixtures.phaseAId });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);

			const row = await query<{ phase_id: number | null }>(
				"SELECT phase_id FROM cards WHERE id = $1",
				[card.id],
			);
			expect(row[0]?.phase_id).toBeNull();
		});

		it("allows phase-only PATCH when phase belongs to the card effective project", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures, {
				projectId: fixtures.projectAId,
			});

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ phaseId: fixtures.phaseAId });
			expect(res.status).toBe(200);
			expect(res.body.projectId).toBe(fixtures.projectAId);
			expect(res.body.phaseId).toBe(fixtures.phaseAId);
		});

		it("rejects phase-only PATCH when phase belongs to another project", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures, {
				projectId: fixtures.projectAId,
			});

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ phaseId: fixtures.phaseBId });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);

			const row = await query<{ phase_id: number | null }>(
				"SELECT phase_id FROM cards WHERE id = $1",
				[card.id],
			);
			expect(row[0]?.phase_id).toBeNull();
		});

		it("rejects projectId null with non-null phase even when card has a project", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures, {
				projectId: fixtures.projectAId,
				phaseId: fixtures.phaseAId,
			});

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ projectId: null, phaseId: fixtures.phaseAId });
			expect(res.status).toBeGreaterThanOrEqual(400);
			expect(res.status).toBeLessThan(500);

			const row = await query<{ project_id: number | null; phase_id: number | null }>(
				"SELECT project_id, phase_id FROM cards WHERE id = $1",
				[card.id],
			);
			expect(row[0]?.project_id).toBe(fixtures.projectAId);
			expect(row[0]?.phase_id).toBe(fixtures.phaseAId);
		});

		it("allows labels-only PATCH without version (optional-version behavior)", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures);

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ labelIds: [fixtures.bugLabelId] });
			expect(res.status).toBe(200);
			expect(res.body.labels.map((l: { id: number }) => l.id)).toEqual([
				fixtures.bugLabelId,
			]);
			expect(res.body.version).toBe(card.version + 1);
		});

		it("rejects statusId on PATCH", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);
			const card = await createCard(fixtures);

			const res = await request(app)
				.patch(`/api/workspaces/${WORKSPACE_ID}/cards/${card.id}`)
				.send({ statusId: fixtures.statusId });
			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/statusId/i);
		});

		it("rejects statusId on POST", async () => {
			const fixtures = await loadFixtures(WORKSPACE_ID);

			const res = await request(app)
				.post(`/api/workspaces/${WORKSPACE_ID}/cards`)
				.send({
					columnId: fixtures.columnId,
					title: "New card",
					statusId: fixtures.statusId,
				});
			expect(res.status).toBe(400);
			expect(res.body.error).toMatch(/statusId/i);
		});
	},
);
