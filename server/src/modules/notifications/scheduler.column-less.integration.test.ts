// Integration describe requires a running PostgreSQL. Gated behind RUN_INTEGRATION=1.
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/notifications/scheduler.column-less.integration.test.ts
//
// PINS TODAY'S BEHAVIOR: runDueDateReminders inner-joins `columns`, so a
// column-less (tracker-native / planned) item never produces a due-date
// reminder. Planned items intentionally get no reminders until a product
// decision changes it; if that decision is made, update this test deliberately.
//
// The exclusion comes from the inner join together with `col.is_done = false`
// (a left join alone would still drop NULL columns via that predicate).
//
// Clock note: the reminder query runs on Postgres CURRENT_TIMESTAMP, which a JS
// fake timer cannot move. Instead of faking the clock, the workspace timezone is
// chosen so that it is currently local midnight (the hour the job matches on).
import "dotenv/config";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import { runDueDateReminders } from "./scheduler.js";

let workspaceId: number;
let userId: number;

async function localMidnightZone(): Promise<{ zone: string; today: string }> {
	for (let offset = -12; offset <= 14; offset++) {
		const zone = `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
		const r = await sql<{ hour: number; today: string }>`
			select extract(hour from current_timestamp at time zone ${zone})::int as hour,
			       to_char(current_timestamp at time zone ${zone}, 'YYYY-MM-DD') as today`.execute(
			db,
		);
		if (r.rows[0]!.hour === 0) return { zone, today: r.rows[0]!.today };
	}
	throw new Error("no whole-hour zone is at local midnight");
}

async function cleanupRows() {
	await db
		.deleteFrom("notifications")
		.where("workspace_id", "=", workspaceId)
		.execute();
	await db
		.deleteFrom("cards")
		.where("workspace_id", "=", workspaceId)
		.execute();
	await db
		.deleteFrom("columns")
		.where("workspace_id", "=", workspaceId)
		.execute();
}

describe.skipIf(!process.env.RUN_INTEGRATION)(
	"runDueDateReminders column-less items (real DB)",
	() => {
		beforeAll(async () => {
			const user = await db
				.insertInto("users")
				.values({
					username: `sched-cl-${Date.now()}`,
					display_name: "Sched CL",
					password_hash: "h",
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			userId = user.id;
			const workspace = await db
				.insertInto("workspaces")
				.values({
					name: "Sched CL WS",
					owner_user_id: userId,
					is_personal: false,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			workspaceId = workspace.id;
			await seedTrackerVocabulary(db, workspaceId);
		});

		afterAll(async () => {
			await cleanupRows();
			await db
				.deleteFrom("workspace_settings")
				.where("workspace_id", "=", workspaceId)
				.execute();
			await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
			await db.deleteFrom("users").where("id", "=", userId).execute();
		});

		it("pins inner-join behavior: only the board card gets a reminder, planned (column-less) items get none by design", async () => {
			const { zone, today } = await localMidnightZone();
			await db
				.insertInto("workspace_settings")
				.values({ workspace_id: workspaceId, timezone: zone })
				.onConflict((oc) =>
					oc.column("workspace_id").doUpdateSet({ timezone: zone }),
				)
				.execute();
			const status = await db
				.selectFrom("tracker_vocabularies")
				.select("id")
				.where("workspace_id", "=", workspaceId)
				.where("kind", "=", "status")
				.where("slot", "=", "backlog")
				.executeTakeFirstOrThrow();
			const column = await db
				.insertInto("columns")
				.values({ title: "Backlog", position: 1000, workspace_id: workspaceId })
				.returning("id")
				.executeTakeFirstOrThrow();
			const base = {
				position: 1000,
				workspace_id: workspaceId,
				due_date: today,
				status_id: status.id,
			};
			const boardCard = await db
				.insertInto("cards")
				.values({
					...base,
					title: "Board card",
					column_id: column.id,
					key_number: 1,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			const plannedItem = await db
				.insertInto("cards")
				.values({
					...base,
					title: "Planned item",
					column_id: null,
					key_number: 2,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			await db
				.insertInto("card_assignees")
				.values([
					{ card_id: boardCard.id, user_id: userId },
					{ card_id: plannedItem.id, user_id: userId },
				])
				.execute();

			await runDueDateReminders();

			const reminders = await db
				.selectFrom("notifications")
				.select("card_id")
				.where("workspace_id", "=", workspaceId)
				.where("type", "=", "due_date_reminder")
				.execute();
			expect(reminders.map((r) => r.card_id)).toEqual([boardCard.id]);
			await cleanupRows();
		});
	},
);
