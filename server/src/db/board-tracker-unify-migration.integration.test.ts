// Requires an already-running PostgreSQL service. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/board-tracker-unify-migration.integration.test.ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./pool.js";

const schemaSql = readFileSync(
	new URL("./schema.sql", import.meta.url),
	"utf8",
);
const agentSchemaSql = readFileSync(
	new URL("./agent-schema.sql", import.meta.url),
	"utf8",
);
const runIntegration = Boolean(process.env.RUN_INTEGRATION);

type PgClient = Awaited<ReturnType<typeof pool.connect>>;
type TrackerSlot = "backlog" | "todo" | "in_progress" | "done" | "canceled";

type CardRow = {
	title: string;
	column_id: number;
	status_id: number | null;
	status_slot: TrackerSlot | null;
	key_number: number | null;
	started_at: string | null;
	done_at: string | null;
	deleted_at: string | null;
};

type CardSnapshot = Pick<
	CardRow,
	| "title"
	| "column_id"
	| "status_id"
	| "key_number"
	| "started_at"
	| "done_at"
	| "deleted_at"
>;

type ExpectedCard = {
	title: string;
	slot: TrackerSlot;
	keyNumber: number | null;
};

type MigrationFixture = {
	workspaceId: number;
	baseline: Map<string, CardSnapshot>;
	expectedCards: ExpectedCard[];
};

