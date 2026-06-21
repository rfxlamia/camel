import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { getHumanColumns } from "./helpers.js";

export const boardRouter = Router({ mergeParams: true });

boardRouter.get("/board", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const columns = await getHumanColumns(pool, workspaceId);
	const cards = await pool.query(
		`SELECT c.id, c.column_id, c.title, c.description, c.position, c.version,
            c.created_at, c.started_at, c.done_at, c.due_date::text AS due_date,
            c.assignee_id, u.username AS assignee_username,
            u.display_name AS assignee_display_name
     FROM cards c
     LEFT JOIN users u ON u.id = c.assignee_id
     WHERE c.workspace_id = $1 AND c.deleted_at IS NULL ORDER BY c.position`,
		[workspaceId],
	);
	res.json({
		columns: columns.map((col) => ({
			id: col.id,
			title: col.title,
			position: col.position,
			wipLimit: col.wip_limit,
			policy: col.policy,
			isDone: col.is_done,
			cards: cards.rows
				.filter((c) => c.column_id === col.id)
				.map((c) => ({
					id: c.id,
					columnId: c.column_id,
					title: c.title,
					description: c.description,
					position: c.position,
					version: c.version,
					createdAt: c.created_at,
					startedAt: c.started_at,
					doneAt: c.done_at,
					dueDate: c.due_date,
					assignee: c.assignee_id
						? {
								id: c.assignee_id,
								username: c.assignee_username,
								displayName: c.assignee_display_name,
							}
						: null,
				})),
		})),
	});
});
