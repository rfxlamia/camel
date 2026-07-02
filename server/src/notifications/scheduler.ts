import { sql } from "kysely";
import { db } from "../db/kysely.js";

export async function runDueDateReminders(): Promise<void> {
	const rows = await db
		.selectFrom("cards as c")
		.innerJoin("columns as col", "col.id", "c.column_id")
		.innerJoin("card_assignees as ca", "ca.card_id", "c.id")
		.leftJoin("workspace_settings as ws", "ws.workspace_id", "c.workspace_id")
		.select([
			"c.id as card_id",
			"ca.user_id as assignee_id",
			"c.title as card_title",
			"c.workspace_id",
		])
		.where("c.deleted_at", "is", null)
		.where("c.due_date", "is not", null)
		.where("col.is_done", "=", false)
		.where(
			sql<boolean>`c.due_date = (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(ws.timezone, 'UTC'))::date`,
		)
		.where(
			sql<boolean>`EXTRACT(HOUR FROM CURRENT_TIMESTAMP AT TIME ZONE COALESCE(ws.timezone, 'UTC')) = 0`,
		)
		.execute();

	for (const row of rows) {
		try {
			await sql`
				INSERT INTO notifications (user_id, workspace_id, type, title, card_id, board_id)
				VALUES (${row.assignee_id}, ${row.workspace_id}, 'due_date_reminder', ${`'${row.card_title}' is due today`}, ${row.card_id}, ${row.workspace_id})
				ON CONFLICT (user_id, card_id, ((created_at AT TIME ZONE 'UTC')::date))
				WHERE type = 'due_date_reminder' DO NOTHING
			`.execute(db);
		} catch (err) {
			console.error(
				`Failed to insert due_date_reminder for card ${row.card_id}:`,
				err,
			);
		}
	}
}

export function startDueDateScheduler(): ReturnType<typeof setInterval> {
	return setInterval(() => {
		void runDueDateReminders();
	}, 60_000);
}
