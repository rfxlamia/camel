import { Router } from "express";
import {
	attachmentOwnershipGuard,
	createAttachmentOwnershipGuard,
	deliverAttachment,
} from "./card-attachment-delivery.js";
import {
	existingCardMultipartMiddleware,
	uploadExistingCardAttachments,
} from "./card-attachment-upload.js";

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
