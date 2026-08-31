import { Router } from "express";
import { sql } from "kysely";
import { POSITION_GAP } from "../core/position.js";
import { buildRemapPlan } from "../core/remap-card-statuses.js";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { type BoardEvent, publishEvent } from "../realtime.js";
import {
	COLUMN_COLOR_VALIDATION_ERROR,
	isValidColumnColor,
	validateColumnBatch,
} from "../validators/column.js";
import { validateColumnName } from "../validators/input-length.js";
import { getHumanColumns, recordActivity } from "./helpers.js";

const RETURNING_COLUMNS = [
	"id",
	"title",
	"position",
	"wip_limit",
	"policy",
	"is_done",
	"is_signable",
	"signable_assignee_id",
	"color",
] as const;

type ColumnRow = {
	id: number;
	title: string;
	position: number;
	wip_limit: number | null;
	policy: string;
	is_done: boolean;
	is_signable: boolean;
	signable_assignee_id: number | null;
	color: string | null;
};

type RemapCardEvent = {
	type: "card.updated";
	cardId: number;
	payload: Record<string, unknown>;
};

type ColumnPatchInput = {
	title?: string;
	wipLimit?: number | null;
	policy?: string;
	isDone?: boolean;
	isSignable?: boolean;
	signableAssigneeId?: number | null;
	hasSignableAssigneeId: boolean;
	color?: string | null;
};

function buildColumnPatchFields(input: ColumnPatchInput) {
	const fields: {
		title?: string;
		wip_limit?: number | null;
		policy?: string;
		is_done?: boolean;
		is_signable?: boolean;
		signable_assignee_id?: number | null;
		color?: string | null;
	} = {};
	if (input.title != null) fields.title = input.title;
	if (input.wipLimit !== undefined) fields.wip_limit = input.wipLimit ?? null;
	if (input.policy != null) fields.policy = input.policy;
	if (input.isDone !== undefined) fields.is_done = input.isDone;
	if (input.isSignable !== undefined) fields.is_signable = input.isSignable;
	if (input.isSignable === false) {
		fields.signable_assignee_id = null;
	} else if (input.hasSignableAssigneeId) {
		fields.signable_assignee_id = input.signableAssigneeId ?? null;
	}
	if (input.color != null) fields.color = input.color;
	return fields;
}

export const columnsRouter = Router({ mergeParams: true });

