import { Router } from "express";
import { sql } from "kysely";
import {
	mapColumnSlots,
	statusIdForSlot,
} from "../../core/column-status-map.js";
import {
	neighborsAt,
	positionBetween,
	rebalance,
} from "../../core/position.js";
import { checkWipLimit } from "../../core/wip.js";
import { db } from "../../db/kysely.js";
import { addCardAssignee } from "../../lib/card-assignees.js";
import { recordActivity } from "../../lib/helpers.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { optionalVersion } from "../../validators/schemas.js";
import { emitCardAssigned, publishCardWorkspaceEvent } from "./card-events.js";
import { batchUpdateCardPositions } from "./card-positions.js";
import { hydrateCard } from "./card-read.js";

export const cardsMoveRouter = Router({ mergeParams: true });

// ---- Move (the WIP-enforced core flow) --------------------------------------

cardsMoveRouter.post(
	"/cards/:id/move",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const cardId = Number(req.params.id);
		if (Number.isNaN(cardId)) {
			return res.status(400).json({ error: "invalid card id" });
		}
		const { toColumnId, index, statusId } = req.body ?? {};
		if (statusId !== undefined) {
			return res
				.status(400)
				.json({ error: "statusId is not accepted for card moves" });
		}
		if (
			!Number.isInteger(toColumnId) ||
			!Number.isInteger(index) ||
			index < 0
		) {
			return res
				.status(400)
				.json({ error: "toColumnId and index are required" });
		}
		const parsedVersion = parseWith(optionalVersion, req.body?.version);
		if (!parsedVersion.ok) return sendValidationError(res, parsedVersion.body);
		const version = parsedVersion.data;

		type MoveResult =
			| { kind: "not_found_card" }
			| { kind: "conflict" }
			| { kind: "not_found_column" }
			| { kind: "wip"; reason?: string }
			| {
					kind: "ok";
					isSameColumn: boolean;
					cardTitle: string;
					addedSignableAssignee: number | null;
			  };

		const result: MoveResult = await db.transaction().execute(async (trx) => {
			const card = await trx
				.selectFrom("cards")
				.select([
					"id",
					"column_id",
					"title",
					"version",
					"started_at",
					"done_at",
				])
				.where("id", "=", cardId)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.forUpdate()
				.executeTakeFirst();
			if (!card) return { kind: "not_found_card" };

			if (version !== undefined && card.version !== version) {
				return { kind: "conflict" };
			}

			const target = await trx
				.selectFrom("columns")
				.select([
					"id",
					"board_id",
					"wip_limit",
					"is_done",
					"is_signable",
					"signable_assignee_id",
					sql<boolean>`(position = (SELECT MIN(position) FROM columns WHERE workspace_id = ${workspaceId}))`.as(
						"is_first",
					),
				])
				.where("id", "=", toColumnId)
				.where("workspace_id", "=", workspaceId)
				.forUpdate()
				.executeTakeFirst();
			if (!target) return { kind: "not_found_column" };

			const isSameColumn = card.column_id === toColumnId;

			let destinationStatusId: number | undefined;
			if (!isSameColumn) {
				const siblingColumns = await trx
					.selectFrom("columns")
					.select(["id", "position", "is_done"])
					.where("workspace_id", "=", workspaceId)
					.where(sql<boolean>`board_id IS NOT DISTINCT FROM ${target.board_id}`)
					.orderBy("position")
					.orderBy("id")
					.execute();

				const slot = mapColumnSlots(siblingColumns).get(toColumnId);
				if (!slot) {
					throw new Error(
						"Destination column is not in the workspace board geometry",
					);
				}

				const statusRows = await trx
					.selectFrom("tracker_vocabularies")
					.select(["id", "kind", "slot"])
					.where("workspace_id", "=", workspaceId)
					.where("kind", "=", "status")
					.execute();
				const resolvedStatusId = statusIdForSlot(statusRows, slot);
				if (resolvedStatusId === null) {
					throw new Error(`Status vocabulary missing for slot: ${slot}`);
				}
				destinationStatusId = resolvedStatusId;
			}

			const siblings = await trx
				.selectFrom("cards")
				.select(["id", "position"])
				.where("column_id", "=", toColumnId)
				.where("workspace_id", "=", workspaceId)
				.where("id", "<>", cardId)
				.where("deleted_at", "is", null)
				.orderBy("position")
				.orderBy("id")
				.forUpdate()
				.execute();

			const wip = checkWipLimit({
				currentCount: siblings.length,
				wipLimit: target.wip_limit,
				isSameColumn,
			});
			if (!wip.allowed) return { kind: "wip", reason: wip.reason };

			let position: number;
			try {
				const { before, after } = neighborsAt(
					siblings.map((s) => Number(s.position)),
					index,
				);
				position = positionBetween(before, after);
			} catch {
				const fresh = rebalance(siblings.length);
				await batchUpdateCardPositions(
					trx,
					workspaceId,
					toColumnId,
					siblings.map((sibling, i) => ({
						id: sibling.id,
						position: fresh[i],
					})),
				);
				const { before, after } = neighborsAt(fresh, index);
				position = positionBetween(before, after);
			}

			await trx
				.updateTable("cards")
				.set({
					column_id: toColumnId,
					position,
					version: sql`version + 1`,
					...(destinationStatusId !== undefined
						? { status_id: destinationStatusId }
						: {}),
					started_at: sql`CASE WHEN started_at IS NULL AND (${target.is_done} OR NOT ${target.is_first}) THEN now() ELSE started_at END`,
					done_at: sql`CASE WHEN ${target.is_done} THEN COALESCE(done_at, now()) ELSE NULL END`,
				})
				.where("id", "=", cardId)
				.execute();

			let addedSignableAssignee: number | null = null;
			if (
				target.is_signable &&
				target.signable_assignee_id != null &&
				!isSameColumn
			) {
				const added = await addCardAssignee(
					trx,
					cardId,
					target.signable_assignee_id,
				);
				if (added) {
					addedSignableAssignee = target.signable_assignee_id;
				}
			}

			await recordActivity(
				trx,
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

			return {
				kind: "ok",
				isSameColumn,
				cardTitle: card.title,
				addedSignableAssignee,
			};
		});

		if (result.kind === "not_found_card") {
			return res.status(404).json({ error: "card not found" });
		}
		if (result.kind === "conflict") {
			return res.status(409).json({
				error: "Someone else moved this card first.",
				code: "version_conflict",
			});
		}
		if (result.kind === "not_found_column") {
			return res.status(404).json({ error: "column not found" });
		}
		if (result.kind === "wip") {
			return res.status(409).json({
				error: "WIP limit reached for this column",
				reason: result.reason,
			});
		}

		await publishCardWorkspaceEvent(workspaceId, {
			type: result.isSameColumn ? "card.reordered" : "card.moved",
			actor: req.user!,
			cardId,
		});

		if (result.addedSignableAssignee !== null) {
			emitCardAssigned(
				workspaceId,
				req.user!.id,
				cardId,
				result.cardTitle,
				req.user!.displayName,
				result.addedSignableAssignee,
			);
		}

		const cardResponse = await hydrateCard(cardId, workspaceId);
		res.json(cardResponse);
	},
);
