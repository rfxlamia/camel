import { Router } from "express";
import { sql } from "kysely";
import { db } from "../../db/kysely.js";
import { domainBus, EVENTS } from "../../events.js";
import {
	type AttachmentPair,
	getAttachmentStorage,
} from "../../lib/attachment-storage.js";
import { recordActivity } from "../../lib/helpers.js";
import { requireWorkspaceMember } from "../../middleware/workspace.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { optionalVersion } from "../../validators/schemas.js";
import { cardIdParam } from "./board-schemas.js";
import { removeAttachmentPairsBestEffort } from "./card-attachment-cleanup.js";
import { publishCardWorkspaceEvent } from "./card-events.js";

export const cardsDeleteRouter = Router({ mergeParams: true });

cardsDeleteRouter.delete(
	"/cards/:id",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;

		const parsedId = parseWith(cardIdParam, req.params.id);
		if (!parsedId.ok) return sendValidationError(res, parsedId.body);
		const id = parsedId.data;
		const parsedVersion = parseWith(optionalVersion, req.body?.version);
		if (!parsedVersion.ok) return sendValidationError(res, parsedVersion.body);
		const version = parsedVersion.data;

		type DeleteResult =
			| { kind: "not_found" }
			| { kind: "conflict" }
			| {
					kind: "ok";
					title: string;
					column_id: number | null;
					attachmentPairs: AttachmentPair[];
			  };

		const result: DeleteResult = await db.transaction().execute(async (trx) => {
			const lockedCard = await trx
				.selectFrom("cards")
				.select(["id", "title", "column_id", "version"])
				.where("id", "=", id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.forUpdate()
				.executeTakeFirst();
			if (!lockedCard) return { kind: "not_found" };
			if (version !== undefined && lockedCard.version !== version) {
				return { kind: "conflict" };
			}

			const attachments = await trx
				.selectFrom("attachments")
				.select(["thumbnail_path", "original_path"])
				.where("card_id", "=", id)
				.execute();
			await trx.deleteFrom("attachments").where("card_id", "=", id).execute();
			const row = await trx
				.updateTable("cards")
				.set({ deleted_at: sql`now()` })
				.where("id", "=", id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.returning(["title", "column_id"])
				.executeTakeFirst();
			if (!row) return { kind: "not_found" };

			await recordActivity(trx, req.user!, workspaceId, "delete", {
				fromColumnId: row.column_id,
				payload: { cardTitle: row.title },
			});
			return {
				kind: "ok",
				title: row.title,
				column_id: row.column_id,
				attachmentPairs: attachments.map(
					({ thumbnail_path, original_path }) => ({
						thumbnailPath: thumbnail_path,
						originalPath: original_path,
					}),
				),
			};
		});

		if (result.kind === "not_found") {
			return res.status(404).json({ error: "card not found" });
		}
		if (result.kind === "conflict") {
			return res.status(409).json({
				error: "Someone else updated this card first.",
				code: "version_conflict",
			});
		}

		await publishCardWorkspaceEvent(workspaceId, {
			type: "card.deleted",
			actor: req.user!,
			cardId: id,
		});
		domainBus.emit(EVENTS.CARD_DELETED, {
			type: EVENTS.CARD_DELETED,
			workspaceId,
			actorId: req.user!.id,
			payload: { cardId: id },
		});
		void removeAttachmentPairsBestEffort(
			getAttachmentStorage(),
			result.attachmentPairs,
		);
		res.status(204).end();
	},
);
