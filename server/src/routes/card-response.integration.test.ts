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
		username: "card-response-user",
		displayName: "Card Response User",
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
import * as cardAssignees from "./card-assignees.js";
import * as cardResponse from "./card-response.js";

const WORKSPACE_ID = 103;
const ALICE_ID = 99103;
const BOB_ID = 99104;
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);
app.use(createErrorHandler());

const labelsQuerySpy = vi.spyOn(cardResponse, "loadCardLabelsForCards");
const assigneesQuerySpy = vi.spyOn(cardAssignees, "loadCardAssigneesForCards");

async function query<T extends object>(text: string, values: unknown[] = []) {
	return (await pool.query<T>(text, values)).rows;
}

async function cleanup() {
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

async function setup() {
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES (1, $1, $2, 'test') ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name",
		[currentUser.username, currentUser.displayName],
	);
	await pool.query(
		"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 'alice-card-response', 'Alice', 'test'), ($2, 'bob-card-response', 'Bob', 'test') ON CONFLICT (id) DO NOTHING",
		[ALICE_ID, BOB_ID],
	);
	await pool.query(
		"INSERT INTO workspaces (id, name, owner_user_id, is_personal) VALUES ($1, 'Camel Team', 1, false) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
		[WORKSPACE_ID],
	);
	await pool.query(
		"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, 1, 'owner'), ($1, $2, 'member'), ($1, $3, 'member') ON CONFLICT DO NOTHING",
		[WORKSPACE_ID, ALICE_ID, BOB_ID],
	);
	await pool.query(
		"INSERT INTO columns (workspace_id, title, position) VALUES ($1, 'Todo', 1024)",
		[WORKSPACE_ID],
	);
	await pool.query(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, category, slot) VALUES ($1, 'status', 'Todo', 1024, 'blue', 'backlog', 'todo'), ($1, 'priority', 'High', 1024, 'red', NULL, NULL), ($1, 'priority', 'Low', 2048, 'green', NULL, NULL), ($1, 'label', 'Bug', 1024, 'orange', NULL, NULL), ($1, 'label', 'Feature', 2048, 'purple', NULL, NULL), ($1, 'label', 'Docs', 3072, 'blue', NULL, NULL) ON CONFLICT DO NOTHING",
		[WORKSPACE_ID],
	);
}