columnsRouter.post("/columns", requireWorkspaceMember, async (req, res) => {
	const { workspaceId } = req.workspace!;

	const { title } = req.body ?? {};
	const titleValidation = validateColumnName(title ?? "");
	if (!titleValidation.valid) {
		return res.status(400).json({ error: titleValidation.error });
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

columnsRouter.post(
	"/columns/batch",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const validation = validateColumnBatch(req.body?.columns);
		if (!validation.valid) {
			return res.status(400).json({ error: validation.error });
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
		let trimmedTitle: string | undefined;
		if (title !== undefined) {
			const titleValidation = validateColumnName(title);
			if (!titleValidation.valid) {
				return res.status(400).json({ error: titleValidation.error });
			}
			trimmedTitle = titleValidation.trimmed;
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
			const memberCheck = await db
				.selectFrom("workspace_members")
				.select("user_id")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", signableAssigneeId)
				.executeTakeFirst();
			if (!memberCheck) {
				return res.status(400).json({
					error: "signableAssigneeId must be a member of this workspace",
				});
			}
		}

		// Validate color if provided
		if (color !== undefined && !isValidColumnColor(color)) {
			return res.status(400).json({
				error: COLUMN_COLOR_VALIDATION_ERROR,
			});
		}

		const patchFields = buildColumnPatchFields({
			title: trimmedTitle,
			wipLimit,
			policy,
			isDone,
			isSignable,
			signableAssigneeId,
			hasSignableAssigneeId,
			color,
		});

		if (Object.keys(patchFields).length === 0) {
			return res.status(400).json({ error: "no updatable fields provided" });
		}

		// isDone changes must serialize on the workspace row and update the
		// normalized card status in the same transaction as the column geometry.
		if (isDone !== undefined) {
			type RemapResult =
				| { kind: "not_found" }
				| {
						kind: "ok";
						updated: ColumnRow;
						cardEvents: RemapCardEvent[];
				  };

			const result: RemapResult = await db
				.transaction()
				.execute(async (trx) => {
					await trx
						.selectFrom("workspaces")
						.select("id")
						.where("id", "=", workspaceId)
						.forUpdate()
						.executeTakeFirstOrThrow();

					const beforeColumns = await getHumanColumns(trx, workspaceId);
					const exists = beforeColumns.some((column) => column.id === id);
					if (!exists) return { kind: "not_found" };

					if (isDone) {
						await trx
							.updateTable("columns")
							.set({ is_done: false })
							.where("workspace_id", "=", workspaceId)
							.where("board_id", "is", null)
							.where("id", "!=", id)
							.where("is_done", "=", true)
							.execute();
					}

					const updated = await trx
						.updateTable("columns")
						.set({ ...patchFields, is_done: isDone })
						.where("id", "=", id)
						.where("workspace_id", "=", workspaceId)
						.where("board_id", "is", null)
						.returning(RETURNING_COLUMNS)
						.executeTakeFirstOrThrow();

					const afterColumns = await getHumanColumns(trx, workspaceId);
					const cards = await trx
						.selectFrom("cards")
						.select(["id", "column_id", "status_id", "deleted_at"])
						.where("workspace_id", "=", workspaceId)
						.where("deleted_at", "is", null)
						.forUpdate()
						.execute();
					const statuses = await trx
						.selectFrom("tracker_vocabularies")
						.select(["id", "kind", "slot"])
						.where("workspace_id", "=", workspaceId)
						.where("kind", "=", "status")
						.execute();
					const plan = buildRemapPlan({
						beforeColumns,
						afterColumns,
						cards,
						statuses,
					});

					const firstColumnId = afterColumns[0]?.id;
					const cardEvents: RemapCardEvent[] = [];
					for (const remap of plan) {
						const targetIsDone =
							afterColumns.find((column) => column.id === remap.columnId)
								?.is_done ?? false;
						const updatedCard = await trx
							.updateTable("cards")
							.set({
								status_id: remap.statusId,
								version: sql`version + 1`,
								started_at: sql`CASE WHEN started_at IS NULL AND (${targetIsDone} OR ${remap.columnId !== firstColumnId}) THEN now() ELSE started_at END`,
								done_at: sql`CASE WHEN ${targetIsDone} THEN COALESCE(done_at, now()) ELSE NULL END`,
							})
							.where("id", "=", remap.cardId)
							.where("workspace_id", "=", workspaceId)
							.where("deleted_at", "is", null)
							.returning([
								"id",
								"column_id",
								"version",
								"status_id",
								"started_at",
								"done_at",
							])
							.executeTakeFirstOrThrow();

						await recordActivity(trx, req.user!, workspaceId, "update", {
							cardId: updatedCard.id,
							fromColumnId: updatedCard.column_id,
							toColumnId: updatedCard.column_id,
							payload: {
								changed: ["status"],
								statusId: updatedCard.status_id,
							},
						});
						cardEvents.push({
							type: "card.updated",
							cardId: updatedCard.id,
							payload: {
								columnId: updatedCard.column_id,
								statusId: updatedCard.status_id,
								version: updatedCard.version,
								startedAt: updatedCard.started_at?.toISOString() ?? null,
								doneAt: updatedCard.done_at?.toISOString() ?? null,
							},
						});
					}

					await recordActivity(trx, req.user!, workspaceId, "update", {
						payload: {
							columnId: id,
							columnTitle: updated.title,
							isDone,
							isSignable: updated.is_signable,
							signableAssigneeId: updated.signable_assignee_id,
							color: updated.color,
						},
					});

					return { kind: "ok", updated, cardEvents };
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

		const id = Number(req.params.id);
		if (Number.isNaN(id)) {
			return res.status(400).json({ error: "invalid column id" });
		}
		const deleted = await db
			.deleteFrom("columns")
			.where("id", "=", id)
			.where("workspace_id", "=", workspaceId)
			.returning(["title"])
			.executeTakeFirst();
		if (!deleted) return res.status(404).json({ error: "column not found" });
		await recordActivity(db, req.user!, workspaceId, "delete", {
			payload: { columnTitle: deleted.title },
		});
		res.status(204).end();
	},
);
