import { type Request, type Response, Router } from "express";
import { db } from "../db/kysely.js";
import { getAttachmentStorage } from "../lib/attachment-storage.js";
import { publishEvent } from "../realtime.js";
import { removeAttachmentPairsBestEffort } from "./card-attachment-cleanup.js";
import {
	attachmentOwnershipGuard,
	createAttachmentOwnershipGuard,
	deliverAttachment,
} from "./card-attachment-delivery.js";
import {
	existingCardMultipartMiddleware,
	uploadExistingCardAttachments,
} from "./card-attachment-upload.js";
import { recordActivity } from "./helpers.js";

export {
	attachmentOwnershipGuard,
	createAttachmentOwnershipGuard,
} from "./card-attachment-delivery.js";
export {
	existingCardMultipartMiddleware,
	setAttachmentCapacityHookForTests,
	setExistingCardAttachmentCapacityHookForTests,
} from "./card-attachment-upload.js";

export const cardAttachmentsRouter = Router({ mergeParams: true });

cardAttachmentsRouter.post(
	"/cards/:cardId/attachments",
	createAttachmentOwnershipGuard({ requireAttachment: false }),
	existingCardMultipartMiddleware,
	(req, res, next) => {
		void uploadExistingCardAttachments(req, res).catch(next);
	},
);

cardAttachmentsRouter.delete(
	"/cards/:cardId/attachments/:attachmentId",
	attachmentOwnershipGuard,
	(req, res, next) => {
		void deleteAttachment(req, res).catch(next);
	},
);

async function deleteAttachment(req: Request, res: Response): Promise<void> {
	const workspaceId = req.workspace?.workspaceId;
	const cardId = Number(req.params.cardId);
	const attachmentId = Number(req.params.attachmentId);
	if (
		workspaceId === undefined ||
		!Number.isInteger(cardId) ||
		!Number.isInteger(attachmentId)
	) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	type DeleteResult =
		| { kind: "not_found" }
		| {
				kind: "ok";
				attachmentId: number;
				mimeType: string;
				createdAt: string;
				columnId: number;
				thumbnailPath: string;
				originalPath: string;
		  };
	const result: DeleteResult = await db.transaction().execute(async (trx) => {
		const card = await trx
			.selectFrom("cards")
			.select(["id", "column_id"])
			.where("id", "=", cardId)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.forUpdate()
			.executeTakeFirst();
		if (!card) return { kind: "not_found" };

		const attachment = await trx
			.selectFrom("attachments")
			.select([
				"id",
				"mime_type",
				"created_at",
				"thumbnail_path",
				"original_path",
			])
			.where("id", "=", attachmentId)
			.where("card_id", "=", card.id)
			.executeTakeFirst();
		if (!attachment) return { kind: "not_found" };

		await trx
			.deleteFrom("attachments")
			.where("id", "=", attachment.id)
			.execute();
		const createdAt =
			attachment.created_at instanceof Date
				? attachment.created_at.toISOString()
				: new Date(attachment.created_at).toISOString();
		await recordActivity(trx, req.user!, workspaceId, "attachment_removed", {
			cardId,
			toColumnId: card.column_id,
			payload: {
				attachmentId: attachment.id,
				mimeType: attachment.mime_type,
				createdAt,
			},
		});
		return {
			kind: "ok",
			attachmentId: attachment.id,
			mimeType: attachment.mime_type,
			createdAt,
			columnId: card.column_id,
			thumbnailPath: attachment.thumbnail_path,
			originalPath: attachment.original_path,
		};
	});

	if (result.kind === "not_found") {
		res.status(404).json({ error: "Not found" });
		return;
	}

	await removeAttachmentPairsBestEffort(getAttachmentStorage(), [
		{
			thumbnailPath: result.thumbnailPath,
			originalPath: result.originalPath,
		},
	]);
	await publishEvent(workspaceId, {
		type: "attachment.removed",
		actor: req.user,
		cardId,
		workspaceId,
		payload: {
			attachmentId: result.attachmentId,
			mimeType: result.mimeType,
			createdAt: result.createdAt,
		},
	});
	res.status(204).end();
}

cardAttachmentsRouter.get(
	"/cards/:cardId/attachments/:attachmentId/thumbnail",
	attachmentOwnershipGuard,
	(req, res, next) => {
		void deliverAttachment(req, res, next, "thumbnail", false);
	},
);
cardAttachmentsRouter.get(
	"/cards/:cardId/attachments/:attachmentId/original/download",
	attachmentOwnershipGuard,
	(req, res, next) => {
		void deliverAttachment(req, res, next, "original", true);
	},
);
cardAttachmentsRouter.get(
	"/cards/:cardId/attachments/:attachmentId/original",
	attachmentOwnershipGuard,
	(req, res, next) => {
		void deliverAttachment(req, res, next, "original", false);
	},
);
