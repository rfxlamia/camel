// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-merge-expand.integration.test.ts
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySchema } from "./migrate.js";
import { pool } from "./pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "./scratch-schema-test-support.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);

type Seed = { workspaceId: number; statusId: number };

async function seedWorkspace(scratch: ScratchSchema): Promise<Seed> {
	const user = await scratch.client.query(
		"INSERT INTO users (username, display_name, password_hash) VALUES ('u', 'U', 'x') RETURNING id",
	);
	const ws = await scratch.client.query(
		"INSERT INTO workspaces (name, owner_user_id) VALUES ('w', $1) RETURNING id",
		[user.rows[0].id],
	);
	const workspaceId: number = ws.rows[0].id;
	const status = await scratch.client.query(
		"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot) VALUES ($1, 'status', 'Backlog', 1, '#000', 'backlog') RETURNING id",
		[workspaceId],
	);
	return { workspaceId, statusId: status.rows[0].id };
}

const insertCard = (
	scratch: ScratchSchema,
	seed: Seed,
	keyNumber: number | null,
	deletedAt: string | null = null,
) =>
	scratch.client.query(
		"INSERT INTO cards (column_id, title, position, workspace_id, status_id, key_number, deleted_at) VALUES (NULL, 't', 1, $1, $2, $3, $4)",
		[seed.workspaceId, seed.statusId, keyNumber, deletedAt],
	);

describe.skipIf(!runIntegration)("work-item-merge expand", () => {
	afterAll(async () => {
		await pool.end();
	});

	describe("on a freshly migrated database", () => {
		let scratch: ScratchSchema;
		let seed: Seed;
		beforeAll(async () => {
			scratch = await createScratchSchema("wim_expand");
			await applySchema(scratch.client);
			seed = await seedWorkspace(scratch);
		});
		afterAll(async () => {
			await scratch.drop();
		});

		it("accepts a column-less card", async () => {
			await expect(insertCard(scratch, seed, 999)).resolves.toBeTruthy();
		});

		it("rejects a duplicate (workspace_id, key_number) with 23505", async () => {
			await expect(insertCard(scratch, seed, 999)).rejects.toMatchObject({
				code: "23505",
			});
		});

		it("rejects a duplicate key even when the first row is soft-deleted", async () => {
			await insertCard(scratch, seed, 1000, "2026-01-01T00:00:00Z");
			await expect(insertCard(scratch, seed, 1000)).rejects.toMatchObject({
				code: "23505",
			});
		});

		it("allows multiple NULL keys", async () => {
			await insertCard(scratch, seed, null);
			await expect(insertCard(scratch, seed, null)).resolves.toBeTruthy();
		});
	});

	describe("when duplicate card keys pre-exist", () => {
		let scratch: ScratchSchema;
		let seed: Seed;
		beforeAll(async () => {
			scratch = await createScratchSchema("wim_dupes");
			await applySchema(scratch.client);
			seed = await seedWorkspace(scratch);
			await scratch.client.query("DROP INDEX uq_cards_workspace_key");
			await insertCard(scratch, seed, 7);
			await insertCard(scratch, seed, 7);
		});
		afterAll(async () => {
			await scratch.drop();
		});

		it("aborts loudly, creates no index and leaves rows unchanged", async () => {
			await expect(applySchema(scratch.client)).rejects.toThrow(
				`work-item-merge: duplicate card keys workspace=${seed.workspaceId} key=7`,
			);
			const index = await scratch.client.query(
				"SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = 'uq_cards_workspace_key'",
				[scratch.schema],
			);
			expect(index.rows).toHaveLength(0);
			const cards = await scratch.client.query(
				"SELECT count(*)::int AS n FROM cards WHERE workspace_id = $1 AND key_number = 7",
				[seed.workspaceId],
			);
			expect(cards.rows[0].n).toBe(2);
		});
	});

	describe("when applied twice", () => {
		let scratch: ScratchSchema;
		beforeAll(async () => {
			scratch = await createScratchSchema("wim_twice");
		});
		afterAll(async () => {
			await scratch.drop();
		});

		const snapshot = async () => {
			const columns = await scratch.client.query(
				"SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, column_name",
				[scratch.schema],
			);
			const indexes = await scratch.client.query(
				"SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname",
				[scratch.schema],
			);
			return { columns: columns.rows, indexes: indexes.rows };
		};

		it("is a no-op the second time", async () => {
			await applySchema(scratch.client);
			const before = await snapshot();
			await expect(applySchema(scratch.client)).resolves.toBeUndefined();
			expect(await snapshot()).toEqual(before);
		});
	});
});
