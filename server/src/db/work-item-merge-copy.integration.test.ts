// Requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/db/work-item-merge-copy.integration.test.ts
import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applySchema } from "./migrate.js";
import { pool } from "./pool.js";
import {
	createScratchSchema,
	type ScratchSchema,
} from "./scratch-schema-test-support.js";

const ENABLED = { workItemMerge: true };
const runIntegration = Boolean(process.env.RUN_INTEGRATION);

type Ws = {
	id: number;
	userId: number;
	otherUserId: number;
	statusId: number;
	priorityId: number;
	labelId: number;
};

async function rows<T = Record<string, any>>(
	s: ScratchSchema,
	sql: string,
	values: unknown[] = [],
): Promise<T[]> {
	return (await s.client.query(sql, values)).rows as T[];
}

async function seedWorkspace(s: ScratchSchema, tag: string): Promise<Ws> {
	const [user] = await rows(
		s,
		"INSERT INTO users (username, display_name, password_hash) VALUES ($1, 'U', 'x') RETURNING id",
		[`${tag}-a`],
	);
	const [other] = await rows(
		s,
		"INSERT INTO users (username, display_name, password_hash) VALUES ($1, 'U2', 'x') RETURNING id",
		[`${tag}-b`],
	);
	const [ws] = await rows(
		s,
		"INSERT INTO workspaces (name, owner_user_id) VALUES ($1, $2) RETURNING id",
		[tag, user.id],
	);
	const vocab = async (kind: string, name: string, slot: string | null) =>
		(
			await rows(
				s,
				"INSERT INTO tracker_vocabularies (workspace_id, kind, name, position, colour, slot) VALUES ($1, $2, $3, 1, '#000', $4) RETURNING id",
				[ws.id, kind, name, slot],
			)
		)[0].id as number;
	return {
		id: ws.id,
		userId: user.id,
		otherUserId: other.id,
		statusId: await vocab("status", `Todo-${tag}`, "todo"),
		priorityId: await vocab("priority", `High-${tag}`, null),
		labelId: await vocab("label", `Bug-${tag}`, null),
	};
}

async function seedItem(
	s: ScratchSchema,
	ws: Ws,
	key: number,
	extra: { deletedAt?: string | null } = {},
): Promise<number> {
	const [item] = await rows(
		s,
		`INSERT INTO tracker_items
		 (workspace_id, key_number, title, description, status_id, priority_id, version,
		  deleted_at, created_at, updated_at, start_date, end_date, completed_at, position)
		 VALUES ($1, $2, $3, 'desc', $4, $5, 3, $6, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z',
		         '2026-03-01', '2026-03-09', '2026-03-05T00:00:00Z', 2048)
		 RETURNING id`,
		[
			ws.id,
			key,
			`item-${key}`,
			ws.statusId,
			ws.priorityId,
			extra.deletedAt ?? null,
		],
	);
	return item.id;
}

