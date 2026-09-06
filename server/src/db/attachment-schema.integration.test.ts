// Requires PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/db/attachment-schema.integration.test.ts
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./pool.js";

const schemaSql = readFileSync(
	new URL("./schema.sql", import.meta.url),
	"utf8",
);
const runIntegration = Boolean(process.env.RUN_INTEGRATION);
const maxImageBytes = 10 * 1024 * 1024;

type Client = Awaited<ReturnType<typeof pool.connect>>;

async function withSchema<T>(fn: (client: Client) => Promise<T>) {
	const client = await pool.connect();
	try {
		await client.query("SET search_path TO attachment_schema_test, public");
		return await fn(client);
	} finally {
		client.release();
	}
}

const applySchema = (client: Client) => client.query(schemaSql);

describe.skipIf(!runIntegration)("attachments schema (real PostgreSQL)", () => {
	beforeAll(async () => {
		await pool.query("DROP SCHEMA IF EXISTS attachment_schema_test CASCADE");
		await pool.query("CREATE SCHEMA attachment_schema_test");
	});

	afterAll(async () => {
		await pool.query("DROP SCHEMA IF EXISTS attachment_schema_test CASCADE");
		await pool.end();
	});

	it("is idempotent, enforces image metadata constraints, orders rows, and cascades with cards", async () => {
		await withSchema(async (client) => {
			await applySchema(client);
			await applySchema(client);

			const user = await client.query<{ id: number }>(
				`INSERT INTO users (username, display_name, password_hash)
				 VALUES ($1, 'Attachment Fixture', 'not-a-password')
				 RETURNING id`,
				[`attachment-${randomUUID()}`],
			);
			const workspace = await client.query<{ id: number }>(
				`INSERT INTO workspaces (name, owner_user_id)
				 VALUES ('Attachment Fixture', $1)
				 RETURNING id`,
				[user.rows[0].id],
			);
			const column = await client.query<{ id: number }>(
				`INSERT INTO columns (workspace_id, title, position)
				 VALUES ($1, 'Todo', 1)
				 RETURNING id`,
				[workspace.rows[0].id],
			);
			const status = await client.query<{ id: number }>(
				`INSERT INTO tracker_vocabularies
				 (workspace_id, kind, name, position, colour, slot)
				 VALUES ($1, 'status', 'Todo', 1, '#888888', 'todo')
				 RETURNING id`,
				[workspace.rows[0].id],
			);
			const card = await client.query<{ id: number }>(
				`INSERT INTO cards (workspace_id, column_id, status_id, title, position)
				 VALUES ($1, $2, $3, 'Attachment card', 1)
				 RETURNING id`,
				[workspace.rows[0].id, column.rows[0].id, status.rows[0].id],
			);
			const cardId = card.rows[0].id;

			await expect(
				client.query(
					`INSERT INTO attachments
					 (card_id, mime_type, thumbnail_path, original_path,
					  thumbnail_size_bytes, original_size_bytes)
					 VALUES ($1, 'image/gif', 'thumb.gif', 'original.gif', 1, 1)`,
					[cardId],
				),
			).rejects.toThrow();

			await expect(
				client.query(
					`INSERT INTO attachments
					 (card_id, mime_type, thumbnail_path, original_path,
					  thumbnail_size_bytes, original_size_bytes)
					 VALUES ($1, 'image/png', 'thumb-zero.png', 'original-zero.png', 0, 1)`,
					[cardId],
				),
			).rejects.toThrow();

			await expect(
				client.query(
					`INSERT INTO attachments
					 (card_id, mime_type, thumbnail_path, original_path,
					  thumbnail_size_bytes, original_size_bytes)
					 VALUES ($1, 'image/jpeg', 'thumb-large.jpg', 'original-large.jpg', 1, $2)`,
					[cardId, maxImageBytes + 1],
				),
			).rejects.toThrow();

			await client.query(
				`INSERT INTO attachments
				 (card_id, mime_type, thumbnail_path, original_path,
				  thumbnail_size_bytes, original_size_bytes, created_at)
				 VALUES
				 ($1, 'image/png', 'thumb-new.png', 'original-new.png', 100, 200, '2026-09-05T00:00:02Z'),
				 ($1, 'image/jpeg', 'thumb-old.jpg', 'original-old.jpg', 300, 400, '2026-09-05T00:00:01Z')`,
				[cardId],
			);

			const ordered = await client.query<{
				thumbnail_path: string;
				created_at: string;
			}>(
				`SELECT thumbnail_path, created_at::text
				 FROM attachments
				 WHERE card_id = $1
				 ORDER BY card_id, created_at, id`,
				[cardId],
			);
			expect(ordered.rows.map((row) => row.thumbnail_path)).toEqual([
				"thumb-old.jpg",
				"thumb-new.png",
			]);

			await client.query("DELETE FROM cards WHERE id = $1", [cardId]);
			const remaining = await client.query(
				"SELECT id FROM attachments WHERE card_id = $1",
				[cardId],
			);
			expect(remaining.rows).toHaveLength(0);
		});
	});
});
