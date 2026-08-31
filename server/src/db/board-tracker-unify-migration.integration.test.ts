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

type QueryResultRow = Record<string, unknown>;

const schemaName = `board_tracker_unify_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const quotedSchema = `"${schemaName}"`;

async function withSchema<T>(
	fn: (client: Awaited<ReturnType<typeof pool.connect>>) => Promise<T>,
) {
	const client = await pool.connect();
	try {
		await client.query(`SET search_path TO ${quotedSchema}, public`);
		return await fn(client);
	} finally {
		client.release();
	}
}

async function applySchema(client: Awaited<ReturnType<typeof pool.connect>>) {
	await client.query(schemaSql);
}

async function rows(
	client: Awaited<ReturnType<typeof pool.connect>>,
	sql: string,
	values: unknown[] = [],
) {
	return (await client.query<QueryResultRow>(sql, values)).rows;
}

describe.skipIf(!runIntegration)(
	"board/tracker schema unification migration",
	() => {
		beforeAll(async () => {
			await pool.query(`CREATE SCHEMA ${quotedSchema}`);
			await withSchema(async (client) => {
				// First pass is intentionally pre-agent: columns has no board_id yet.
				await applySchema(client);
				await client.query(
					`INSERT INTO users (username, display_name, password_hash)
				 VALUES ('t2-migration-owner', 'T2 Migration Owner', 'test')`,
				);
				const workspace = await client.query<{ id: number }>(
					`INSERT INTO workspaces (name, owner_user_id, tracker_key_counter)
				 VALUES ('t2-fresh', (SELECT id FROM users ORDER BY id LIMIT 1), 0)
				 RETURNING id`,
				);
				const workspaceId = workspace.rows[0].id;
				await client.query(
					`INSERT INTO columns (workspace_id, title, position, is_done)
				 VALUES ($1, 'Fresh backlog', 1024, false), ($1, 'Fresh done', 2048, true)`,
					[workspaceId],
				);
				const columns = await client.query<{ id: number }>(
					`SELECT id FROM columns WHERE workspace_id = $1 ORDER BY position`,
					[workspaceId],
				);
				await client.query(
					`INSERT INTO cards (workspace_id, column_id, title, position, started_at, done_at)
				 VALUES ($1, $2, 'fresh-live', 1024, '2026-01-02T03:04:05Z', NULL),
				        ($1, $3, 'fresh-deleted', 1024, '2026-01-03T03:04:05Z', '2026-01-04T03:04:05Z')`,
					[workspaceId, columns.rows[0].id, columns.rows[1].id],
				);
				await client.query(
					`UPDATE cards SET deleted_at = '2026-01-05T03:04:05Z'
				 WHERE workspace_id = $1 AND title = 'fresh-deleted'`,
					[workspaceId],
				);
				// The second pre-agent pass proves the no-board_id branch against existing rows.
				await applySchema(client);
				// Canonical migration order adds board_id only after schema.sql completes.
				await client.query(agentSchemaSql);
			});
		});

		afterAll(async () => {
			await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
			await pool.end();
		});

		it("maps pre-agent human cards and allocates keys only to live rows", async () => {
			await withSchema(async (client) => {
				const cardRows = await rows(
					client,
					`SELECT title, status_id, key_number, started_at, done_at, deleted_at
				 FROM cards WHERE title LIKE 'fresh-%' ORDER BY title`,
				);
				const byTitle = new Map(cardRows.map((row) => [row.title, row]));
				expect(byTitle.get("fresh-live")).toMatchObject({
					status_id: expect.any(Number),
					key_number: 1,
					started_at: expect.any(Date),
				});
				expect(byTitle.get("fresh-deleted")).toMatchObject({
					status_id: expect.any(Number),
					key_number: null,
					deleted_at: expect.any(Date),
				});
				expect(byTitle.get("fresh-deleted")?.done_at).toBeInstanceOf(Date);
				const counter = await rows(
					client,
					`SELECT tracker_key_counter FROM workspaces
				 WHERE name = 't2-fresh'`,
				);
				expect(counter[0].tracker_key_counter).toBe(1);
			});
		});

		it("maps human and agent boards independently, including deleted agent history", async () => {
			await withSchema(async (client) => {
				const workspace = await client.query<{ id: number }>(
					`INSERT INTO workspaces (name, owner_user_id, tracker_key_counter)
				 VALUES ('t2-existing', (SELECT id FROM users ORDER BY id LIMIT 1), 4)
				 RETURNING id`,
				);
				const workspaceId = workspace.rows[0].id;
				// A workspace created after the initial retroactive seed gets its defaults
				// from the normal migration rerun before its historical cards are loaded.
				await applySchema(client);
				const board = await client.query<{ id: number }>(
					`INSERT INTO agent_boards (workspace_id, user_id, original_intent)
				 VALUES ($1, (SELECT id FROM users ORDER BY id LIMIT 1), 'agent board')
				 RETURNING id`,
					[workspaceId],
				);
				const boardId = board.rows[0].id;
				await client.query(
					`INSERT INTO columns (workspace_id, title, position, is_done)
				 VALUES ($1, 'Human backlog', 1024, false),
				        ($1, 'Human todo', 2048, false),
				        ($1, 'Human done', 3072, true)
				 RETURNING id`,
					[workspaceId],
				);
				await client.query(
					`INSERT INTO columns (workspace_id, board_id, title, position, is_done)
				 VALUES ($1, $2, 'Agent backlog', 1024, false),
				        ($1, $2, 'Agent todo', 2048, false),
				        ($1, $2, 'Agent done', 3072, true)
				 RETURNING id`,
					[workspaceId, boardId],
				);
				const orderedHumanColumns = await client.query<{ id: number }>(
					`SELECT id FROM columns WHERE workspace_id = $1 AND board_id IS NULL
				 AND title LIKE 'Human %' ORDER BY position`,
					[workspaceId],
				);
				const orderedAgentColumns = await client.query<{ id: number }>(
					`SELECT id FROM columns WHERE workspace_id = $1 AND board_id = $2
				 AND title LIKE 'Agent %' ORDER BY position`,
					[workspaceId, boardId],
				);
				const doneStatus = await client.query<{ id: number }>(
					`SELECT id FROM tracker_vocabularies
				 WHERE workspace_id = $1 AND kind = 'status' AND slot = 'done'`,
					[workspaceId],
				);
				const todoStatus = await client.query<{ id: number }>(
					`SELECT id FROM tracker_vocabularies
				 WHERE workspace_id = $1 AND kind = 'status' AND slot = 'todo'`,
					[workspaceId],
				);
				await client.query(
					`INSERT INTO tracker_items (workspace_id, key_number, title, status_id)
				 VALUES ($1, 9, 'existing tracker key', $2)`,
					[workspaceId, doneStatus.rows[0].id],
				);
				const cardRows = [
					[orderedHumanColumns.rows[0].id, "human-live", null],
					[orderedHumanColumns.rows[1].id, "human-filled", 10],
					[orderedHumanColumns.rows[2].id, "human-deleted", null],
					[orderedAgentColumns.rows[0].id, "agent-live", null],
					[orderedAgentColumns.rows[1].id, "agent-filled", 11],
					[orderedAgentColumns.rows[2].id, "agent-deleted", null],
				] as const;
				for (const [columnId, title, key] of cardRows) {
					await client.query(
						`INSERT INTO cards
					 (workspace_id, column_id, title, position, key_number, started_at, done_at, deleted_at)
					 VALUES ($1, $2, $3, 1024, $4,
					         '2026-02-02T03:04:05Z',
					         CASE WHEN $3 LIKE '%done%' THEN '2026-02-03T03:04:05Z'::timestamptz ELSE NULL::timestamptz END,
					         CASE WHEN $3 LIKE '%deleted%' THEN '2026-02-04T03:04:05Z'::timestamptz ELSE NULL::timestamptz END)`,
						[workspaceId, columnId, title, key],
					);
				}
				await client.query(
					`UPDATE cards SET status_id = $1
				 WHERE workspace_id = $2 AND title = 'human-filled'`,
					[todoStatus.rows[0].id, workspaceId],
				);
				// Second pass now sees columns.board_id and must execute the guarded board branch.
				await applySchema(client);
				const mapped = await rows(
					client,
					`SELECT title, status_id, key_number, started_at, done_at, deleted_at
				 FROM cards WHERE workspace_id = $1 ORDER BY title`,
					[workspaceId],
				);
				const byTitle = new Map(mapped.map((row) => [row.title, row]));
				for (const title of [
					"human-live",
					"human-deleted",
					"agent-live",
					"agent-deleted",
				]) {
					expect(byTitle.get(title)?.status_id).toEqual(expect.any(Number));
				}
				expect(byTitle.get("human-filled")).toMatchObject({ key_number: 10 });
				expect(byTitle.get("human-filled")?.status_id).toBe(
					todoStatus.rows[0].id,
				);
				expect(byTitle.get("agent-filled")).toMatchObject({ key_number: 11 });
				expect(byTitle.get("human-deleted")).toMatchObject({
					key_number: null,
				});
				expect(byTitle.get("agent-deleted")).toMatchObject({
					key_number: null,
				});
				expect(byTitle.get("human-live")).toMatchObject({ key_number: 12 });
				expect(byTitle.get("agent-live")).toMatchObject({ key_number: 13 });
				const existingTrackerKey = await rows(
					client,
					`SELECT key_number FROM tracker_items
				 WHERE workspace_id = $1 AND title = 'existing tracker key'`,
					[workspaceId],
				);
				expect(existingTrackerKey[0].key_number).toBe(9);
				const beforeRerun = mapped.map((row) => ({
					title: row.title,
					status_id: row.status_id,
					key_number: row.key_number,
					started_at: row.started_at,
					done_at: row.done_at,
					deleted_at: row.deleted_at,
				}));
				const beforeCounter = await rows(
					client,
					`SELECT tracker_key_counter FROM workspaces WHERE id = $1`,
					[workspaceId],
				);
				await applySchema(client);
				const afterRerun = await rows(
					client,
					`SELECT title, status_id, key_number, started_at, done_at, deleted_at
				 FROM cards WHERE workspace_id = $1 ORDER BY title`,
					[workspaceId],
				);
				const afterCounter = await rows(
					client,
					`SELECT tracker_key_counter FROM workspaces WHERE id = $1`,
					[workspaceId],
				);
				expect(afterRerun).toEqual(beforeRerun);
				expect(afterCounter).toEqual(beforeCounter);
			});
		});
	},
);
