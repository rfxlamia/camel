/**
 * Integration tests for the due-date-reminder scheduler.
 *
 * Requires a running PostgreSQL instance. Gated behind RUN_INTEGRATION=1.
 * The scheduler's own query only matches during the midnight hour (UTC, or
 * workspace timezone) — tests that depend on an actual reminder being
 * inserted are additionally skipped outside that hour, since Postgres's
 * CURRENT_TIMESTAMP can't be faked from the test process. Tests that assert
 * a reminder is correctly *excluded* (done column, wrong due date) don't
 * depend on the hour and always run.
 *
 * Run:
 *   RUN_INTEGRATION=1 npx vitest run src/notifications/scheduler.test.ts
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { seedTrackerVocabulary } from "../core/tracker-vocabulary-seed.js";
import { db } from "../db/kysely.js";
import { runDueDateReminders } from "./scheduler.js";

const isMidnightHourUtc = new Date().getUTCHours() === 0;

let workspaceId: number;
let userId: number;

async function statusIdForSlot(slot: string) {
	const row = await db
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.where("slot", "=", slot)
		.executeTakeFirstOrThrow();
	return row.id;
}

async function todayDateString(): Promise<string> {
	const result = await sql<{ today: string }>`select to_char(now(), 'YYYY-MM-DD') as today`.execute(db);
	return result.rows[0].today;
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"runDueDateReminders (real DB)",
	() => {
		beforeAll(async () => {
			const user = await db
				.insertInto("users")
				.values({ username: `scheduler-${Date.now()}`, display_name: "Scheduler User", password_hash: "h" })
				.returning("id")
				.executeTakeFirstOrThrow();
			userId = user.id;
			const workspace = await db
				.insertInto("workspaces")
				.values({ name: "Scheduler WS", owner_user_id: userId, is_personal: false })
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;
			await seedTrackerVocabulary(db, workspaceId);
		});

		afterAll(async () => {
			await db.deleteFrom("notifications").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("cards").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("columns").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db.deleteFrom("users").where("id", "=", userId).execute();
		});

		afterEach(async () => {
			await db.deleteFrom("notifications").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("cards").where("workspace_id", "=", workspaceId).execute();
			await db.deleteFrom("columns").where("workspace_id", "=", workspaceId).execute();
		});

		it("skips cards in done columns", async () => {
			const today = await todayDateString();
			const doneColumn = await db
				.insertInto("columns")
				.values({ title: "Done", position: 1000, workspace_id: workspaceId, is_done: true })
				.returning("id")
				.executeTakeFirstOrThrow();
			const card = await db
				.insertInto("cards")
				.values({
					title: "Done card",
					column_id: doneColumn.id,
					position: 1000,
					workspace_id: workspaceId,
					due_date: today,
					status_id: await statusIdForSlot("done"),
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			await db
				.insertInto("card_assignees")
				.values({ card_id: card.id, user_id: userId })
				.execute();

			await runDueDateReminders();

			const rows = await db
				.selectFrom("notifications")
				.selectAll()
				.where("card_id", "=", card.id)
				.execute();
			expect(rows).toHaveLength(0);
		});

		it("skips cards not due today", async () => {
			const column = await db
				.insertInto("columns")
				.values({ title: "Backlog", position: 1000, workspace_id: workspaceId })
				.returning("id")
				.executeTakeFirstOrThrow();
			const card = await db
				.insertInto("cards")
				.values({
					title: "Future card",
					column_id: column.id,
					position: 1000,
					workspace_id: workspaceId,
					due_date: "2099-01-01",
					status_id: await statusIdForSlot("backlog"),
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			await db
				.insertInto("card_assignees")
				.values({ card_id: card.id, user_id: userId })
				.execute();

			await runDueDateReminders();

			const rows = await db
				.selectFrom("notifications")
				.selectAll()
				.where("card_id", "=", card.id)
				.execute();
			expect(rows).toHaveLength(0);
		});

		it.skipIf(!isMidnightHourUtc)(
			"inserts reminder for card due today and is idempotent on second run",
			async () => {
				const today = await todayDateString();
				const column = await db
					.insertInto("columns")
					.values({ title: "Backlog", position: 1000, workspace_id: workspaceId })
					.returning("id")
					.executeTakeFirstOrThrow();
				const card = await db
					.insertInto("cards")
					.values({
						title: "Due today",
						column_id: column.id,
						position: 1000,
						workspace_id: workspaceId,
						due_date: today,
						status_id: await statusIdForSlot("backlog"),
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				await db
					.insertInto("card_assignees")
					.values({ card_id: card.id, user_id: userId })
					.execute();

				await runDueDateReminders();
				await runDueDateReminders();

				const rows = await db
					.selectFrom("notifications")
					.selectAll()
					.where("card_id", "=", card.id)
					.where("type", "=", "due_date_reminder")
					.execute();
				expect(rows).toHaveLength(1);
			},
		);
	},
);
