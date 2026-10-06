import { Router } from "express";
import { sql } from "kysely";
import { POSITION_GAP } from "../../core/position.js";
import { db } from "../../db/kysely.js";
import { recordActivity } from "../../lib/helpers.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { publishEvent } from "../../realtime.js";
import { validateColumnBatch } from "../../validators/column.js";
import { sendValidationError } from "../../validators/http.js";
import { RETURNING_COLUMNS } from "./column-returning.js";

export const columnsBatchRouter = Router({ mergeParams: true });

columnsBatchRouter.post(
	"/columns/batch",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const validation = validateColumnBatch(req.body?.columns);
		if (!validation.valid) {
			return sendValidationError(res, { error: validation.error as string });
		}

		const templateName =
			typeof req.body?.templateName === "string" ? req.body.templateName : "";
		const normalized = validation.normalized!;

		try {
			const result = await db.transaction().execute(async (trx) => {
				await trx
					.selectFrom("workspaces")
					.select("id")
					.where("id", "=", workspaceId)
					.forUpdate()
					.execute();

				const countRow = await trx
					.selectFrom("columns")
					.select(sql<number>`count(*)::int`.as("n"))
					.where("workspace_id", "=", workspaceId)
					.executeTakeFirstOrThrow();
				if (countRow.n > 0) {
					return { conflict: true as const };
				}

				const created: Array<{
					id: number;
					title: string;
					position: number;
					wip_limit: number | null;
					policy: string;
					is_done: boolean;
					is_signable: boolean;
					signable_assignee_id: number | null;
					color: string | null;
				}> = [];
				for (let i = 0; i < normalized.length; i++) {
					const col = normalized[i];
					const row = await trx
						.insertInto("columns")
						.values({
							title: col.title,
							position: i * POSITION_GAP,
							workspace_id: workspaceId,
							wip_limit: col.wipLimit,
							policy: col.policy,
							is_done: col.isDone,
							is_signable: false,
							signable_assignee_id: null,
							color: col.color,
						})
						.returning(RETURNING_COLUMNS)
						.executeTakeFirstOrThrow();
					created.push(row);
				}

				await recordActivity(trx, req.user!, workspaceId, "create", {
					payload: {
						templateName,
						columnCount: normalized.length,
					},
				});

				return { conflict: false as const, created };
			});

			if (result.conflict) {
				return res.status(409).json({ error: "workspace already has columns" });
			}

			try {
				await publishEvent(workspaceId, {
					type: "column.created",
					actor: req.user!,
				});
			} catch {
				// best-effort post-commit publish
			}

			res.status(201).json(result.created);
		} catch (err) {
			if (!res.headersSent) {
				return res.status(500).json({ error: "internal server error" });
			}
			throw err;
		}
	},
);
