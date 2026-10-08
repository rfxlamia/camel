// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/core/work-item-debt.integration.test.ts
import "dotenv/config";
import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "../db/scratch-schema-test-support.js";
import type { DB } from "../db/types.js";
import {
	rows,
	seedItem,
	seedWorkspace,
} from "../db/work-item-merge.test-support.js";
import { findKeyCollisions } from "./work-item-debt.js";

const runIntegration = Boolean(process.env.RUN_INTEGRATION);

/** Kysely bound to the scratch client so its search_path is honored. */
function scratchKysely(s: ScratchSchema) {
	const scratchPool = {
		connect: async () =>
			new Proxy(s.client, {
				get: (target, prop) =>
					prop === "release" ? () => {} : (target as never)[prop as never],
			}),
		end: async () => {},
	} as unknown as Pool;
	return new Kysely<DB>({
		dialect: new PostgresDialect({ pool: scratchPool }),
	});
}

describe.skipIf(!runIntegration)("findKeyCollisions", () => {
	let s: ScratchSchema;
	let tag = 0;

	beforeEach(async () => {
		if (s) await s.drop();
		s = await createScratchSchema("wid");
		await applySchema(s.client);
		tag += 1;
	});

	afterAll(async () => {
		if (s) await s.drop();
		await pool.end();
	});

	async function seedCard(wsId: number, statusId: number, key: number) {
		const [card] = await rows(
			s,
			`INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number)
			 VALUES ($1, NULL, 'copy', 0, $2, $3) RETURNING id`,
			[wsId, statusId, key],
		);
		return card.id as number;
	}

	it("Key-collision check ignores migrated rows", async () => {
		const ws = await seedWorkspace(s, `kc-${tag}`);
		const trackerId = await seedItem(s, ws, 5);
		const cardId = await seedCard(ws.id, ws.statusId, 5);
		await s.client.query(
			"UPDATE tracker_items SET migrated_to_id = $1 WHERE id = $2",
			[cardId, trackerId],
		);

		await expect(findKeyCollisions(scratchKysely(s))).resolves.toEqual([]);
	});

	it("Key-collision check still reports unmigrated overlaps", async () => {
		const ws = await seedWorkspace(s, `ku-${tag}`);
		const trackerId = await seedItem(s, ws, 6);
		const cardId = await seedCard(ws.id, ws.statusId, 6);

		await expect(findKeyCollisions(scratchKysely(s))).resolves.toEqual([
			{
				workspaceId: ws.id,
				keyNumber: 6,
				cardId,
				trackerItemId: trackerId,
			},
		]);
	});
});
