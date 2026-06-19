import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { getHumanColumns } from "./helpers.js";

export const boardRouter = Router({ mergeParams: true });

boardRouter.get("/board", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const columns = await getHumanColumns(pool, workspaceId);
	const cards = await pool.query(
		`SELECT id, column_id, title, description, position, version, created_at, started_at, done_at
     FROM cards WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY position`,
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
				})),
		})),
	});
});
