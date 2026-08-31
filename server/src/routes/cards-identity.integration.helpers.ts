import { expect, it } from "vitest";
import request from "supertest";
import { pool } from "../db/pool.js";
import { seedDemoCards } from "../db/seed.js";

const agentIntent = "prepare a research report";

type AddColumn = (
	title: string,
	position: number,
	isDone?: boolean,
	boardId?: number | null,
) => Promise<number>;

type IdentityTestContext = {
	app: Parameters<typeof request>[0];
	workspaceId: number;
	addColumn: AddColumn;
};

type AgentCard = {
	key_number: number;
	status_id: number;
	status_slot: string;
	slug: string;
	position: number;
	is_done: boolean;
};

async function waitForAgentCompletion(boardId: number) {
	let executionStatus = "running";
	for (let attempt = 0; attempt < 80; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 25));
		const board = await pool.query<{ execution_status: string }>(
			"SELECT execution_status FROM agent_boards WHERE id = $1",
			[boardId],
		);
		executionStatus = board.rows[0]?.execution_status ?? "missing";
		if (executionStatus === "done" || executionStatus === "failed") break;
	}
	return executionStatus;
}

async function readAgentCards(boardId: number) {
	const result = await pool.query<AgentCard>(
		`SELECT c.key_number, c.status_id, v.slot AS status_slot,
				col.slug, col.position, col.is_done
			 FROM cards c
			 JOIN columns col ON col.id = c.column_id
			 JOIN tracker_vocabularies v ON v.id = c.status_id
			 WHERE col.board_id = $1
			 ORDER BY col.position, c.id`,
		[boardId],
	);
	return result.rows;
}

function assertAgentCards(cards: AgentCard[]) {
	expect(cards).toHaveLength(5);
	expect(cards.map((card) => card.key_number)).toEqual([1, 2, 3, 4, 5]);
	expect(cards.map((card) => `IT-${card.key_number}`)).toEqual([
		"IT-1",
		"IT-2",
		"IT-3",
		"IT-4",
		"IT-5",
	]);
	expect(
		cards.map(({ slug, position, is_done }) => ({
			slug,
			position,
			is_done,
		})),
	).toEqual([
		{ slug: "research-specialist", position: 1, is_done: false },
		{ slug: "analysis-specialist", position: 2, is_done: false },
		{ slug: "writer", position: 3, is_done: false },
		{ slug: "editor", position: 4, is_done: false },
		{ slug: "qa-guardian", position: 5, is_done: false },
	]);
	for (const card of cards) {
		expect(card.status_id).toEqual(expect.any(Number));
	}
	expect(cards.map((card) => card.status_slot)).toEqual([
		"backlog",
		"todo",
		"in_progress",
		"in_progress",
		"in_progress",
	]);
}

async function assertNoAgentEvents(workspaceId: number) {
	const events = await pool.query<{ n: number }>(
		"SELECT count(*)::int AS n FROM card_events WHERE workspace_id = $1",
		[workspaceId],
	);
	expect(events.rows[0]!.n).toBe(0);
}

async function createAndApproveAgentBoard(
	app: Parameters<typeof request>[0],
	workspaceId: number,
) {
	const created = await request(app)
		.post(`/api/workspaces/${workspaceId}/agent/boards`)
		.send({ intent: agentIntent });
	expect(created.status).toBe(201);
	const approved = await request(app).post(
		`/api/workspaces/${workspaceId}/agent/boards/${created.body.boardId}/approve`,
	);
	expect(approved.status).toBe(200);
	return created.body.boardId as number;
}

async function assertSeedCards(
	workspaceId: number,
	columnIds: number[],
	columns: readonly { isDone: boolean }[],
) {
	await seedDemoCards(workspaceId, columnIds, columns);
	const cards = await pool.query<{
		title: string;
		key_number: number;
		status_id: number;
		status_slot: string;
	}>(
		`SELECT c.title, c.key_number, c.status_id, v.slot AS status_slot
		 FROM cards c
		 JOIN tracker_vocabularies v ON v.id = c.status_id
		 WHERE c.workspace_id = $1 ORDER BY c.id`,
		[workspaceId],
	);
	expect(cards.rows).toHaveLength(6);
	expect(cards.rows.map((card) => card.key_number)).toEqual([1, 2, 3, 4, 5, 6]);
	expect(new Set(cards.rows.map((card) => card.key_number)).size).toBe(6);
	expect(cards.rows.every((card) => card.status_id !== null)).toBe(true);
	expect(cards.rows.map((card) => card.status_slot)).toEqual([
		"backlog",
		"backlog",
		"todo",
		"todo",
		"in_progress",
		"done",
	]);
}

export function registerAgentAndSeedTests({
	app,
	workspaceId,
	addColumn,
}: IdentityTestContext) {
	it("allocates real agent cards on board columns without card activity", async () => {
		const boardId = await createAndApproveAgentBoard(app, workspaceId);
		const executionStatus = await waitForAgentCompletion(boardId);
		expect(executionStatus).toBe("done");
		const cards = await readAgentCards(boardId);
		assertAgentCards(cards);
		await assertNoAgentEvents(workspaceId);
	});

	it("allocates unique keys and statuses for every demo seed card", async () => {
		const columnIds = [
			await addColumn("Seed Backlog", 1024),
			await addColumn("Seed Todo", 2048),
			await addColumn("Seed In Progress", 3072),
			await addColumn("Seed Done", 4096, true),
		];
		await assertSeedCards(workspaceId, columnIds, [
			{ isDone: false },
			{ isDone: false },
			{ isDone: false },
			{ isDone: true },
		]);
	});
}
