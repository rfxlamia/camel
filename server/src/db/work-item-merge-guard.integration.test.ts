// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-merge-guard.integration.test.ts
import "dotenv/config";
import { Kysely, PostgresDialect } from "kysely";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { allocateWorkItemKey } from "../core/allocate-work-item-key.js";
import { applySchema } from "./migrate.js";
import { pool } from "./pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "./scratch-schema-test-support.js";
import type { DB } from "./types.js";
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

		// Labeled regression guard: atomicity (BEGIN/ROLLBACK in applySchema plus
		// the single DO block) predates T8, so this was green on first run. Proven
		// able to fail by wrapping the card_labels copy in an EXCEPTION-swallowing
		// sub-block, which changes the error the test sees.
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

	it("Counter repair raises every workspace counter to its max key", async () => {
		const w1 = await seedWorkspace(s, `g3a-${tag}`);
		const w2 = await seedWorkspace(s, `g3b-${tag}`);
		// w1: tracker rows migrate to cards; counter far below the max key.
		await seedItem(s, w1, 11);
		await seedItem(s, w1, 12);
		// w2: the max key lives on a soft-deleted card only.
		for (const [key, deleted] of [
			[3, false],
			[9, true],
		] as const) {
			await s.client.query(
				`INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number, deleted_at)
				 VALUES ($1, NULL, 'c', 1, $2, $3, ${deleted ? "now()" : "NULL"})`,
				[w2.id, w2.statusId, key],
			);
		}
		await s.client.query(
			"UPDATE workspaces SET tracker_key_counter = 2 WHERE id = ANY($1)",
			[[w1.id, w2.id]],
		);

		await applySchema(s.client, ENABLED);

		const counters = await rows(
			s,
			"SELECT id, tracker_key_counter FROM workspaces WHERE id = ANY($1) ORDER BY id",
			[[w1.id, w2.id]],
		);
		expect(counters.map((r) => r.tracker_key_counter)).toEqual([12, 9]);

		// The allocator hands out max + 1 on the repaired counters.
		const scratchDb = new Kysely<DB>({
			dialect: new PostgresDialect({
				pool: {
					connect: async () => ({
						query: s.client.query.bind(s.client),
						release: () => {},
					}),
					end: async () => {},
				} as any,
			}),
		});
		expect(
			await allocateWorkItemKey(scratchDb, { workspaceId: w1.id }),
		).toEqual({ keyNumber: 13 });
		expect(
			await allocateWorkItemKey(scratchDb, { workspaceId: w2.id }),
		).toEqual({ keyNumber: 10 });
	});

	it("Late-write trigger blocks inserts only", async () => {
		const ws = await seedWorkspace(s, `g4-${tag}`);
		const itemId = await seedItem(s, ws, 41);
		await applySchema(s.client, ENABLED);

		await expect(seedItem(s, ws, 42)).rejects.toThrow(/work-item-merge/);
		await s.client.query(
			"UPDATE tracker_items SET title = 'still editable' WHERE id = $1",
			[itemId],
		);
		const selected = await rows(
			s,
			"SELECT title FROM tracker_items WHERE workspace_id = $1",
			[ws.id],
		);
		expect(selected.map((r) => r.title)).toEqual(["still editable"]);

		// Re-running (with and without the gate) must not trip over the trigger.
		await applySchema(s.client, ENABLED);
		await applySchema(s.client);
		await expect(seedItem(s, ws, 43)).rejects.toThrow(/work-item-merge/);
	});

	// Labeled regression guard: cycle 4's conditional trigger already satisfies
	// this. Proven able to fail by dropping the "migrated rows exist" condition.
	it("Fresh or empty database gets no trigger", async () => {
		const triggerCount = async () =>
			(
				await rows(
					s,
					`SELECT count(*)::int AS n FROM pg_trigger
					 WHERE tgrelid = 'tracker_items'::regclass AND NOT tgisinternal`,
				)
			)[0].n;

		await applySchema(s.client);
		expect(await triggerCount()).toBe(0);
		// The gate is on but there is nothing to migrate: still no trigger.
		await applySchema(s.client, ENABLED);
		expect(await triggerCount()).toBe(0);

		const ws = await seedWorkspace(s, `g5-${tag}`);
		await seedItem(s, ws, 51);
		const [row] = await rows(
			s,
			"SELECT count(*)::int AS n FROM tracker_items WHERE workspace_id = $1",
			[ws.id],
		);
		expect(row.n).toBe(1);
	});

	// Labeled regression guard: the cycle 1 run-once guard plus the
	// `migrated_to_id IS NULL` scoping of the copy already satisfy this. Proven
	// able to fail by removing that filter from the copy's INSERT ... SELECT.
	it("Partially migrated state only processes the remaining rows", async () => {
		const ws = await seedWorkspace(s, `g6-${tag}`);
		const ids: number[] = [];
		for (const key of [61, 62, 63, 64, 65])
			ids.push(await seedItem(s, ws, key));
		await applySchema(s.client, ENABLED);

		// Rebuild an interrupted state: only the first 2 rows stay migrated.
		const remaining = ids.slice(2);
		const stale = await rows(
			s,
			"SELECT migrated_to_id FROM tracker_items WHERE id = ANY($1)",
			[remaining],
		);
		await s.client.query("DELETE FROM cards WHERE id = ANY($1)", [
			stale.map((r) => r.migrated_to_id),
		]);
		await s.client.query(
			"UPDATE tracker_items SET migrated_to_id = NULL WHERE id = ANY($1)",
			[remaining],
		);
		await s.client.query(
			"UPDATE cards SET title = 'edited' WHERE id IN (SELECT migrated_to_id FROM tracker_items WHERE id = ANY($1))",
			[ids.slice(0, 2)],
		);
		const firstTwoBefore = await rows(
			s,
			"SELECT * FROM cards WHERE id IN (SELECT migrated_to_id FROM tracker_items WHERE id = ANY($1)) ORDER BY id",
			[ids.slice(0, 2)],
		);
		expect(firstTwoBefore).toHaveLength(2);

		const { notices } = await withNotices(s, () =>
			applySchema(s.client, ENABLED),
		);

		expect(notices.filter((m) => m.includes("workspace="))).toEqual([
			`work-item-merge: workspace=${ws.id} tracker_before=3 cards_added=3`,
		]);
		expect(
			await rows(
				s,
				"SELECT * FROM cards WHERE id IN (SELECT migrated_to_id FROM tracker_items WHERE id = ANY($1)) ORDER BY id",
				[ids.slice(0, 2)],
			),
		).toEqual(firstTwoBefore);
		const all = await rows(
			s,
			"SELECT key_number FROM cards WHERE workspace_id = $1 ORDER BY key_number",
			[ws.id],
		);
		expect(all.map((r) => r.key_number)).toEqual([61, 62, 63, 64, 65]);
		const unmigrated = await rows(
			s,
			"SELECT id FROM tracker_items WHERE migrated_to_id IS NULL",
		);
		expect(unmigrated).toHaveLength(0);

		// Second run is a no-op.
		const second = await withNotices(s, () => applySchema(s.client, ENABLED));
		expect(second.notices.some((m) => m.includes("workspace="))).toBe(false);
		expect(
			(
				await rows(
					s,
					"SELECT count(*)::int AS n FROM cards WHERE workspace_id = $1",
					[ws.id],
				)
			)[0].n,
		).toBe(5);
	});

	// Labeled regression guard: the gate check at the top of the guard SQL and
	// the copy block already satisfy this. Proven able to fail by removing the
	// gate check from work-item-merge-guard.sql (counter repair then runs).
	it("Merge gate off leaves everything untouched", async () => {
		vi.stubEnv("WORK_ITEM_MERGE", "");
		try {
			const ws = await seedWorkspace(s, `g7-${tag}`);
			await seedItem(s, ws, 71);
			await s.client.query(
				`INSERT INTO cards (workspace_id, column_id, title, position, status_id, key_number)
				 VALUES ($1, NULL, 'high key', 1, $2, 80)`,
				[ws.id, ws.statusId],
			);
			await s.client.query(
				"UPDATE workspaces SET tracker_key_counter = 5 WHERE id = $1",
				[ws.id],
			);

			const { notices } = await withNotices(s, () => applySchema(s.client));

			expect(
				notices.some((m) => m.startsWith("work-item-merge: copy skipped")),
			).toBe(true);
			expect(notices.some((m) => m.includes("workspace="))).toBe(false);
			expect(
				await rows(s, "SELECT id FROM cards WHERE workspace_id = $1", [ws.id]),
			).toHaveLength(1);
			expect(
				await rows(
					s,
					"SELECT id FROM tracker_items WHERE migrated_to_id IS NOT NULL",
				),
			).toHaveLength(0);
			const [counter] = await rows(
				s,
				"SELECT tracker_key_counter FROM workspaces WHERE id = $1",
				[ws.id],
			);
			expect(counter.tracker_key_counter).toBe(5);
			expect(
				(
					await rows(
						s,
						`SELECT count(*)::int AS n FROM pg_trigger
						 WHERE tgrelid = 'tracker_items'::regclass AND NOT tgisinternal`,
					)
				)[0].n,
			).toBe(0);
			await seedItem(s, ws, 72);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
