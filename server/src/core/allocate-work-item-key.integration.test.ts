// Integration describe requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/allocate-work-item-key.integration.test.ts
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/kysely.js";
import { pool } from "../db/pool.js";
import * as allocator from "./allocate-work-item-key.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);
const WORKSPACE_ID = 1991;
const OWNER_ID = 19910;

async function cleanup() {
	await pool.query("DELETE FROM workspaces WHERE id = $1", [WORKSPACE_ID]);
	await pool.query("DELETE FROM users WHERE id = $1", [OWNER_ID]);
}

describe.skipIf(!runIntegration)("allocateWorkItemKey (integration)", () => {
	beforeEach(async () => {
		await cleanup();
		await pool.query(
			"INSERT INTO users (id, username, display_name, password_hash) VALUES ($1, 'alloc-owner', 'Alloc Owner', 'test')",
			[OWNER_ID],
		);
		await pool.query(
			"INSERT INTO workspaces (id, name, owner_user_id, is_personal, tracker_key_counter) VALUES ($1, 'Alloc Workspace', $2, false, 5)",
			[WORKSPACE_ID, OWNER_ID],
		);
	});

	afterAll(async () => {
		await cleanup();
		await pool.end();
	});

	it("returns consecutive keys and leaves the counter at the last key", async () => {
		const keys = await db.transaction().execute(async (trx) => {
			const first = await allocator.allocateWorkItemKey(trx, {
				workspaceId: WORKSPACE_ID,
			});
			const second = await allocator.allocateWorkItemKey(trx, {
				workspaceId: WORKSPACE_ID,
			});
			return [first.keyNumber, second.keyNumber];
		});
		expect(keys).toEqual([6, 7]);

		const row = await pool.query<{ tracker_key_counter: number }>(
			"SELECT tracker_key_counter FROM workspaces WHERE id = $1",
			[WORKSPACE_ID],
		);
		expect(row.rows[0]!.tracker_key_counter).toBe(7);
	});
});