async function seedEvents(
	s: ScratchSchema,
	ws: Ws,
	itemId: number | null,
	count: number,
	type = "tracker_item_updated",
	payload: unknown = { n: 1 },
) {
	for (let i = 0; i < count; i++) {
		await s.client.query(
			`INSERT INTO tracker_events (tracker_item_id, actor_id, event_type, payload, workspace_id, created_at)
			 VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
			[
				itemId,
				ws.userId,
				type,
				JSON.stringify(payload),
				ws.id,
				`2026-01-0${i + 2}T00:00:00Z`,
			],
		);
	}
}

describe.skipIf(!runIntegration)("work-item-merge copy block", () => {
	let s: ScratchSchema;
	let tag = 0;

	beforeEach(async () => {
		if (s) await s.drop();
		s = await createScratchSchema("wim_copy");
		await applySchema(s.client);
		tag += 1;
	});

	afterAll(async () => {
		if (s) await s.drop();
		await pool.end();
	});

	it("Copy block is skipped unless the merge is enabled", async () => {
		vi.stubEnv("WORK_ITEM_MERGE", "");
		try {
			const ws = await seedWorkspace(s, `c0-${tag}`);
			const itemId = await seedItem(s, ws, 51);
			const notices: string[] = [];
			const onNotice = (n: { message?: string }) => {
				if (n.message) notices.push(n.message);
			};
			s.client.on("notice", onNotice);
			try {
				await applySchema(s.client);
			} finally {
				s.client.off("notice", onNotice);
			}
			expect(
				notices.some((m) => m.startsWith("work-item-merge: copy skipped")),
			).toBe(true);
			const [ti] = await rows(
				s,
				"SELECT migrated_to_id FROM tracker_items WHERE id = $1",
				[itemId],
			);
			expect(ti.migrated_to_id).toBeNull();
			expect(
				await rows(s, "SELECT id FROM cards WHERE workspace_id = $1", [ws.id]),
			).toHaveLength(0);
			// Phase A expand still applies while the copy is disabled.
			const [col] = await rows(
				s,
				`SELECT is_nullable FROM information_schema.columns
				 WHERE table_schema = current_schema() AND table_name = 'cards' AND column_name = 'column_id'`,
			);
			expect(col.is_nullable).toBe("YES");

			await applySchema(s.client, ENABLED);
			const [after] = await rows(
				s,
				"SELECT migrated_to_id FROM tracker_items WHERE id = $1",
				[itemId],
			);
			expect(after.migrated_to_id).toEqual(expect.any(Number));
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("copies a tracker item with all its data and relations", async () => {
		const ws = await seedWorkspace(s, `c1-${tag}`);
		const itemId = await seedItem(s, ws, 11);
		await s.client.query(
			"INSERT INTO tracker_item_assignees (tracker_item_id, user_id) VALUES ($1, $2), ($1, $3)",
			[itemId, ws.userId, ws.otherUserId],
		);
		await s.client.query(
			"INSERT INTO tracker_item_labels (tracker_item_id, vocabulary_id) VALUES ($1, $2)",
			[itemId, ws.labelId],
		);
		await seedEvents(s, ws, itemId, 5);

		await applySchema(s.client, ENABLED);

		const [ti] = await rows(s, "SELECT * FROM tracker_items WHERE id = $1", [
			itemId,
		]);
		expect(ti.migrated_to_id).toEqual(expect.any(Number));
		const [card] = await rows(s, "SELECT * FROM cards WHERE id = $1", [
			ti.migrated_to_id,
		]);
		expect(card.column_id).toBeNull();
		for (const f of [
			"workspace_id",
			"key_number",
			"title",
			"description",
			"status_id",
			"priority_id",
			"project_id",
			"phase_id",
			"start_date",
			"end_date",
			"completed_at",
			"version",
			"created_at",
			"updated_at",
			"deleted_at",
		]) {
			expect(card[f], f).toEqual(ti[f]);
		}
		expect(card.version).toBe(3);
		expect(card.plan_position).toBe(ti.position);
		expect(card.position).toEqual(expect.any(Number));

		const asg = await rows(
			s,
			"SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY user_id",
			[card.id],
		);
		expect(asg.map((r) => r.user_id)).toEqual(
			[ws.userId, ws.otherUserId].sort((a, b) => a - b),
		);
		const lbl = await rows(
			s,
			"SELECT vocabulary_id FROM card_labels WHERE card_id = $1",
			[card.id],
		);
		expect(lbl.map((r) => r.vocabulary_id)).toEqual([ws.labelId]);

		const ev = await rows(
			s,
			"SELECT * FROM card_events WHERE card_id = $1 ORDER BY created_at",
			[card.id],
		);
		const src = await rows(
			s,
			"SELECT * FROM tracker_events WHERE tracker_item_id = $1 ORDER BY created_at",
			[itemId],
		);
		expect(ev).toHaveLength(5);
		expect(
			ev.map((e) => [
				e.event_type,
				e.payload,
				e.created_at,
				e.actor_id,
				e.workspace_id,
			]),
		).toEqual(
			src.map((e) => [
				e.event_type,
				e.payload,
				e.created_at,
				e.actor_id,
				e.workspace_id,
			]),
		);

		// idempotent: a second run copies nothing new
		await applySchema(s.client, ENABLED);
		expect(
			(await rows(s, "SELECT id FROM cards WHERE key_number = 11")).length,
		).toBe(1);
		expect(
			(
				await rows(s, "SELECT id FROM card_events WHERE card_id = $1", [
					card.id,
				])
			).length,
		).toBe(5);
	});
	it("copies item-less events, rewrites released ids and remaps focus sessions", async () => {
		const ws = await seedWorkspace(s, `c2-${tag}`);
		const a = await seedItem(s, ws, 21);
		const b = await seedItem(s, ws, 22);
		await seedEvents(s, ws, null, 1, "tracker_project_created", {
			projectId: 7,
			name: "p",
		});
		await seedEvents(s, ws, null, 2, "tracker_vocabulary_created", {
			vocabularyId: 9,
		});
		await seedEvents(s, ws, null, 1, "tracker_project_deleted", {
			projectId: 7,
			released: [
				{ itemId: b, projectId: 7, phaseId: null },
				{ itemId: a, projectId: 7, phaseId: 3 },
			],
		});
		await s.client.query(
			`INSERT INTO focus_sessions (user_id, workspace_id, task_source, task_id, task_key, return_path, state)
			 VALUES ($1, $3, 'tracker', $4, 'K-21', '/tracker/K-21', 'ready'),
			        ($2, $3, 'board', $4, NULL, '/board/card/' || $4, 'ready')`,
			[ws.userId, ws.otherUserId, ws.id, a],
		);

		await applySchema(s.client, ENABLED);

		const map = new Map(
			(await rows(s, "SELECT id, migrated_to_id FROM tracker_items")).map(
				(r) => [r.id, r.migrated_to_id],
			),
		);
		const events = await rows(
			s,
			"SELECT * FROM card_events WHERE card_id IS NULL AND workspace_id = $1 ORDER BY created_at, id",
			[ws.id],
		);
		expect(events.map((e) => e.event_type).sort()).toEqual([
			"tracker_project_created",
			"tracker_project_deleted",
			"tracker_vocabulary_created",
			"tracker_vocabulary_created",
		]);
		expect(
			events.find((e) => e.event_type === "tracker_project_created").payload,
		).toEqual({ projectId: 7, name: "p" });
		expect(
			events.find((e) => e.event_type === "tracker_project_deleted").payload,
		).toEqual({
			projectId: 7,
			released: [
				{ itemId: map.get(b), projectId: 7, phaseId: null },
				{ itemId: map.get(a), projectId: 7, phaseId: 3 },
			],
		});

		const focus = await rows(
			s,
			"SELECT task_source, task_id, return_path FROM focus_sessions ORDER BY task_source",
		);
		expect(focus[0]).toMatchObject({
			task_source: "board",
			task_id: a,
			return_path: `/board/card/${a}`,
		});
		expect(focus[1]).toMatchObject({
			task_source: "tracker",
			task_id: map.get(a),
			return_path: "/tracker/K-21",
		});
		const orphans = await rows(
			s,
			`SELECT 1 FROM focus_sessions f
			 WHERE f.task_source = 'tracker'
			   AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.id = f.task_id)`,
		);
		expect(orphans).toHaveLength(0);

		// idempotent: a second run copies and remaps nothing
		await applySchema(s.client, ENABLED);
		expect(
			(
				await rows(s, "SELECT id FROM card_events WHERE workspace_id = $1", [
					ws.id,
				])
			).length,
		).toBe(4);
		expect(
			(
				await rows(
					s,
					"SELECT task_id FROM focus_sessions WHERE task_source = 'tracker'",
				)
			)[0].task_id,
		).toBe(map.get(a));
	});
	it("preserves soft-deleted tracker rows and leaves empty workspaces unchanged", async () => {
		const ws = await seedWorkspace(s, `c3-${tag}`);
		const empty = await seedWorkspace(s, `c3e-${tag}`);
		const deleted = await seedItem(s, ws, 31, {
			deletedAt: "2026-04-01T00:00:00Z",
		});
		await seedItem(s, ws, 32);

		await applySchema(s.client, ENABLED);

		const [ti] = await rows(s, "SELECT * FROM tracker_items WHERE id = $1", [
			deleted,
		]);
		expect(ti.migrated_to_id).toEqual(expect.any(Number));
		const [card] = await rows(s, "SELECT * FROM cards WHERE id = $1", [
			ti.migrated_to_id,
		]);
		expect(card.key_number).toBe(31);
		expect(card.deleted_at).toEqual(ti.deleted_at);
		expect(card.deleted_at).not.toBeNull();
		expect(
			await rows(s, "SELECT id FROM cards WHERE workspace_id = $1", [empty.id]),
		).toHaveLength(0);
		expect(
			await rows(s, "SELECT id FROM cards WHERE workspace_id = $1", [ws.id]),
		).toHaveLength(2);
	});
	it("emits one audit notice per affected workspace and no extra audit rows", async () => {
		const w1 = await seedWorkspace(s, `c4a-${tag}`);
		const w2 = await seedWorkspace(s, `c4b-${tag}`);
		await seedWorkspace(s, `c4c-${tag}`);
		const i1 = await seedItem(s, w1, 41);
		await seedItem(s, w1, 42);
		const i2 = await seedItem(s, w2, 43);
		await seedEvents(s, w1, i1, 3);
		await seedEvents(s, w2, null, 1, "tracker_project_deleted", {
			projectId: 1,
			released: [
				{ itemId: i2, projectId: 1, phaseId: null },
				{ itemId: 987654, projectId: 1, phaseId: null },
			],
		});

		const messages: string[] = [];
		const onNotice = (n: { message?: string }) => {
			if (n.message?.startsWith("work-item-merge:")) messages.push(n.message);
		};
		s.client.on("notice", onNotice);
		try {
			await applySchema(s.client, ENABLED);
			expect(messages.sort()).toEqual(
				[
					`work-item-merge: workspace=${w1.id} tracker_before=2 cards_added=2`,
					`work-item-merge: workspace=${w2.id} tracker_before=1 cards_added=1 released_unmapped=1`,
				].sort(),
			);
			expect((await rows(s, "SELECT id FROM card_events")).length).toBe(4);

			messages.length = 0;
			await applySchema(s.client, ENABLED);
			expect(messages).toEqual([]);
			expect((await rows(s, "SELECT id FROM card_events")).length).toBe(4);
		} finally {
			s.client.off("notice", onNotice);
		}
	});
	it("aborts the whole merge when a tracker key collides with a card key", async () => {
		const ws = await seedWorkspace(s, `c5-${tag}`);
		await seedItem(s, ws, 7);
		await seedItem(s, ws, 8);
		await s.client.query(
			`INSERT INTO cards (column_id, title, position, workspace_id, status_id, key_number)
			 VALUES (NULL, 'native', 1, $1, $2, 7)`,
			[ws.id, ws.statusId],
		);

		await expect(applySchema(s.client, ENABLED)).rejects.toThrow(
			new RegExp(`^work-item-merge: key collision workspace=${ws.id} key=7`),
		);

		expect(
			await rows(
				s,
				"SELECT id FROM tracker_items WHERE migrated_to_id IS NOT NULL",
			),
		).toHaveLength(0);
		expect(
			await rows(s, "SELECT key_number FROM cards WHERE workspace_id = $1", [
				ws.id,
			]),
		).toEqual([{ key_number: 7 }]);
	});
});
