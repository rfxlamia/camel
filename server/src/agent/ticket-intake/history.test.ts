/**
 * Integration test for getTicketHistory — exercises the real Kysely query
 * against Postgres (the card_events read path used by ticket-intake history).
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/agent/ticket-intake/history.test.ts
 */
import "dotenv/config";
import { afterAll, describe, expect, expectTypeOf, it } from "vitest";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import { recordActivity } from "../../routes/helpers.js";
import { getTicketHistory } from "./history.js";

describe.skipIf(!process.env.RUN_INTEGRATION)("getTicketHistory", () => {
	const cleanup: Array<() => Promise<unknown>> = [];
	afterAll(async () => {
		for (const fn of cleanup.reverse()) await fn();
	});

	async function makeFixtures() {
		const user = await db
			.insertInto("users")
			.values({
				username: `history-test-${Date.now()}`,
				display_name: "History Tester",
				password_hash: "hashed",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		const workspace = await db
			.insertInto("workspaces")
			.values({
				name: "History Test WS",
				owner_user_id: user.id,
				is_personal: false,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		await seedTrackerVocabulary(db, workspace.id);
		const backlog = await db
			.selectFrom("tracker_vocabularies")
			.select("id")
			.where("workspace_id", "=", workspace.id)
			.where("kind", "=", "status")
			.where("slot", "=", "backlog")
			.executeTakeFirstOrThrow();
		const column = await db
			.insertInto("columns")
			.values({ title: "Backlog", position: 1000, workspace_id: workspace.id })
			.returning("id")
			.executeTakeFirstOrThrow();
		const card = await db
			.insertInto("cards")
			.values({
				title: "Card",
				column_id: column.id,
				position: 1000,
				workspace_id: workspace.id,
				status_id: backlog.id,
			})
			.returning("id")
			.executeTakeFirstOrThrow();

		cleanup.push(async () => {
			await db.deleteFrom("cards").where("id", "=", card.id).execute();
			await db.deleteFrom("columns").where("id", "=", column.id).execute();
			await db
				.deleteFrom("workspaces")
				.where("id", "=", workspace.id)
				.execute();
			await db.deleteFrom("users").where("id", "=", user.id).execute();
		});

		return {
			workspaceId: workspace.id,
			cardId: card.id,
			actor: { id: user.id, displayName: "History Tester" },
		};
	}

	it("returns 2 entries most-recent first for 2 events", async () => {
		const { workspaceId, cardId, actor } = await makeFixtures();

		await recordActivity(db, actor, workspaceId, "linear_ticket_created", {
			cardId,
			payload: {
				title: "Old ticket",
				issueUrl: "https://linear.app/issue/old",
			},
		});
		await recordActivity(db, actor, workspaceId, "linear_ticket_created", {
			cardId,
			payload: {
				title: "New ticket",
				issueUrl: "https://linear.app/issue/new",
			},
		});

		const result = await getTicketHistory(db, workspaceId, cardId);

		expect(result).toHaveLength(2);
		expect(result[0].title).toBe("New ticket");
		expect(result[1].title).toBe("Old ticket");
	});

	it("returns empty array when no events exist", async () => {
		const { workspaceId, cardId } = await makeFixtures();

		const result = await getTicketHistory(db, workspaceId, cardId);

		expect(result).toEqual([]);
	});

	it("breaks created_at ties by id desc, newest insert first", async () => {
		const { workspaceId, cardId, actor } = await makeFixtures();

		// A single multi-row INSERT shares one now() evaluation (STABLE, not
		// VOLATILE), so these rows get identical created_at — only the id
		// tiebreak can keep "most recent first" deterministic.
		await db
			.insertInto("card_events")
			.values([
				{
					card_id: cardId,
					actor_id: actor.id,
					event_type: "linear_ticket_created",
					payload: JSON.stringify({
						title: "First",
						issueUrl: "https://linear.app/issue/1",
					}),
					workspace_id: workspaceId,
				},
				{
					card_id: cardId,
					actor_id: actor.id,
					event_type: "linear_ticket_created",
					payload: JSON.stringify({
						title: "Second",
						issueUrl: "https://linear.app/issue/2",
					}),
					workspace_id: workspaceId,
				},
			])
			.execute();

		const result = await getTicketHistory(db, workspaceId, cardId);

		expect(result.map((r) => r.title)).toEqual(["Second", "First"]);
	});
});

describe("recordActivity eventType", () => {
	it("accepts linear_ticket_created", () => {
		expectTypeOf<"linear_ticket_created">().toMatchTypeOf<
			Parameters<typeof recordActivity>[3]
		>();
	});
});
