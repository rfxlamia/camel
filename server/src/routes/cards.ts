import { Router } from "express";
import {
	neighborsAt,
	POSITION_GAP,
	positionBetween,
	rebalance,
} from "../core/position.js";
import { checkWipLimit } from "../core/wip.js";
import { pool } from "../db/pool.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import {
	validateCardDescription,
	validateCardTitle,
	validateDueDate,
} from "../validators/input-length.js";
import {
	createScopedBoardService,
	lookupMembership,
	parseWorkspaceId,
	recordActivity,
} from "./helpers.js";

export const cardsRouter = Router({ mergeParams: true });

cardsRouter.get("/cards/:id", async (req, res) => {
	const workspaceId = parseWorkspaceId(
		(req.params as { workspaceId: string; id: string }).workspaceId,
	);
	if (workspaceId === null) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const cardId = Number(req.params.id);
	if (Number.isNaN(cardId)) {
		return res.status(400).json({ error: "invalid card id" });
	}
	const result = await createScopedBoardService({
		getMembership: async (wsId, userId) => {
			const r = await lookupMembership(userId, wsId);
			return r ? { role: r } : null;
		},
		getCardById: async (wsId, cId) => {
			const { rows } = await pool.query(
				`SELECT c.id, c.workspace_id, c.column_id, c.title, c.description,
                c.position, c.version, c.created_at, c.started_at, c.done_at,
                c.due_date::text AS due_date, c.assignee_id,
                u.username AS assignee_username,
                u.display_name AS assignee_display_name
         FROM cards c
         LEFT JOIN users u ON u.id = c.assignee_id
         WHERE c.id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL`,
				[cId, wsId],
			);
			if (rows.length === 0) return null;
			const c = rows[0];
			return {
				id: c.id,
				workspaceId: c.workspace_id,
				title: c.title,
				columnId: c.column_id,
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
			};
		},
		getBoardRows: async () => [],
		getActivityRows: async () => [],
	}).getCard({ userId: req.user!.id, workspaceId, cardId });

	if ("status" in result) {
		return res.status(result.status).json({ error: result.error });
	}
	res.json(result);
});

cardsRouter.post("/cards", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const { columnId, title, description } = req.body ?? {};
	const titleValidation = validateCardTitle(title ?? "");
	if (!titleValidation.valid) {
		return res.status(400).json({ error: titleValidation.error });
	}
	const descValidation = validateCardDescription(description ?? "");
	if (!descValidation.valid) {
		return res.status(400).json({ error: descValidation.error });
	}
	const col = await pool.query(
		"SELECT id, wip_limit, is_signable, signable_assignee_id FROM columns WHERE id = $1 AND workspace_id = $2",
		[Number(columnId), workspaceId],
	);
	if (col.rows.length === 0) {
		return res.status(404).json({ error: "column not found" });
	}
	const count = await pool.query(
		"SELECT COUNT(*)::int AS n FROM cards WHERE column_id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
		[Number(columnId), workspaceId],
	);
	const wip = checkWipLimit({
		currentCount: count.rows[0].n,
		wipLimit: col.rows[0].wip_limit,
		isSameColumn: false,
	});
	if (!wip.allowed) {
		return res.status(409).json({ error: "WIP limit reached for this column" });
	}
	const autoAssigneeId =
		col.rows[0].is_signable && col.rows[0].signable_assignee_id
			? col.rows[0].signable_assignee_id
			: null;
	const { rows } = await pool.query(
		`INSERT INTO cards (column_id, title, description, position, workspace_id, assignee_id)
     VALUES ($1, $2, $3,
             COALESCE((SELECT MAX(position) FROM cards WHERE column_id = $1), 0) + $4,
             $5, $6)
     RETURNING id`,
		[
			Number(columnId),
			titleValidation.trimmed,
			descValidation.trimmed ?? "",
			POSITION_GAP,
			workspaceId,
			autoAssigneeId,
		],
	);
	await recordActivity(pool, req.user!, workspaceId, "create", {
		cardId: rows[0].id,
		toColumnId: Number(columnId),
		payload: { cardTitle: titleValidation.trimmed },
	});
	await publishEvent(workspaceId, {
		type: "card.created",
		actor: req.user!,
		cardId: rows[0].id,
	});
	// Re-query with users join to include assignee details
	const { rows: cardRows } = await pool.query(
		`SELECT c.id, c.column_id, c.title, c.description, c.position, c.version,
		        c.created_at, c.started_at, c.done_at, c.assignee_id,
		        u.username AS assignee_username, u.display_name AS assignee_display_name
		 FROM cards c
		 LEFT JOIN users u ON u.id = c.assignee_id
		 WHERE c.id = $1 AND c.workspace_id = $2`,
		[rows[0].id, workspaceId],
	);
	const card = cardRows[0];
	res.status(201).json({
		id: card.id,
		columnId: card.column_id,
		title: card.title,
		description: card.description,
		position: card.position,
		version: card.version,
		createdAt: card.created_at,
		startedAt: card.started_at,
		doneAt: card.done_at,
		assignee: card.assignee_id
			? {
					id: card.assignee_id,
					username: card.assignee_username,
					displayName: card.assignee_display_name,
				}
			: null,
	});
});