const schemaName = `board_tracker_unify_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const quotedSchema = `"${schemaName}"`;

async function withSchema<T>(fn: (client: PgClient) => Promise<T>) {
	const client = await pool.connect();
	try {
		await client.query(`SET search_path TO ${quotedSchema}, public`);
		return await fn(client);
	} finally {
		client.release();
	}
}

async function applySchema(client: PgClient) {
	await client.query(schemaSql);
}

async function readCards(client: PgClient, workspaceId: number) {
	const result = await client.query<CardRow>(
		`SELECT card.title,
		        card.column_id,
		        card.status_id,
		        vocabulary.slot AS status_slot,
		        card.key_number,
		        card.started_at::text AS started_at,
		        card.done_at::text AS done_at,
		        card.deleted_at::text AS deleted_at
		 FROM cards AS card
		 LEFT JOIN tracker_vocabularies AS vocabulary
		   ON vocabulary.id = card.status_id
		  AND vocabulary.kind = 'status'
		 WHERE card.workspace_id = $1
		 ORDER BY card.title`,
		[workspaceId],
	);
	return result.rows;
}

async function captureBaseline(client: PgClient, workspaceId: number) {
	const cards = await readCards(client, workspaceId);
	return new Map<string, CardSnapshot>(
		cards.map((card) => [
			card.title,
			{
				title: card.title,
				column_id: card.column_id,
				status_id: card.status_id,
				key_number: card.key_number,
				// Text casts preserve the exact PostgreSQL timestamp representation.
				started_at: card.started_at,
				done_at: card.done_at,
				deleted_at: card.deleted_at,
			},
		]),
	);
}

async function insertWorkspace(
	client: PgClient,
	name: string,
	trackerKeyCounter: number,
) {
	const result = await client.query<{ id: number }>(
		`INSERT INTO workspaces (name, owner_user_id, tracker_key_counter)
		 VALUES ($1, (SELECT id FROM users ORDER BY id LIMIT 1), $2)
		 RETURNING id`,
		[name, trackerKeyCounter],
	);
	return result.rows[0].id;
}

async function insertFreshColumns(client: PgClient, workspaceId: number) {
	const result = await client.query<{ id: number }>(
		`INSERT INTO columns (workspace_id, title, position, is_done)
		 VALUES ($1, 'Fresh backlog', 1024, false),
		        ($1, 'Fresh done', 2048, true)
		 RETURNING id
		`,
		[workspaceId],
	);
	return result.rows.map((row) => row.id);
}

async function insertFreshCards(
	client: PgClient,
	workspaceId: number,
	columnIds: number[],
) {
	await client.query(
		`INSERT INTO cards
		 (workspace_id, column_id, title, position, started_at, done_at)
		 VALUES ($1, $2, 'fresh-live', 1024, '2026-01-02T03:04:05Z', NULL),
		        ($1, $3, 'fresh-deleted', 1024, '2026-01-03T03:04:05Z',
		         '2026-01-04T03:04:05Z')`,
		[workspaceId, columnIds[0], columnIds[1]],
	);
	await client.query(
		`UPDATE cards
		 SET deleted_at = '2026-01-05T03:04:05Z'
		 WHERE workspace_id = $1 AND title = 'fresh-deleted'`,
		[workspaceId],
	);
}

async function setupFreshFixture(client: PgClient): Promise<MigrationFixture> {
	// The first two schema passes intentionally run before agent-schema.sql.
	await applySchema(client);
	await client.query(
		`INSERT INTO users (username, display_name, password_hash)
		 VALUES ('t2-migration-owner', 'T2 Migration Owner', 'test')`,
	);
	const workspaceId = await insertWorkspace(client, "t2-fresh", 0);
	const columnIds = await insertFreshColumns(client, workspaceId);
	await insertFreshCards(client, workspaceId, columnIds);
	const baseline = await captureBaseline(client, workspaceId);
	await applySchema(client);
	return {
		workspaceId,
		baseline,
		expectedCards: [
			{ title: "fresh-live", slot: "backlog", keyNumber: 1 },
			{ title: "fresh-deleted", slot: "done", keyNumber: null },
		],
	};
}

type ColumnSpec = {
	title: string;
	position: number;
	isDone: boolean;
};

const humanColumnSpecs: ColumnSpec[] = [
	{ title: "Human backlog", position: 100, isDone: false },
	{ title: "Human todo", position: 400, isDone: false },
	{ title: "Human in progress", position: 900, isDone: false },
	{ title: "Human done", position: 3000, isDone: true },
];

const agentColumnSpecs: ColumnSpec[] = [
	{ title: "Agent backlog", position: 200, isDone: false },
	{ title: "Agent todo", position: 800, isDone: false },
	{ title: "Agent in progress", position: 1600, isDone: false },
	{ title: "Agent done", position: 2500, isDone: true },
];

async function insertColumnSet(
	client: PgClient,
	workspaceId: number,
	boardId: number | null,
	specs: ColumnSpec[],
) {
	const columns = new Map<string, number>();
	for (const spec of specs) {
		const result =
			boardId === null
				? await client.query<{ id: number }>(
						`INSERT INTO columns (workspace_id, title, position, is_done)
					 VALUES ($1, $2, $3, $4)
					 RETURNING id`,
						[workspaceId, spec.title, spec.position, spec.isDone],
					)
				: await client.query<{ id: number }>(
						`INSERT INTO columns
					 (workspace_id, board_id, title, position, is_done)
					 VALUES ($1, $2, $3, $4, $5)
					 RETURNING id`,
						[workspaceId, boardId, spec.title, spec.position, spec.isDone],
					);
		columns.set(spec.title, result.rows[0].id);
	}
	return columns;
}

async function insertAgentBoard(client: PgClient, workspaceId: number) {
	const result = await client.query<{ id: number }>(
		`INSERT INTO agent_boards (workspace_id, user_id, original_intent)
		 VALUES ($1, (SELECT id FROM users ORDER BY id LIMIT 1), 'agent board')
		 RETURNING id`,
		[workspaceId],
	);
	return result.rows[0].id;
}

async function getStatusId(
	client: PgClient,
	workspaceId: number,
	slot: TrackerSlot,
) {
	const result = await client.query<{ id: number }>(
		`SELECT id
		 FROM tracker_vocabularies
		 WHERE workspace_id = $1 AND kind = 'status' AND slot = $2`,
		[workspaceId, slot],
	);
	return result.rows[0].id;
}

type ExistingCardSpec = {
	columnId: number;
	title: string;
	keyNumber: number | null;
	doneAt: string | null;
	deletedAt: string | null;
};

async function insertExistingCards(
	client: PgClient,
	workspaceId: number,
	cards: ExistingCardSpec[],
) {
	for (const card of cards) {
		await client.query(
			`INSERT INTO cards
			 (workspace_id, column_id, title, position, key_number,
			  started_at, done_at, deleted_at)
			 VALUES ($1, $2, $3, 1024, $4,
			         '2026-02-02T03:04:05Z', $5, $6)`,
			[
				workspaceId,
				card.columnId,
				card.title,
				card.keyNumber,
				card.doneAt,
				card.deletedAt,
			],
		);
	}
}

type ExistingCardTuple = [
	number,
	string,
	number | null,
	string | null,
	string | null,
];

function existingCardSpecs(
	humanColumns: Map<string, number>,
	agentColumns: Map<string, number>,
): ExistingCardSpec[] {
	const cards: ExistingCardTuple[] = [
		[humanColumns.get("Human backlog")!, "human-live", null, null, null],
		[humanColumns.get("Human todo")!, "human-filled", 10, null, null],
		[
			humanColumns.get("Human in progress")!,
			"human-in-progress",
			null,
			null,
			null,
		],
		[
			humanColumns.get("Human done")!,
			"human-deleted",
			null,
			"2026-02-03T03:04:05Z",
			"2026-02-04T03:04:05Z",
		],
		[agentColumns.get("Agent backlog")!, "agent-live", null, null, null],
		[agentColumns.get("Agent todo")!, "agent-filled", 11, null, null],
		[
			agentColumns.get("Agent in progress")!,
			"agent-in-progress",
			null,
			null,
			null,
		],
		[
			agentColumns.get("Agent done")!,
			"agent-deleted",
			null,
			"2026-02-03T03:04:05Z",
			"2026-02-04T03:04:05Z",
		],
	];
	return cards.map(([columnId, title, keyNumber, doneAt, deletedAt]) => ({
		columnId,
		title,
		keyNumber,
		doneAt,
		deletedAt,
	}));
}

async function insertExistingTrackerKey(
	client: PgClient,
	workspaceId: number,
	doneStatusId: number,
) {
	await client.query(
		`INSERT INTO tracker_items (workspace_id, key_number, title, status_id)
		 VALUES ($1, 9, 'existing tracker key', $2)`,
		[workspaceId, doneStatusId],
	);
}

async function markFilledCards(
	client: PgClient,
	workspaceId: number,
	todoStatusId: number,
) {
	await client.query(
		`UPDATE cards
		 SET status_id = $1
		 WHERE workspace_id = $2 AND title IN ('human-filled', 'agent-filled')`,
		[todoStatusId, workspaceId],
	);
}

const expectedExistingCards: ExpectedCard[] = [
	{ title: "human-live", slot: "backlog", keyNumber: 12 },
	{ title: "human-filled", slot: "todo", keyNumber: 10 },
	{ title: "human-in-progress", slot: "in_progress", keyNumber: 13 },
	{ title: "human-deleted", slot: "done", keyNumber: null },
	{ title: "agent-live", slot: "backlog", keyNumber: 14 },
	{ title: "agent-filled", slot: "todo", keyNumber: 11 },
	{ title: "agent-in-progress", slot: "in_progress", keyNumber: 15 },
	{ title: "agent-deleted", slot: "done", keyNumber: null },
];

async function setupExistingFixture(
	client: PgClient,
): Promise<MigrationFixture> {
	const workspaceId = await insertWorkspace(client, "t2-existing", 4);
	await applySchema(client);
	const boardId = await insertAgentBoard(client, workspaceId);
	const humanColumns = await insertColumnSet(
		client,
		workspaceId,
		null,
		humanColumnSpecs,
	);
	const agentColumns = await insertColumnSet(
		client,
		workspaceId,
		boardId,
		agentColumnSpecs,
	);
	const doneStatusId = await getStatusId(client, workspaceId, "done");
	const todoStatusId = await getStatusId(client, workspaceId, "todo");
	await insertExistingTrackerKey(client, workspaceId, doneStatusId);
	await insertExistingCards(
		client,
		workspaceId,
		existingCardSpecs(humanColumns, agentColumns),
	);
	await markFilledCards(client, workspaceId, todoStatusId);
	// This snapshot is taken before the first board-aware backfill application.
	const baseline = await captureBaseline(client, workspaceId);
	await applySchema(client);
	return {
		workspaceId,
		baseline,
		expectedCards: expectedExistingCards,
	};
}

function preservedFields(card: CardSnapshot | CardRow) {
	return {
		title: card.title,
		column_id: card.column_id,
		started_at: card.started_at,
		done_at: card.done_at,
		deleted_at: card.deleted_at,
	};
}

function assertExpectedCards(cards: CardRow[], expectedCards: ExpectedCard[]) {
	const byTitle = new Map(cards.map((card) => [card.title, card]));
	expect(cards).toHaveLength(expectedCards.length);
	for (const expected of expectedCards) {
		const card = byTitle.get(expected.title);
		expect(card).toBeDefined();
		// The slot comes from the status vocabulary join, not card metadata.
		expect(card?.status_id).toEqual(expect.any(Number));
		expect(card?.status_slot).toBe(expected.slot);
		expect(card?.key_number).toBe(expected.keyNumber);
	}
}

function assertPreservedFields(
	cards: CardRow[],
	baseline: Map<string, CardSnapshot>,
) {
	const before = [...baseline.values()].map(preservedFields);
	const after = cards.map(preservedFields);
	// Includes column_id and exact timestamp strings from before first backfill.
	expect(after).toEqual(before);
}

async function readCounter(client: PgClient, workspaceId: number) {
	const result = await client.query<{ tracker_key_counter: number }>(
		`SELECT tracker_key_counter FROM workspaces WHERE id = $1`,
		[workspaceId],
	);
	return result.rows[0].tracker_key_counter;
}

async function expectNullOnlyRerun(
	client: PgClient,
	fixture: MigrationFixture,
	firstRows: CardRow[],
	firstCounter: number,
) {
	await applySchema(client);
	const rerunRows = await readCards(client, fixture.workspaceId);
	const rerunCounter = await readCounter(client, fixture.workspaceId);
	expect(rerunRows).toEqual(firstRows);
	expect(rerunCounter).toBe(firstCounter);
}

async function assertFreshMigration(
	client: PgClient,
	fixture: MigrationFixture,
) {
	const firstRows = await readCards(client, fixture.workspaceId);
	assertExpectedCards(firstRows, fixture.expectedCards);
	assertPreservedFields(firstRows, fixture.baseline);
	const firstCounter = await readCounter(client, fixture.workspaceId);
	expect(firstCounter).toBe(1);
	await expectNullOnlyRerun(client, fixture, firstRows, firstCounter);
}

async function assertExistingMigration(
	client: PgClient,
	fixture: MigrationFixture,
) {
	const firstRows = await readCards(client, fixture.workspaceId);
	assertExpectedCards(firstRows, fixture.expectedCards);
	assertPreservedFields(firstRows, fixture.baseline);
	const firstCounter = await readCounter(client, fixture.workspaceId);
	expect(firstCounter).toBe(15);
	const trackerKey = await client.query<{ key_number: number }>(
		`SELECT key_number
		 FROM tracker_items
		 WHERE workspace_id = $1 AND title = 'existing tracker key'`,
		[fixture.workspaceId],
	);
	expect(trackerKey.rows[0].key_number).toBe(9);
	await expectNullOnlyRerun(client, fixture, firstRows, firstCounter);
}

describe.skipIf(!runIntegration)(
	"board/tracker schema unification migration",
	() => {
		let freshFixture: MigrationFixture;

		beforeAll(async () => {
			await pool.query(`CREATE SCHEMA ${quotedSchema}`);
			await withSchema(async (client) => {
				freshFixture = await setupFreshFixture(client);
			});
		});

		afterAll(async () => {
			await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
			await pool.end();
		});

		it("maps pre-agent cards and allocates keys only to live rows", async () => {
			await withSchema((client) => assertFreshMigration(client, freshFixture));
		});

		it("maps human and agent boards independently, including deleted history", async () => {
			await withSchema(async (client) => {
				// Canonical order adds board_id only after the no-board branch is proven.
				await client.query(agentSchemaSql);
				const fixture = await setupExistingFixture(client);
				await assertExistingMigration(client, fixture);
			});
		});
	},
);
