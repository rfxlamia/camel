// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-merge-guard.integration.test.ts
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "./migrate.js";
import { pool } from "./pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "./scratch-schema-test-support.js";
import {
	rows,
	seedEvents,
	seedItem,
	seedWorkspace,
} from "./work-item-merge-test-support.js";

const ENABLED = { workItemMerge: true };
const runIntegration = Boolean(process.env.RUN_INTEGRATION);

async function withNotices<T>(
	s: ScratchSchema,
	run: () => Promise<T>,
): Promise<{ result: T; notices: string[] }> {
	const notices: string[] = [];
	const onNotice = (n: { message?: string }) => {
		if (n.message) notices.push(n.message);
	};
	s.client.on("notice", onNotice);
	try {
		return { result: await run(), notices };
	} finally {
		s.client.off("notice", onNotice);
	}
}

describe.skipIf(!runIntegration)("work-item-merge guard", () => {
	let s: ScratchSchema;
	let tag = 0;

	beforeEach(async () => {
		if (s) await s.drop();
		s = await createScratchSchema("wim_guard");
		await applySchema(s.client);
		tag += 1;
	});

	afterAll(async () => {
		if (s) await s.drop();
		await pool.end();
	});

	it("Re-run after go-live is a no-op", async () => {
		const ws = await seedWorkspace(s, `g1-${tag}`);
		const itemId = await seedItem(s, ws, 11);
		await seedItem(s, ws, 12);
		await seedEvents(s, ws, itemId, 2);
		await applySchema(s.client, ENABLED);

		const [ti] = await rows(
			s,
			"SELECT migrated_to_id FROM tracker_items WHERE id = $1",
			[itemId],
		);
		// Post go-live user activity: an edit and a brand-new card.
		await s.client.query(
			"UPDATE cards SET title = 'edited after go-live' WHERE id = $1",
			[ti.migrated_to_id],
		);
		await s.client.query(
			`INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number)
			 VALUES ($1, NULL, 'created after go-live', 1, $2, 99)`,
			[ws.id, ws.statusId],
		);
		const cardsBefore = await rows(
			s,
			"SELECT * FROM cards WHERE workspace_id = $1 ORDER BY id",
			[ws.id],
		);
		const eventsBefore = await rows(
			s,
			"SELECT count(*)::int AS n FROM card_events WHERE workspace_id = $1",
			[ws.id],
		);

		const { notices } = await withNotices(s, () =>
			applySchema(s.client, ENABLED),
		);

		expect(
			notices.some((m) => m.startsWith("work-item-merge: copy skipped")),
		).toBe(true);
		expect(
			notices.some((m) => m.startsWith("work-item-merge: workspace=")),
		).toBe(false);
		expect(
			await rows(s, "SELECT * FROM cards WHERE workspace_id = $1 ORDER BY id", [
				ws.id,
			]),
		).toEqual(cardsBefore);
		expect(
			await rows(
				s,
				"SELECT count(*)::int AS n FROM card_events WHERE workspace_id = $1",
				[ws.id],
			),
		).toEqual(eventsBefore);
		const [edited] = await rows(s, "SELECT title FROM cards WHERE id = $1", [
			ti.migrated_to_id,
		]);
		expect(edited.title).toBe("edited after go-live");
	});
});
