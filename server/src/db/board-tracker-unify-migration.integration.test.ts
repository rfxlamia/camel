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
const schemaName = `board_tracker_unify_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const quotedSchema = `"${schemaName}"`;
const existingSchemaName = `${schemaName}_existing`;
const existingQuotedSchema = `"${existingSchemaName}"`;

type Client = Awaited<ReturnType<typeof pool.connect>>;
type Slot = "backlog" | "todo" | "in_progress" | "done" | "canceled";
type Card = {
	title: string;
	column_id: number;
	status_id: number | null;
	status_slot: Slot | null;
	key_number: number | null;
	started_at: string | null;
	done_at: string | null;
	deleted_at: string | null;
};
type Fixture = {
	workspaceId: number;
	before: Card[];
	expected: Record<string, readonly [Slot, number | null]>;
};
type ColumnData = { title: string; position: number; is_done: boolean };
type CardData = readonly [
	string,
	string,
	number | null,
	string | null,
	string | null,
];

const humanColumns: ColumnData[] = [
	{ title: "Human backlog", position: 100, is_done: false },
	{ title: "Human todo", position: 400, is_done: false },
	{ title: "Human in progress", position: 900, is_done: false },
	{ title: "Human done", position: 3000, is_done: true },
];
const agentColumns: ColumnData[] = [
	{ title: "Agent backlog", position: 200, is_done: false },
	{ title: "Agent todo", position: 800, is_done: false },
	{ title: "Agent in progress", position: 1600, is_done: false },
	{ title: "Agent done", position: 2500, is_done: true },
];
const oldStarted = "2026-02-02T03:04:05Z";
const oldDone = "2026-02-03T03:04:05Z";
const oldDeleted = "2026-02-04T03:04:05Z";
const freshStarted = "2026-01-02T03:04:05Z";
const freshDone = "2026-01-04T03:04:05Z";
const freshDeleted = "2026-01-05T03:04:05Z";
const freshCards: CardData[] = [
	["Fresh backlog", "fresh-live", null, null, null],
	["Fresh done", "fresh-deleted", null, freshDone, freshDeleted],
];
const existingCards: CardData[] = [
	["Human backlog", "human-live", null, null, null],
	["Human todo", "human-filled", 10, null, null],
	["Human in progress", "human-in-progress", null, null, null],
	["Human done", "human-deleted", null, oldDone, oldDeleted],
	["Agent backlog", "agent-live", null, null, null],
	["Agent todo", "agent-filled", 11, null, null],
	["Agent in progress", "agent-in-progress", null, null, null],
	["Agent done", "agent-deleted", null, oldDone, oldDeleted],
];
const freshExpected: Fixture["expected"] = {
	"fresh-live": ["backlog", 1],
	"fresh-deleted": ["done", null],
};
const existingExpected: Fixture["expected"] = {
	"human-live": ["backlog", 12],
	"human-filled": ["todo", 10],
	"human-in-progress": ["in_progress", 13],
	"human-deleted": ["done", null],
	"agent-live": ["backlog", 14],
	"agent-filled": ["todo", 11],
	"agent-in-progress": ["in_progress", 15],
	"agent-deleted": ["done", null],
};

async function withSchema<T>(
	fn: (client: Client) => Promise<T>,
	schema = quotedSchema,
) {
	const client = await pool.connect();
	try {
		await client.query(`SET search_path TO ${schema}, public`);
		return await fn(client);
	} finally {
		client.release();
	}
}

const slotSeedIndex = schemaSql.indexOf("-- T2 slot seed/update");
const statusBackfillIndex = schemaSql.indexOf(
	"-- board-tracker unify backfill",
);
if (slotSeedIndex < 0 || statusBackfillIndex < 0) {
	throw new Error("schema.sql is missing the T2 migration markers");
}
const applySchema = (client: Client) => client.query(schemaSql);
const applySchemaBeforeSlotSeed = (client: Client) =>
	client.query(schemaSql.slice(0, slotSeedIndex));
const applySchemaFromSlotSeed = (client: Client) =>
	client.query(schemaSql.slice(slotSeedIndex));
const applySchemaSlotSeed = (client: Client) =>
	client.query(schemaSql.slice(slotSeedIndex, statusBackfillIndex));
const applySchemaFromBackfill = (client: Client) =>
	client.query(schemaSql.slice(statusBackfillIndex));
const row = async <T extends Record<string, unknown>>(
	client: Client,
	sql: string,
	values: unknown[],
) => (await client.query<T>(sql, values)).rows[0];

async function readCards(client: Client, workspaceId: number) {
	const result = await client.query<Card>(
		`SELECT card.title, card.column_id, card.status_id, vocabulary.slot AS status_slot,
		        card.key_number, card.started_at::text AS started_at,
		        card.done_at::text AS done_at, card.deleted_at::text AS deleted_at
		 FROM cards AS card LEFT JOIN tracker_vocabularies AS vocabulary
		   ON vocabulary.id = card.status_id AND vocabulary.kind = 'status'
		 WHERE card.workspace_id = $1 ORDER BY card.title`,
		[workspaceId],
	);
	return result.rows;
}

async function addColumns(
	client: Client,
	workspaceId: number,
	boardId: number | null,
	data: ColumnData[],
) {
	const json = JSON.stringify(data);
	const result = await client.query<{ id: number; title: string }>(
		boardId === null
			? `INSERT INTO columns (workspace_id, title, position, is_done)
			   SELECT $1, x.title, x.position, x.is_done
			   FROM json_to_recordset($2::json) AS x(title text, position double precision, is_done boolean)
			   RETURNING id, title`
			: `INSERT INTO columns (workspace_id, board_id, title, position, is_done)
			   SELECT $1, $3, x.title, x.position, x.is_done
			   FROM json_to_recordset($2::json) AS x(title text, position double precision, is_done boolean)
			   RETURNING id, title`,
		boardId === null ? [workspaceId, json] : [workspaceId, json, boardId],
	);
	return new Map(result.rows.map(({ title, id }) => [title, id]));
}

async function addCards(
	client: Client,
	workspaceId: number,
	columns: Map<string, number>,
	data: CardData[],
	startedAt = oldStarted,
) {
	const json = JSON.stringify(
		data.map(([column, title, keyNumber, doneAt, deletedAt]) => ({
			column_id: columns.get(column),
			title,
			key_number: keyNumber,
			started_at: startedAt,
			done_at: doneAt,
			deleted_at: deletedAt,
		})),
	);
	await client.query(
		`INSERT INTO cards
		 (workspace_id, column_id, title, position, key_number,
		  started_at, done_at, deleted_at)
		 SELECT $1, x.column_id, x.title, 1024, x.key_number,
		        x.started_at, x.done_at, x.deleted_at
		 FROM json_to_recordset($2::json) AS x(
		   column_id integer, title text, key_number integer,
		   started_at timestamptz, done_at timestamptz, deleted_at timestamptz
		 )`,
		[workspaceId, json],
	);
}

async function workspace(client: Client, name: string, counter: number) {
	const result = await row<{ id: number }>(
		client,
		`INSERT INTO workspaces (name, owner_user_id, tracker_key_counter)
		 VALUES ($1, (SELECT id FROM users ORDER BY id LIMIT 1), $2) RETURNING id`,
		[name, counter],
	);
	return result.id;
}

async function statusId(client: Client, workspaceId: number, slot: Slot) {
	const result = await row<{ id: number }>(
		client,
		`SELECT id FROM tracker_vocabularies
		 WHERE workspace_id = $1 AND kind = 'status' AND slot = $2`,
		[workspaceId, slot],
	);
	return result.id;
}

async function setupFresh(client: Client): Promise<Fixture> {
	// Stage legacy NULL-status rows after additive DDL but before slot seed and
	// the null-only backfills, including the final NOT NULL constraint.
	await applySchemaBeforeSlotSeed(client);
	await client.query(
		`INSERT INTO users (username, display_name, password_hash)
		 VALUES ('t2-migration-owner', 'T2 Migration Owner', 'test')`,
	);
	const workspaceId = await workspace(client, "t2-fresh", 0);
	const columns = await addColumns(client, workspaceId, null, [
		{ title: "Fresh backlog", position: 1024, is_done: false },
		{ title: "Fresh done", position: 2048, is_done: true },
	]);
	await addCards(client, workspaceId, columns, freshCards, freshStarted);
	const before = await readCards(client, workspaceId);
	await applySchemaFromSlotSeed(client); // seed, backfill, and final NOT NULL
	return { workspaceId, before, expected: freshExpected };
}

async function setupExisting(client: Client): Promise<Fixture> {
	// Keep this board-aware fixture independent so its NULL-status rows are
	// staged before the final migration constraint, just like the fresh fixture.
	await applySchemaBeforeSlotSeed(client);
	await client.query(
		`INSERT INTO users (username, display_name, password_hash)
		 VALUES ('t2-existing-migration-owner', 'T2 Existing Migration Owner', 'test')`,
	);
	const workspaceId = await workspace(client, "t2-existing", 4);
	await client.query(agentSchemaSql);
	await applySchemaSlotSeed(client);
	const board = await client.query<{ id: number }>(
		`INSERT INTO agent_boards (workspace_id, user_id, original_intent)
		 VALUES ($1, (SELECT id FROM users ORDER BY id LIMIT 1), 'agent board') RETURNING id`,
		[workspaceId],
	);
	const human = await addColumns(client, workspaceId, null, humanColumns);
	const agent = await addColumns(
		client,
		workspaceId,
		board.rows[0].id,
		agentColumns,
	);
	const done = await statusId(client, workspaceId, "done");
	const todo = await statusId(client, workspaceId, "todo");
	await client.query(
		`INSERT INTO tracker_items (workspace_id, key_number, title, status_id)
		 VALUES ($1, 9, 'existing tracker key', $2)`,
		[workspaceId, done],
	);
	await addCards(
		client,
		workspaceId,
		new Map([...human, ...agent]),
		existingCards,
	);
	await client.query(
		`UPDATE cards SET status_id = $1
		 WHERE workspace_id = $2 AND title IN ('human-filled', 'agent-filled')`,
		[todo, workspaceId],
	);
	const before = await readCards(client, workspaceId);
	await applySchemaFromBackfill(client);
	return { workspaceId, before, expected: existingExpected };
}

function assertMigration(after: Card[], fixture: Fixture) {
	const byTitle = new Map(after.map((card) => [card.title, card]));
	expect(after).toHaveLength(Object.keys(fixture.expected).length);
	for (const [title, [slot, key]] of Object.entries(fixture.expected)) {
		const card = byTitle.get(title);
		expect(card).toBeDefined();
		expect(card?.status_id).toEqual(expect.any(Number));
		expect(card?.status_slot).toBe(slot);
		expect(card?.key_number).toBe(key);
	}
	const preserve = ({
		title,
		column_id,
		started_at,
		done_at,
		deleted_at,
	}: Card) => [title, column_id, started_at, done_at, deleted_at];
	expect(after.map(preserve)).toEqual(fixture.before.map(preserve));
}

async function counter(client: Client, workspaceId: number) {
	const result = await row<{ tracker_key_counter: number }>(
		client,
		`SELECT tracker_key_counter FROM workspaces WHERE id = $1`,
		[workspaceId],
	);
	return result.tracker_key_counter;
}

async function assertRerun(
	client: Client,
	fixture: Fixture,
	first: Card[],
	firstCounter: number,
) {
	await applySchema(client);
	expect(await readCards(client, fixture.workspaceId)).toEqual(first);
	expect(await counter(client, fixture.workspaceId)).toBe(firstCounter);
}

describe.skipIf(!runIntegration)(
	"board/tracker schema unification migration",
	() => {
		let fresh: Fixture;

		beforeAll(async () => {
			await pool.query(`CREATE SCHEMA ${quotedSchema}`);
			await withSchema(async (client) => {
				fresh = await setupFresh(client);
			});
		});

		afterAll(async () => {
			await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
			await pool.query(`DROP SCHEMA IF EXISTS ${existingQuotedSchema} CASCADE`);
			await pool.end();
		});

		it("maps pre-agent cards and allocates keys only to live rows", async () => {
			await withSchema(async (client) => {
				const first = await readCards(client, fresh.workspaceId);
				assertMigration(first, fresh);
				const firstCounter = await counter(client, fresh.workspaceId);
				expect(firstCounter).toBe(1);
				await assertRerun(client, fresh, first, firstCounter);
			});
		});

		it("maps human and agent boards independently, including deleted history", async () => {
			await pool.query(`CREATE SCHEMA ${existingQuotedSchema}`);
			await withSchema(async (client) => {
				const fixture = await setupExisting(client);
				const first = await readCards(client, fixture.workspaceId);
				assertMigration(first, fixture);
				const firstCounter = await counter(client, fixture.workspaceId);
				expect(firstCounter).toBe(15);
				const tracker = await row<{ key_number: number }>(
					client,
					`SELECT key_number FROM tracker_items
					 WHERE workspace_id = $1 AND title = 'existing tracker key'`,
					[fixture.workspaceId],
				);
				expect(tracker.key_number).toBe(9);
				await assertRerun(client, fixture, first, firstCounter);
			}, existingQuotedSchema);
		});
	},
);
