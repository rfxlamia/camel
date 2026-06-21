import { Router } from "express";
import { POSITION_GAP } from "../core/position.js";
import { pool } from "../db/pool.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { type BoardEvent, publishEvent } from "../realtime.js";
import { validateBoardName } from "../validators/input-length.js";

export const columnsRouter = Router({ mergeParams: true });

columnsRouter.post("/columns", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const { title } = req.body ?? {};
	const titleValidation = validateBoardName(title ?? "");
	if (!titleValidation.valid) {
		return res.status(400).json({ error: titleValidation.error });
	}
	const { rows } = await pool.query(
		`INSERT INTO columns (title, position, workspace_id)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM columns WHERE workspace_id = $2), 0) + $3, $2)
     RETURNING id, title, position, wip_limit, policy, is_done`,
		[titleValidation.trimmed, workspaceId, POSITION_GAP],
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
		const { title, wipLimit, policy, isDone } = req.body ?? {};
		if (wipLimit !== undefined && wipLimit !== null) {
			if (!Number.isInteger(wipLimit) || wipLimit < 1) {
				return res
					.status(400)
					.json({ error: "wipLimit must be a positive integer or null" });
			}
		}
		if (isDone !== undefined && typeof isDone !== "boolean") {
			return res.status(400).json({ error: "isDone must be a boolean" });
		}

		// Enforce single Done column per workspace: unset other columns first
		if (isDone === true) {
			await pool.query(
				"UPDATE columns SET is_done = false WHERE workspace_id = $1 AND id != $2 AND is_done = true",
				[workspaceId, id],
			);
		}

		const { rows } = await pool.query(
			`UPDATE columns SET
			 title = COALESCE($2, title),
			 wip_limit = CASE WHEN $3 THEN $4 ELSE wip_limit END,
			 policy = COALESCE($5, policy),
			 is_done = COALESCE($6, is_done)
		 WHERE id = $1 AND workspace_id = $7
		 RETURNING id, title, position, wip_limit, policy, is_done`,
			[
				id,
				title ?? null,
				wipLimit !== undefined,
				wipLimit ?? null,
				policy ?? null,
				isDone ?? null,
				workspaceId,
			],
		);
		if (rows.length === 0)
			return res.status(404).json({ error: "column not found" });
		await publishEvent(workspaceId, {
			type: "column.updated",
			actor: req.user!,
			payload: {
				columnTitle: rows[0].title,
				...(isDone !== undefined && { isDone }),
			},
		} as BoardEvent);
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