beforeEach(async () => {
	await cleanup();
	await setup();
	labelsQuerySpy.mockClear();
	assigneesQuerySpy.mockClear();
});
afterEach(cleanup);
afterAll(async () => {
	await cleanup();
	await pool.end();
});

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"card response board hydration",
	() => {
		it("returns one hydrated card per row and batches labels and assignees", async () => {
			const [column] = await query<{ id: number }>(
				"SELECT id FROM columns WHERE workspace_id = $1",
				[WORKSPACE_ID],
			);
			const vocabs = await query<{ id: number; kind: string; name: string }>(
				"SELECT id, kind, name FROM tracker_vocabularies WHERE workspace_id = $1",
				[WORKSPACE_ID],
			);
			const status = vocabs.find((v) => v.kind === "status")!;
			const high = vocabs.find((v) => v.name === "High")!;
			const low = vocabs.find((v) => v.name === "Low")!;
			const labels = vocabs.filter((v) => v.kind === "label");
			const [project, projectB] = await query<{ id: number }>(
				"INSERT INTO tracker_projects (workspace_id, name, position) VALUES ($1, 'Project A', 1024), ($1, 'Project B', 2048) RETURNING id",
				[WORKSPACE_ID],
			);
			const [phase, phaseB] = await query<{ id: number }>(
				"INSERT INTO tracker_phases (project_id, name, position) VALUES ($1, 'Phase A', 1024), ($2, 'Phase B', 2048) RETURNING id",
				[project.id, projectB.id],
			);
			const cards = await query<{ id: number }>(
				"INSERT INTO cards (workspace_id, column_id, title, description, position, created_at, started_at, done_at, due_date, key_number, status_id, priority_id, project_id, phase_id) VALUES ($1, $2, 'First', 'First description', 1024, '2026-08-29T10:00:00.000Z', '2026-08-30T10:00:00.000Z', NULL, '2026-09-05', 1, $3, $4, $5, $6), ($1, $2, 'Second', 'Second description', 2048, '2026-08-29T11:00:00.000Z', NULL, '2026-08-31T10:00:00.000Z', '2026-09-06', 2, $3, $7, $8, $9), ($1, $2, 'Third', 'Third description', 3072, '2026-08-29T12:00:00.000Z', NULL, NULL, NULL, 3, $3, NULL, NULL, NULL) RETURNING id",
				[
					WORKSPACE_ID,
					column.id,
					status.id,
					high.id,
					project.id,
					phase.id,
					low.id,
					projectB.id,
					phaseB.id,
				],
			);
			for (const card of cards) {
				await pool.query(
					"INSERT INTO card_labels (card_id, vocabulary_id) VALUES ($1, $2), ($1, $3)",
					[card.id, labels[0]!.id, labels[1]!.id],
				);
			}
			await pool.query(
				"INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $3), ($2, $4)",
				[cards[0]!.id, cards[1]!.id, ALICE_ID, BOB_ID],
			);

			const expectedLabels = [
				{
					id: labels.find((label) => label.name === "Bug")!.id,
					kind: "label",
					name: "Bug",
					position: 1024,
					colour: "orange",
				},
				{
					id: labels.find((label) => label.name === "Feature")!.id,
					kind: "label",
					name: "Feature",
					position: 2048,
					colour: "purple",
				},
			];
			const expectedStatus = {
				id: status.id,
				kind: "status",
				name: "Todo",
				position: 1024,
				colour: "blue",
				category: "backlog",
				slot: "todo",
			};
			const expectedCards = [
				{
					id: cards[0]!.id,
					key: "CT-1",
					columnId: column.id,
					title: "First",
					description: "First description",
					position: 1024,
					version: 1,
					createdAt: "2026-08-29T10:00:00.000Z",
					startedAt: "2026-08-30T10:00:00.000Z",
					doneAt: null,
					dueDate: "2026-09-05",
					status: expectedStatus,
					priority: {
						id: high.id,
						kind: "priority",
						name: "High",
						position: 1024,
						colour: "red",
					},
					labels: expectedLabels,
					projectId: project.id,
					phaseId: phase.id,
					assignees: [
						{
							id: ALICE_ID,
							username: "alice-card-response",
							displayName: "Alice",
						},
					],
				},
				{
					id: cards[1]!.id,
					key: "CT-2",
					columnId: column.id,
					title: "Second",
					description: "Second description",
					position: 2048,
					version: 1,
					createdAt: "2026-08-29T11:00:00.000Z",
					startedAt: null,
					doneAt: "2026-08-31T10:00:00.000Z",
					dueDate: "2026-09-06",
					status: expectedStatus,
					priority: {
						id: low.id,
						kind: "priority",
						name: "Low",
						position: 2048,
						colour: "green",
					},
					labels: expectedLabels,
					projectId: projectB.id,
					phaseId: phaseB.id,
					assignees: [
						{
							id: BOB_ID,
							username: "bob-card-response",
							displayName: "Bob",
						},
					],
				},
				{
					id: cards[2]!.id,
					key: "CT-3",
					columnId: column.id,
					title: "Third",
					description: "Third description",
					position: 3072,
					version: 1,
					createdAt: "2026-08-29T12:00:00.000Z",
					startedAt: null,
					doneAt: null,
					dueDate: null,
					status: expectedStatus,
					priority: null,
					labels: expectedLabels,
					projectId: null,
					phaseId: null,
					assignees: [],
				},
			];

			const board = await request(app).get(
				`/api/workspaces/${WORKSPACE_ID}/board`,
			);
			expect(board.status).toBe(200);
			const boardCards = board.body.columns.flatMap(
				(entry: { cards: unknown[] }) => entry.cards,
			);
			expect(boardCards).toEqual(expectedCards);
			expect(
				new Set(boardCards.map((card: { id: number }) => card.id)).size,
			).toBe(cards.length);
			const cardIds = cards.map((card) => card.id);
			expect(labelsQuerySpy).toHaveBeenCalledTimes(1);
			expect(labelsQuerySpy.mock.calls[0]?.[1]).toEqual(cardIds);
			expect(assigneesQuerySpy).toHaveBeenCalledTimes(1);
			expect(assigneesQuerySpy.mock.calls[0]?.[1]).toEqual(cardIds);

			const card = await request(app).get(
				`/api/workspaces/${WORKSPACE_ID}/cards/${cards[1]!.id}`,
			);
			expect(card.status).toBe(200);
			const individualCard = { ...card.body };
			delete individualCard.workspaceId;
			expect(individualCard).toEqual(expectedCards[1]);
			expect(card.body.workspaceId).toBe(WORKSPACE_ID);
		});
	},
);
