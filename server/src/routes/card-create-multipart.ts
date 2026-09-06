import type { RequestHandler } from "express";
import {
	ATTACHMENT_UPLOAD_PROFILES,
	createAttachmentUpload,
	normalizeAttachmentUploadError,
} from "../lib/attachment-upload.js";

const cardCreateUpload = createAttachmentUpload({
	maxPairs: ATTACHMENT_UPLOAD_PROFILES.cardCreate.maxPairs,
});

/** Parses card-create multipart requests while leaving JSON requests untouched. */
export const cardCreateMultipartMiddleware: RequestHandler = async (
	req,
	res,
	next,
) => {
	if (!req.is("multipart/form-data")) {
		next();
		return;
	}
	try {
		const upload = await cardCreateUpload;
		upload(req, res, (error) => {
			if (!error) {
				next();
				return;
			}
			const normalized = normalizeAttachmentUploadError(error);
			res.status(normalized.status).json(normalized);
		});
	} catch (error) {
		next(error);
	}
};
