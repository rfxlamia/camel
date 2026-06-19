import { Router } from "express";
import { POSITION_GAP } from "../core/position.js";
import { pool } from "../db/pool.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";

export const columnsRouter = Router({ mergeParams: true });

columnsRouter.post("/columns", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const { title } = req.body ?? {};
	if (typeof title !== "string" || title.trim() === "") {
		return res.status(400).json({ error: "title is required" });
	}
	const { rows } = await pool.query(
		`INSERT INTO columns (title, position, workspace_id)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM columns WHERE workspace_id = $2), 0) + $3, $2)
     RETURNING id, title, position, wip_limit, policy, is_done`,
		[title.trim(), workspaceId, POSITION_GAP],
	);
	await publishEvent(workspaceId, {
		type: "column.created",
		actor: req.user!,
	});
	res.status(201).json(rows[0]);
});

columnsRouter.patch(
	"/columns/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const id = Number(req.params.id);
		if (Number.isNaN(id)) {
			return res.status(400).json({ error: "invalid column id" });
		}
		const { title, wipLimit, policy } = req.body ?? {};
		if (wipLimit !== undefined && wipLimit !== null) {
			if (!Number.isInteger(wipLimit) || wipLimit < 1) {
				return res
					.status(400)
					.json({ error: "wipLimit must be a positive integer or null" });
			}
		}
		const { rows } = await pool.query(
			`UPDATE columns SET
       title = COALESCE($2, title),
       wip_limit = CASE WHEN $3 THEN $4 ELSE wip_limit END,
       policy = COALESCE($5, policy)
     WHERE id = $1 AND workspace_id = $6
     RETURNING id, title, position, wip_limit, policy, is_done`,
			[
				id,
				title ?? null,
				wipLimit !== undefined,
				wipLimit ?? null,
				policy ?? null,
				workspaceId,
			],
		);
		if (rows.length === 0)
			return res.status(404).json({ error: "column not found" });
		await publishEvent(workspaceId, {
			type: "column.updated",
			actor: req.user!,
		});
		res.json(rows[0]);
	},
);

columnsRouter.delete(
	"/columns/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const id = Number(req.params.id);
		if (Number.isNaN(id)) {
			return res.status(400).json({ error: "invalid column id" });
		}
		const { rowCount } = await pool.query(
			"DELETE FROM columns WHERE id = $1 AND workspace_id = $2",
			[id, workspaceId],
		);
		if (rowCount === 0)
			return res.status(404).json({ error: "column not found" });
		res.status(204).end();
	},
);
