import { pool } from "../db/pool.js";

export async function runDueDateReminders(): Promise<void> {
	const { rows } = await pool.query(`
    SELECT
      c.id AS card_id,
      c.assignee_id,
      c.title AS card_title,
      c.workspace_id
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    LEFT JOIN workspace_settings ws ON ws.workspace_id = c.workspace_id
    WHERE
      c.deleted_at IS NULL
      AND c.assignee_id IS NOT NULL
      AND c.due_date IS NOT NULL
      AND col.is_done = FALSE
      AND c.due_date = (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(ws.timezone, 'UTC'))::date
  `);

	for (const row of rows) {
		try {
			await pool.query(
				`INSERT INTO notifications (user_id, workspace_id, type, title, card_id)
         VALUES ($1, $2, 'due_date_reminder', $3, $4)
         ON CONFLICT (user_id, card_id, ((created_at AT TIME ZONE 'UTC')::date))
         WHERE type = 'due_date_reminder' DO NOTHING`,
				[
					row.assignee_id,
					row.workspace_id,
					`'${row.card_title}' is due today`,
					row.card_id,
				],
			);
		} catch {
			console.error(
				`Failed to insert due_date_reminder for card ${row.card_id}`,
			);
		}
	}
}

export function startDueDateScheduler(): ReturnType<typeof setInterval> {
	return setInterval(() => {
		void runDueDateReminders();
	}, 60_000);
}
