import { Router } from "express";
import { sql } from "kysely";
import { db } from "../../db/kysely.js";
import {
	getCardAssigneeIds,
	loadCardAssigneesForCards,
	syncCardAssignees,
} from "../../lib/card-assignees.js";
import {
	buildCardResponse,
	type CardResponseRow,
	loadCardLabelsForCards,
} from "../../lib/card-response.js";
import { recordActivity } from "../../lib/helpers.js";
import { parseCardProjectPhase } from "../../lib/tracker-item-parsers.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { loadCardAttachmentsForCards } from "./attachment-response.js";
import { cardIdParam } from "./board-schemas.js";
import {
	emitCardAssigned,
	emitDueDateChange,
	publishCardWorkspaceEvent,
} from "./card-events.js";
import { syncCardLabels } from "./card-labels.js";
import { loadCardResponse, selectFullCard } from "./card-read.js";
import { parseCardUpdateBody } from "./card-update-parse.js";

export const cardsUpdateRouter = Router({ mergeParams: true });

cardsUpdateRouter.patch(
	"/cards/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const body = (req.body ?? {}) as Record<string, unknown>;
		const parsedId = parseWith(cardIdParam, req.params.id);
		if (!parsedId.ok) return sendValidationError(res, parsedId.body);
		const id = parsedId.data;
		const parsedBody = await parseCardUpdateBody(body, workspaceId);
		if ("error" in parsedBody) {
			return sendValidationError(res, { error: parsedBody.error });
		}
		const { version, setFields, assigneeIds, labelIds, flags } = parsedBody;
		const {
			hasTitle,
			hasDescription,
			hasAssigneeIds,
			hasDueDate,
			hasPriorityId,
			hasLabelIds,
			hasProjectPhase,
			hasSets,
		} = flags;

		type TxResult =
			| { kind: "not_found" }
			| { kind: "bad_request"; error: string }
			| { kind: "conflict"; card: ReturnType<typeof buildCardResponse> | null }
			| {
					kind: "ok";
					updated: CardResponseRow;
					prevDueDate: string | null | undefined;
					prevAssigneeIds: number[];
					assigneeSync?: { added: number[] };
			  };

		const result: TxResult = await db.transaction().execute(async (trx) => {
			const lockedRow = await trx
				.selectFrom("cards")
				.select([
					sql<string | null>`due_date::text`.as("due_date"),
					"project_id",
				])
				.where("id", "=", id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.forUpdate()
				.executeTakeFirst();
			if (!lockedRow) {
				return { kind: "not_found" };
			}
			const prevDueDate = lockedRow.due_date;
			const prevAssigneeIds = await getCardAssigneeIds(trx, id);

			const trxSetFields = { ...setFields };
			if (hasProjectPhase) {
				const parsed = await parseCardProjectPhase(
					body,
					workspaceId,
					lockedRow.project_id,
				);
				if ("error" in parsed) {
					return { kind: "bad_request", error: parsed.error };
				}
				if (parsed.projectId !== undefined) {
					trxSetFields.project_id = parsed.projectId;
				}
				if (parsed.phaseId !== undefined) {
					trxSetFields.phase_id = parsed.phaseId;
				}
			}

			let updated: CardResponseRow;
			if (hasSets) {
				const updatedRow = await trx
					.updateTable("cards")
					.set({ ...trxSetFields, version: sql`version + 1` })
					.where("id", "=", id)
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.$if(version !== undefined, (qb) =>
						qb.where("version", "=", version as number),
					)
					.returning([
						"id",
						"column_id",
						"title",
						"description",
						"position",
						"version",
						"created_at",
						"started_at",
						"done_at",
						sql<string | null>`due_date::text`.as("due_date"),
					])
					.executeTakeFirst();

				if (!updatedRow) {
					const current = await selectFullCard(trx)
						.where("c.id", "=", id)
						.where("c.workspace_id", "=", workspaceId)
						.where("c.deleted_at", "is", null)
						.executeTakeFirst();
					if (!current) return { kind: "not_found" };
					return {
						kind: "conflict",
						card: await loadCardResponse(trx, workspaceId, current),
					};
				}
				updated = {
					id: updatedRow.id,
					column_id: updatedRow.column_id,
					title: updatedRow.title,
					description: updatedRow.description,
					position: updatedRow.position,
					version: updatedRow.version,
					created_at: updatedRow.created_at.toISOString(),
					started_at: updatedRow.started_at?.toISOString() ?? null,
					done_at: updatedRow.done_at?.toISOString() ?? null,
					due_date: updatedRow.due_date,
				};
			} else {
				const current = await selectFullCard(trx)
					.where("c.id", "=", id)
					.where("c.workspace_id", "=", workspaceId)
					.where("c.deleted_at", "is", null)
					.executeTakeFirst();
				if (!current) return { kind: "not_found" };
				updated = { ...current };

				const bump = await trx
					.updateTable("cards")
					.set({ version: sql`version + 1` })
					.where("id", "=", id)
					.where("workspace_id", "=", workspaceId)
					.where("deleted_at", "is", null)
					.$if(version !== undefined, (qb) =>
						qb.where("version", "=", version as number),
					)
					.returning("version")
					.executeTakeFirst();
				if (!bump) return { kind: "conflict", card: null };
				updated.version = bump.version;
			}

			let assigneeSync: { added: number[] } | undefined;
			if (hasAssigneeIds && assigneeIds !== undefined) {
				assigneeSync = await syncCardAssignees(trx, id, assigneeIds);
			}

			if (hasLabelIds && labelIds !== undefined) {
				await syncCardLabels(trx, id, labelIds);
			}

			await recordActivity(trx, req.user!, workspaceId, "update", {
				cardId: id,
				payload: {
					cardTitle: updated.title,
					changed: [
						hasTitle && "title",
						hasDescription && "description",
						hasAssigneeIds && "assignees",
						hasDueDate && "dueDate",
						hasPriorityId && "priority",
						hasLabelIds && "labels",
						hasProjectPhase && "project",
						hasProjectPhase && "phase",
					].filter(Boolean),
				},
			});

			return {
				kind: "ok",
				updated,
				prevDueDate,
				prevAssigneeIds,
				assigneeSync,
			};
		});

		if (result.kind === "not_found") {
			return res.status(404).json({ error: "card not found" });
		}
		if (result.kind === "bad_request") {
			return sendValidationError(res, { error: result.error });
		}
		if (result.kind === "conflict") {
			if (result.card) {
				return res.status(409).json({
					error: "Someone else updated this card first.",
					code: "version_conflict",
					card: result.card,
				});
			}
			return res.status(409).json({
				error: "Someone else updated this card first.",
				code: "version_conflict",
			});
		}

		const { updated, prevDueDate, prevAssigneeIds, assigneeSync } = result;

		await publishCardWorkspaceEvent(workspaceId, {
			type: "card.updated",
			actor: req.user!,
			cardId: id,
		});

		const assigneesByCard = await loadCardAssigneesForCards(db, [id]);
		const currentAssigneeIds = (assigneesByCard.get(id) ?? []).map((a) => a.id);

		if (assigneeSync) {
			for (const assigneeId of assigneeSync.added) {
				emitCardAssigned(
					workspaceId,
					req.user!.id,
					id,
					updated.title,
					req.user!.displayName,
					assigneeId,
				);
			}
		}

		if (hasDueDate && updated.due_date !== (prevDueDate ?? null)) {
			emitDueDateChange(
				workspaceId,
				req.user!.id,
				id,
				updated.title,
				req.user!.displayName,
				currentAssigneeIds.length > 0 ? currentAssigneeIds : prevAssigneeIds,
				prevDueDate ?? null,
				updated.due_date,
			);
		}

		const responseRow = await selectFullCard(db)
			.where("c.id", "=", id)
			.where("c.workspace_id", "=", workspaceId)
			.where("c.deleted_at", "is", null)
			.executeTakeFirst();
		if (!responseRow) return res.status(404).json({ error: "card not found" });
		const [labelsByCard, attachmentsByCard] = await Promise.all([
			loadCardLabelsForCards(db, [id]),
			loadCardAttachmentsForCards(db, workspaceId, [id]),
		]);
		res.json(
			buildCardResponse(responseRow, {
				assignees: assigneesByCard.get(id) ?? [],
				labels: labelsByCard.get(id) ?? [],
				attachments: attachmentsByCard.get(id) ?? [],
			}),
		);
	},
);
