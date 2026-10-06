import { Router } from "express";
import { sql } from "kysely";
import { POSITION_GAP } from "../../core/position.js";
import { db } from "../../db/kysely.js";
import { recordActivity } from "../../lib/helpers.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { type BoardEvent, publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { validateColumnName } from "../../validators/input-length.js";
import { columnIdParam } from "./board-schemas.js";
import {
	deleteColumnWithStatusRemap,
	updateColumnWithIsDoneRemap,
} from "./column-is-done-remap.js";
import { parseColumnPatch } from "./column-patch-parse.js";
import { RETURNING_COLUMNS } from "./column-returning.js";
import { columnsBatchRouter } from "./columns-batch.js";

export const columnsRouter = Router({ mergeParams: true });
columnsRouter.use(columnsBatchRouter);

columnsRouter.post("/columns", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const { title } = req.body ?? {};
	const titleValidation = validateColumnName(title ?? "");
	if (!titleValidation.valid) {
		return sendValidationError(res, { error: titleValidation.error as string });
	}
	const created = await db
		.insertInto("columns")
		.values({
			title: titleValidation.trimmed as string,
			workspace_id: workspaceId,
			position: sql<number>`COALESCE((SELECT MAX(position) FROM columns WHERE workspace_id = ${workspaceId}), 0) + ${POSITION_GAP}`,
		})
		.returning(RETURNING_COLUMNS)
		.executeTakeFirstOrThrow();
	await publishEvent(workspaceId, {
		type: "column.created",
		actor: req.user!,
	});
	await recordActivity(db, req.user!, workspaceId, "create", {
		payload: { columnTitle: created.title },
	});
	res.status(201).json(created);
});

columnsRouter.patch(
	"/columns/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const parsedId = parseWith(columnIdParam, req.params.id);
		if (!parsedId.ok) return sendValidationError(res, parsedId.body);
		const id = parsedId.data;

		const parsedPatch = await parseColumnPatch(req.body, workspaceId);
		if ("error" in parsedPatch) {
			return sendValidationError(res, { error: parsedPatch.error });
		}
		const { patchFields, isDone } = parsedPatch;

		// isDone changes must serialize on the workspace row and update the
		// normalized card status in the same transaction as the column geometry.
		if (isDone !== undefined) {
			const result = await updateColumnWithIsDoneRemap({
				workspaceId,
				columnId: id,
				isDone,
				patchFields,
				actor: req.user!,
			});

			if (result.kind === "not_found") {
				return res.status(404).json({ error: "column not found" });
			}

			for (const event of result.cardEvents) {
				await publishEvent(workspaceId, { ...event, actor: req.user! });
			}
			await publishEvent(workspaceId, {
				type: "column.updated",
				actor: req.user!,
				payload: {
					columnTitle: result.updated.title,
					isDone: result.updated.is_done,
					isSignable: result.updated.is_signable,
					signableAssigneeId: result.updated.signable_assignee_id,
					color: result.updated.color,
				},
			} as BoardEvent);
			res.json(result.updated);
			return;
		}

		const updated = await db
			.updateTable("columns")
			.set(patchFields)
			.where("id", "=", id)
			.where("workspace_id", "=", workspaceId)
			.returning(RETURNING_COLUMNS)
			.executeTakeFirst();
		if (!updated) return res.status(404).json({ error: "column not found" });
		await publishEvent(workspaceId, {
			type: "column.updated",
			actor: req.user!,
			payload: {
				columnTitle: updated.title,
				...(isDone !== undefined && { isDone }),
				isSignable: updated.is_signable,
				signableAssigneeId: updated.signable_assignee_id,
				color: updated.color,
			},
		} as BoardEvent);
		await recordActivity(db, req.user!, workspaceId, "update", {
			payload: {
				columnId: id,
				columnTitle: updated.title,
				...(isDone !== undefined && { isDone }),
				isSignable: updated.is_signable,
				signableAssigneeId: updated.signable_assignee_id,
				color: updated.color,
			},
		});
		res.json(updated);
	},
);

columnsRouter.delete(
	"/columns/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const parsedId = parseWith(columnIdParam, req.params.id);
		if (!parsedId.ok) return sendValidationError(res, parsedId.body);
		const id = parsedId.data;
		const result = await deleteColumnWithStatusRemap({
			workspaceId,
			columnId: id,
			actor: req.user!,
		});
		if (result.kind === "not_found") {
			return res.status(404).json({ error: "column not found" });
		}
		for (const event of result.cardEvents) {
			await publishEvent(workspaceId, { ...event, actor: req.user! });
		}
		await publishEvent(workspaceId, {
			type: "column.deleted",
			actor: req.user!,
			payload: { columnTitle: result.deletedTitle },
		} as BoardEvent);
		res.status(204).end();
	},
);
