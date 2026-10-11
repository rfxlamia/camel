import "dotenv/config";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./pool.js";
import { createScratchSchema } from "./scratch-schema-test-support.js";

const schemaSql = readFileSync(
	new URL("./schema.sql", import.meta.url),
	"utf8",
);
const agentSql = readFileSync(
	new URL("./agent-schema.sql", import.meta.url),
	"utf8",
);
const enabled =
	process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

// Emulate the exact schema shipped before retry lineage was introduced.
const retryUpgrade =
	/-- Additive upgrade[\s\S]*?WHERE retry_of_board_id IS NOT NULL;/;
const legacyAgentSql = agentSql.replace(retryUpgrade, "");

describe.skipIf(!enabled)(
	"agent retry lineage migration (real PostgreSQL)",
	() => {
		afterAll(async () => {
			await pool.end();
		});

		it("upgrades populated installations, reruns safely and preserves children on source deletion", async () => {
			expect(legacyAgentSql).not.toContain("retry_of_board_id");
			const scratch = await createScratchSchema("agent_retry_upgrade");
			const { client } = scratch;
			try {
				await client.query(schemaSql);
				await client.query(legacyAgentSql);
				const user = await client.query<{ id: number }>(
					"INSERT INTO users (username, display_name, password_hash) VALUES ('retry-owner', 'Owner', 'test') RETURNING id",
				);
				const workspace = await client.query<{ id: number }>(
					"INSERT INTO workspaces (name, owner_user_id) VALUES ('Retry migration', $1) RETURNING id",
					[user.rows[0].id],
				);
				const userId = user.rows[0].id;
				const workspaceId = workspace.rows[0].id;
				const source = await client.query<{
					id: number;
					original_intent: string;
				}>(
					"INSERT INTO agent_boards (workspace_id, user_id, original_intent, status, execution_status) VALUES ($1, $2, 'Keep source', 'approved', 'failed') RETURNING id, original_intent",
					[workspaceId, userId],
				);
				await client.query(agentSql);
				await client.query(agentSql);
				const upgraded = await client.query(
					"SELECT id, original_intent, retry_of_board_id FROM agent_boards WHERE id = $1",
					[source.rows[0].id],
				);
				expect(upgraded.rows).toEqual([
					{ ...source.rows[0], retry_of_board_id: null },
				]);
				const child = await client.query<{ id: number }>(
					"INSERT INTO agent_boards (workspace_id, user_id, original_intent, retry_of_board_id) VALUES ($1, $2, 'Keep child', $3) RETURNING id",
					[workspaceId, userId, source.rows[0].id],
				);
				await expect(
					client.query(
						"INSERT INTO agent_boards (workspace_id, user_id, original_intent, retry_of_board_id) VALUES ($1, $2, 'Duplicate', $3)",
						[workspaceId, userId, source.rows[0].id],
					),
				).rejects.toMatchObject({ code: "23505" });
				await client.query("DELETE FROM agent_boards WHERE id = $1", [
					source.rows[0].id,
				]);
				const retained = await client.query(
					"SELECT original_intent, retry_of_board_id FROM agent_boards WHERE id = $1",
					[child.rows[0].id],
				);
				expect(retained.rows).toEqual([
					{ original_intent: "Keep child", retry_of_board_id: null },
				]);
				await client.query("DELETE FROM workspaces WHERE id = $1", [
					workspaceId,
				]);
				expect(
					(await client.query("SELECT id FROM agent_boards")).rows,
				).toEqual([]);
			} finally {
				await scratch.drop();
			}
		});
	},
);
