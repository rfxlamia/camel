import { Router } from "express";
import { POSITION_GAP } from "../core/position.js";
import { pool } from "../db/pool.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { type BoardEvent, publishEvent } from "../realtime.js";
import { validateColumnName } from "../validators/input-length.js";
import { recordActivity } from "./helpers.js";

// Valid column color palette names
const COLUMN_COLORS = [
	"powder-blue",
	"pale-sky",
	"light-cyan",
	"frozen-water",
	"turquoise",
] as const;

type ColumnColor = (typeof COLUMN_COLORS)[number];

function isValidColumnColor(value: unknown): value is ColumnColor | null {
	return value === null || COLUMN_COLORS.includes(value as ColumnColor);
}

export const columnsRouter = Router({ mergeParams: true });

columnsRouter.post("/columns", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const { title } = req.body ?? {};
	const titleValidation = validateColumnName(title ?? "");
	if (!titleValidation.valid) {
		return res.status(400).json({ error: titleValidation.error });
	}
	const { rows } = await pool.query(
		`INSERT INTO columns (title, position, workspace_id)
     VALUES ($1, COALESCE((SELECT MAX(position) FROM columns WHERE workspace_id = $2), 0) + $3, $2)
     RETURNING id, title, position, wip_limit, policy, is_done, is_signable, signable_assignee_id, color`,
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
		const {
			title,
			wipLimit,
			policy,
			isDone,
			isSignable,
			signableAssigneeId,
			color,
		} = req.body ?? {};
		const hasSignableAssigneeId = "signableAssigneeId" in (req.body ?? {});

		// Validate title if provided
		if (title !== undefined) {
			const titleValidation = validateColumnName(title);
			if (!titleValidation.valid) {
				return res.status(400).json({ error: titleValidation.error });
			}
		}

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
		if (isSignable !== undefined && typeof isSignable !== "boolean") {
			return res.status(400).json({ error: "isSignable must be a boolean" });
		}
		if (signableAssigneeId !== undefined && signableAssigneeId !== null) {
			if (!Number.isInteger(signableAssigneeId)) {
				return res
					.status(400)
					.json({ error: "signableAssigneeId must be an integer or null" });
			}
			const memberCheck = await pool.query(
				"SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
				[workspaceId, signableAssigneeId],
			);
			if (memberCheck.rows.length === 0) {
				return res.status(400).json({
					error: "signableAssigneeId must be a member of this workspace",
				});
			}
		}

		// Validate color if provided
		if (color !== undefined && !isValidColumnColor(color)) {
			return res.status(400).json({
				error: `color must be one of: ${COLUMN_COLORS.join(", ")}, or null`,
			});
		}

		// Use transaction for isDone enforcement to ensure atomicity
		if (isDone === true) {
			const client = await pool.connect();
			try {
				await client.query("BEGIN");

				// First verify column exists
				const checkRes = await client.query(
					"SELECT id FROM columns WHERE id = $1 AND workspace_id = $2",
					[id, workspaceId],
				);
				if (checkRes.rows.length === 0) {
					await client.query("ROLLBACK");
					return res.status(404).json({ error: "column not found" });
				}

				// Unset other columns
				await client.query(
					"UPDATE columns SET is_done = false WHERE workspace_id = $1 AND id != $2 AND is_done = true",
					[workspaceId, id],
				);

				// Set target column
				const { rows } = await client.query(
					`UPDATE columns SET
					 title = COALESCE($2, title),
					 wip_limit = CASE WHEN $3 THEN $4 ELSE wip_limit END,
					 policy = COALESCE($5, policy),
					 is_done = true,
					 is_signable = COALESCE($7, is_signable),
					 signable_assignee_id = CASE WHEN $7 = false THEN NULL WHEN $9 THEN $8 ELSE signable_assignee_id END,
					 color = COALESCE($10, color)
					 WHERE id = $1 AND workspace_id = $6
					 RETURNING id, title, position, wip_limit, policy, is_done, is_signable, signable_assignee_id, color`,
					[
						id, // $1
						title ?? null, // $2
						wipLimit !== undefined, // $3
						wipLimit ?? null, // $4
						policy ?? null, // $5
						workspaceId, // $6
						isSignable ?? null, // $7
						signableAssigneeId ?? null, // $8
						hasSignableAssigneeId, // $9
						color ?? null, // $10
					],
				);

				await client.query("COMMIT");

				await publishEvent(workspaceId, {
					type: "column.updated",
					actor: req.user!,
					payload: {
						columnTitle: rows[0].title,
						isDone: true,
						isSignable: rows[0].is_signable,
						signableAssigneeId: rows[0].signable_assignee_id,
						color: rows[0].color,
					},
				} as BoardEvent);
				await recordActivity(pool, req.user!, workspaceId, "update", {
					payload: {
						columnId: id,
						columnTitle: rows[0].title,
						isDone: true,
						isSignable: rows[0].is_signable,
						signableAssigneeId: rows[0].signable_assignee_id,
						color: rows[0].color,
					},
				});
				res.json(rows[0]);
			} catch (err) {
				await client.query("ROLLBACK");
				throw err;
			} finally {
				client.release();
			}
			return;
		}

		const { rows } = await pool.query(
			`UPDATE columns SET
			 title = COALESCE($2, title),
			 wip_limit = CASE WHEN $3 THEN $4 ELSE wip_limit END,
			 policy = COALESCE($5, policy),
			 is_done = COALESCE($6, is_done),
			 is_signable = COALESCE($8, is_signable),
			 signable_assignee_id = CASE WHEN $8 = false THEN NULL WHEN $10 THEN $9 ELSE signable_assignee_id END,
			 color = COALESCE($11, color)
		 WHERE id = $1 AND workspace_id = $7
		 RETURNING id, title, position, wip_limit, policy, is_done, is_signable, signable_assignee_id, color`,
			[
				id, // $1
				title ?? null, // $2
				wipLimit !== undefined, // $3
				wipLimit ?? null, // $4
				policy ?? null, // $5
				isDone ?? null, // $6
				workspaceId, // $7
				isSignable ?? null, // $8
				signableAssigneeId ?? null, // $9
				hasSignableAssigneeId, // $10
				color ?? null, // $11
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
				isSignable: rows[0].is_signable,
				signableAssigneeId: rows[0].signable_assignee_id,
				color: rows[0].color,
			},
		} as BoardEvent);
		await recordActivity(pool, req.user!, workspaceId, "update", {
			payload: {
				columnId: id,
				columnTitle: rows[0].title,
				...(isDone !== undefined && { isDone }),
				isSignable: rows[0].is_signable,
				signableAssigneeId: rows[0].signable_assignee_id,
				color: rows[0].color,
			},
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