cardsRouter.patch("/cards/:id", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const body = (req.body ?? {}) as Record<string, unknown>;
	const { title, description, version } = body;
	const id = Number(req.params.id);
	if (Number.isNaN(id)) {
		return res.status(400).json({ error: "invalid card id" });
	}
	if (version !== undefined && !Number.isInteger(version)) {
		return res.status(400).json({ error: "version must be an integer" });
	}

	// Presence (not null) decides whether a field is touched: an explicit null
	// clears a nullable column, an absent key leaves it untouched. COALESCE
	// can't express "clear", so the SET clause is built from present keys only.
	const hasTitle = "title" in body;
	const hasDescription = "description" in body;
	const hasAssignee = "assigneeId" in body;
	const hasDueDate = "dueDate" in body;

	const sets: string[] = [];
	const vals: unknown[] = [];

	if (hasTitle) {
		const v = validateCardTitle(title as string);
		if (!v.valid) return res.status(400).json({ error: v.error });
		vals.push(v.trimmed);
		sets.push(`title = $${vals.length}`);
	}
	if (hasDescription) {
		const v = validateCardDescription(description as string);
		if (!v.valid) return res.status(400).json({ error: v.error });
		vals.push(v.trimmed);
		sets.push(`description = $${vals.length}`);
	}
	if (hasAssignee) {
		const assigneeId = body.assigneeId;
		if (assigneeId === null) {
			vals.push(null);
			sets.push(`assignee_id = $${vals.length}`);
		} else if (Number.isInteger(assigneeId)) {
			const role = await lookupMembership(assigneeId as number, workspaceId);
			if (!role) {
				return res
					.status(400)
					.json({ error: "assignee must be a member of this workspace" });
			}
			vals.push(assigneeId);
			sets.push(`assignee_id = $${vals.length}`);
		} else {
			return res
				.status(400)
				.json({ error: "assigneeId must be an integer or null" });
		}
	}
	if (hasDueDate) {
		const dueDate = body.dueDate;
		if (dueDate === null) {
			vals.push(null);
			sets.push(`due_date = $${vals.length}`);
		} else {
			const v = validateDueDate(dueDate as string);
			if (!v.valid) return res.status(400).json({ error: v.error });
			vals.push(v.trimmed);
			sets.push(`due_date = $${vals.length}`);
		}
	}

	if (sets.length === 0) {
		return res.status(400).json({ error: "no updatable fields provided" });
	}
	sets.push("version = version + 1");

	vals.push(id);
	const idP = vals.length;
	vals.push(workspaceId);
	const wsP = vals.length;
	vals.push(version ?? null);
	const verP = vals.length;

	const { rows } = await pool.query(
		`UPDATE cards SET ${sets.join(", ")}
     WHERE id = $${idP} AND workspace_id = $${wsP} AND deleted_at IS NULL
       AND ($${verP}::int IS NULL OR version = $${verP})
     RETURNING id, column_id, title, description, position, version,
               created_at, started_at, done_at, due_date::text AS due_date, assignee_id`,
		vals,
	);
	if (rows.length === 0) {
		const current = await pool.query(
			`SELECT id, column_id, title, description, position, version,
              created_at, started_at, done_at, due_date::text AS due_date, assignee_id
       FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
			[id, workspaceId],
		);
		if (current.rows.length === 0) {
			return res.status(404).json({ error: "card not found" });
		}
		return res.status(409).json({
			error: "Someone else updated this card first.",
			code: "version_conflict",
			card: current.rows[0],
		});
	}
	await recordActivity(pool, req.user!, workspaceId, "update", {
		cardId: id,
		payload: {
			cardTitle: rows[0].title,
			changed: [
				hasTitle && "title",
				hasDescription && "description",
				hasAssignee && "assignee",
				hasDueDate && "dueDate",
			].filter(Boolean),
		},
	});
	await publishEvent(workspaceId, {
		type: "card.updated",
		actor: req.user!,
		cardId: id,
	});
	res.json(rows[0]);
});

cardsRouter.delete("/cards/:id", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const id = Number(req.params.id);
	if (Number.isNaN(id)) {
		return res.status(400).json({ error: "invalid card id" });
	}
	const { rows } = await pool.query(
		"UPDATE cards SET deleted_at = now() WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL RETURNING title, column_id",
		[id, workspaceId],
	);
	if (rows.length === 0)
		return res.status(404).json({ error: "card not found" });
	await recordActivity(pool, req.user!, workspaceId, "delete", {
		fromColumnId: rows[0].column_id,
		payload: { cardTitle: rows[0].title },
	});
	await publishEvent(workspaceId, {
		type: "card.deleted",
		actor: req.user!,
		cardId: id,
	});
	res.status(204).end();
});

// ---- Move (the WIP-enforced core flow) --------------------------------------

cardsRouter.post(
	"/cards/:id/move",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const cardId = Number(req.params.id);
		if (Number.isNaN(cardId)) {
			return res.status(400).json({ error: "invalid card id" });
		}
		const { toColumnId, index, version } = req.body ?? {};
		if (
			!Number.isInteger(toColumnId) ||
			!Number.isInteger(index) ||
			index < 0
		) {
			return res
				.status(400)
				.json({ error: "toColumnId and index are required" });
		}
		if (version !== undefined && !Number.isInteger(version)) {
			return res.status(400).json({ error: "version must be an integer" });
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const cardRes = await client.query(
				"SELECT id, column_id, title, version, started_at, done_at FROM cards WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL FOR UPDATE",
				[cardId, workspaceId],
			);
			if (cardRes.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "card not found" });
			}
			const card = cardRes.rows[0];

			if (version !== undefined && card.version !== version) {
				await client.query("ROLLBACK");
				return res.status(409).json({
					error: "Someone else moved this card first.",
					code: "version_conflict",
				});
			}

			const colRes = await client.query(
				`SELECT id, wip_limit, is_done, is_signable, signable_assignee_id,
              (position = (SELECT MIN(position) FROM columns WHERE workspace_id = $2)) AS is_first
       FROM columns WHERE id = $1 AND workspace_id = $2`,
				[toColumnId, workspaceId],
			);
			if (colRes.rows.length === 0) {
				await client.query("ROLLBACK");
				return res.status(404).json({ error: "column not found" });
			}
			const target = colRes.rows[0];
			const isSameColumn = card.column_id === toColumnId;

			const siblingsRes = await client.query(
				`SELECT id, position FROM cards
       WHERE column_id = $1 AND workspace_id = $2 AND id <> $3 AND deleted_at IS NULL
       ORDER BY position FOR UPDATE`,
				[toColumnId, workspaceId, cardId],
			);
			const siblings = siblingsRes.rows;

			const wip = checkWipLimit({
				currentCount: siblings.length,
				wipLimit: target.wip_limit,
				isSameColumn,
			});
			if (!wip.allowed) {
				await client.query("ROLLBACK");
				return res.status(409).json({
					error: "WIP limit reached for this column",
					reason: wip.reason,
				});
			}

			let position: number;
			try {
				const { before, after } = neighborsAt(
					siblings.map((s) => Number(s.position)),
					index,
				);
				position = positionBetween(before, after);
			} catch {
				const fresh = rebalance(siblings.length);
				for (let i = 0; i < siblings.length; i++) {
					await client.query("UPDATE cards SET position = $2 WHERE id = $1", [
						siblings[i].id,
						fresh[i],
					]);
				}
				const { before, after } = neighborsAt(fresh, index);
				position = positionBetween(before, after);
			}

			await client.query(
				`UPDATE cards SET
			     column_id = $2,
			     position = $3,
			     version = version + 1,
			     started_at = CASE
			       WHEN started_at IS NULL AND ($4 OR NOT $5) THEN now()
			       ELSE started_at
			     END,
			     done_at = CASE WHEN $4 THEN COALESCE(done_at, now()) ELSE NULL END,
			 assignee_id = CASE WHEN $6 AND $7::integer IS NOT NULL AND NOT $8 THEN $7::integer ELSE assignee_id END
			   WHERE id = $1`,
				[
					cardId,
					toColumnId,
					position,
					target.is_done,
					target.is_first,
					target.is_signable,
					target.signable_assignee_id,
					isSameColumn,
				],
			);

			await recordActivity(
				client,
				req.user!,
				workspaceId,
				isSameColumn ? "reorder" : "move",
				{
					cardId,
					fromColumnId: card.column_id,
					toColumnId,
					payload: { cardTitle: card.title },
				},
			);

			await client.query("COMMIT");

			await publishEvent(workspaceId, {
				type: isSameColumn ? "card.reordered" : "card.moved",
				actor: req.user!,
				cardId,
			});

			const updated = await pool.query(
				`SELECT c.id, c.column_id, c.title, c.description, c.position, c.version,
			       c.created_at, c.started_at, c.done_at, c.due_date::text AS due_date,
			       c.assignee_id, u.username AS assignee_username,
			       u.display_name AS assignee_display_name
			 FROM cards c
			 LEFT JOIN users u ON u.id = c.assignee_id
			 WHERE c.id = $1 AND c.workspace_id = $2 AND c.deleted_at IS NULL`,
				[cardId, workspaceId],
			);
			const c = updated.rows[0];
			res.json({
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
			});
		} catch (err) {
			await client.query("ROLLBACK");
			throw err;
		} finally {
			client.release();
		}
	},
);
