// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-merge-guard.integration.test.ts
import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
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

	describe("parity assertions", () => {
		const SABOTAGE_FN = "wim_guard_sabotage";
		let observer: Awaited<ReturnType<typeof pool.connect>> | undefined;

		async function sabotage(table: string, timing: string, body: string) {
			await s.client.query(
				`CREATE FUNCTION ${SABOTAGE_FN}() RETURNS trigger LANGUAGE plpgsql AS $f$
				 BEGIN ${body} END $f$`,
			);
			await s.client.query(
				`CREATE TRIGGER wim_guard_sabotage ${timing} ON ${table}
				 FOR EACH ROW EXECUTE FUNCTION ${SABOTAGE_FN}()`,
			);
		}

		async function dropSabotage(table: string) {
			await s.client.query(
				`DROP TRIGGER IF EXISTS wim_guard_sabotage ON ${table}`,
			);
			await s.client.query(`DROP FUNCTION IF EXISTS ${SABOTAGE_FN}()`);
		}

		afterEach(() => {
			observer?.release();
			observer = undefined;
		});

		it("Any parity mismatch rolls everything back", async () => {
			const ws = await seedWorkspace(s, `g2-${tag}`);
			const a = await seedItem(s, ws, 21);
			await seedItem(s, ws, 22);
			await s.client.query(
				"INSERT INTO tracker_item_labels (tracker_item_id, vocabulary_id) VALUES ($1, $2)",
				[a, ws.labelId],
			);
			// Fails after the cards and labels were copied, inside the same
			// transaction.
			await sabotage(
				"card_labels",
				"AFTER INSERT",
				"RAISE EXCEPTION 'sabotage after copy'; RETURN NULL;",
			);
			try {
				await expect(applySchema(s.client, ENABLED)).rejects.toThrow(
					/sabotage after copy/,
				);
			} finally {
				await dropSabotage("card_labels");
			}

			// Observe from a second connection: the rollback must be real.
			observer = await pool.connect();
			await observer.query(`SET search_path TO "${s.schema}"`);
			// Positive control: the observer really reads the scratch schema.
			const seeded = await observer.query(
				"SELECT count(*)::int AS n FROM tracker_items WHERE workspace_id = $1",
				[ws.id],
			);
			expect(seeded.rows[0].n).toBe(2);
			const migrated = await observer.query(
				"SELECT count(*)::int AS n FROM tracker_items WHERE migrated_to_id IS NOT NULL",
			);
			expect(migrated.rows[0].n).toBe(0);
			const copied = await observer.query(
				"SELECT count(*)::int AS n FROM cards WHERE workspace_id = $1",
				[ws.id],
			);
			expect(copied.rows[0].n).toBe(0);
		});

		const cases: {
			name: string;
			table: string;
			timing: string;
			body: string;
			expected: RegExp;
		}[] = [
			{
				name: "a copied field that differs",
				table: "cards",
				timing: "BEFORE INSERT",
				body: "NEW.title := NEW.title || ' (mutated)'; RETURN NEW;",
				expected: /^work-item-merge: .*workspace=\d+ key=31/,
			},
			{
				name: "a tracker row that never got a card",
				table: "cards",
				timing: "BEFORE INSERT",
				body: "IF NEW.key_number = 32 THEN RETURN NULL; END IF; RETURN NEW;",
				expected: /^work-item-merge: .*workspace=\d+/,
			},
			{
				name: "a lost label",
				table: "card_labels",
				timing: "AFTER INSERT",
				body: "DELETE FROM card_labels WHERE card_id = NEW.card_id; RETURN NULL;",
				expected: /^work-item-merge: .*workspace=\d+ key=31/,
			},
			{
				name: "a lost assignee",
				table: "card_assignees",
				timing: "AFTER INSERT",
				body: "DELETE FROM card_assignees WHERE card_id = NEW.card_id; RETURN NULL;",
				expected: /^work-item-merge: .*workspace=\d+ key=31/,
			},
			{
				name: "a lost event",
				table: "card_events",
				timing: "AFTER INSERT",
				body: "DELETE FROM card_events WHERE id = NEW.id AND card_id IS NOT NULL; RETURN NULL;",
				expected: /^work-item-merge: .*workspace=\d+ key=31/,
			},
			{
				name: "a focus session pointing at the wrong card",
				table: "focus_sessions",
				timing: "BEFORE UPDATE",
				body: "NEW.task_id := -1; RETURN NEW;",
				expected: /^work-item-merge: .*workspace=\d+ key=31/,
			},
		];

		for (const c of cases) {
			it(`Parity assertion fails loudly for ${c.name}`, async () => {
				const ws = await seedWorkspace(s, `g2m-${tag}`);
				const a = await seedItem(s, ws, 31);
				await seedItem(s, ws, 32);
				await s.client.query(
					"INSERT INTO tracker_item_labels (tracker_item_id, vocabulary_id) VALUES ($1, $2)",
					[a, ws.labelId],
				);
				await s.client.query(
					"INSERT INTO tracker_item_assignees (tracker_item_id, user_id) VALUES ($1, $2)",
					[a, ws.userId],
				);
				await seedEvents(s, ws, a, 2);
				await s.client.query(
					`INSERT INTO focus_sessions (user_id, workspace_id, task_source, task_id, return_path, state)
					 VALUES ($1, $2, 'tracker', $3, '/x', 'ready')`,
					[ws.userId, ws.id, a],
				);
				await sabotage(c.table, c.timing, c.body);
				try {
					await expect(applySchema(s.client, ENABLED)).rejects.toThrow(
						c.expected,
					);
				} finally {
					await dropSabotage(c.table);
				}
				const left = await rows(
					s,
					"SELECT count(*)::int AS n FROM tracker_items WHERE migrated_to_id IS NOT NULL",
				);
				expect(left[0].n).toBe(0);
			});
		}
	});
});
