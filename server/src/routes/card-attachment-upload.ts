import type { Request, RequestHandler, Response } from "express";
import type { AuthUser } from "../auth.js";
import { getAttachmentStorage } from "../lib/attachment-storage.js";
import {
	ATTACHMENT_UPLOAD_PROFILES,
	createAttachmentUpload,
	normalizeAttachmentUploadError,
} from "../lib/attachment-upload.js";
import { validateAttachmentPairs } from "../lib/attachment-validation.js";
import { publishEvent } from "../realtime.js";
import { mapAttachmentResponse } from "./attachment-response.js";
import {
	EXISTING_CARD_ATTACHMENT_CAPACITY_MESSAGE,
	EXISTING_CARD_ATTACHMENT_LIMIT,
	type PreparedAttachment,
	runExistingCardUploadTransaction,
	type StoredAttachment,
	type WrittenAttachment,
} from "./card-attachment-persistence.js";

export {
	setAttachmentCapacityHookForTests,
	setExistingCardAttachmentCapacityHookForTests,
} from "./card-attachment-persistence.js";

const existingCardUpload = createAttachmentUpload({
	maxPairs: ATTACHMENT_UPLOAD_PROFILES.existingCard.maxPairs,
});

export const existingCardMultipartMiddleware: RequestHandler = async (
	req,
	res,
	next,
) => {
	if (!req.is("multipart/form-data")) {
		next();
		return;
	}
	try {
		(await existingCardUpload)(req, res, (error) => {
			if (!error) {
				next();
				return;
			}
			const normalized = normalizeAttachmentUploadError(error);
			res.status(normalized.status).json({
				error: normalized.error,
				code: normalized.code,
			});
		});
	} catch (error) {
		next(error);
	}
};

const PARTIAL_UPLOAD_MESSAGE = (accepted: number, requested: number) =>
	`${accepted} of ${requested} images added — card limit is ${EXISTING_CARD_ATTACHMENT_LIMIT} images`;

type UploadedFile = Express.Multer.File;

function parsePositiveInteger(value: string | undefined): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseUploadedAttachments(req: Request): {
	attachments?: PreparedAttachment[];
	error?: string;
} {
	const files = (req.files ?? {}) as Record<string, UploadedFile[]>;
	const thumbnails = files.thumbnail ?? [];
	const originals = files.original ?? [];
	if (thumbnails.length !== originals.length) {
		return { error: "thumbnail and original attachment counts must match" };
	}
	if (thumbnails.length === 0)
		return { error: "At least one image is required" };
	return {
		attachments: thumbnails.map((thumbnail, index) => ({
			thumbnail,
			original: originals[index]!,
			mimeType: originals[index]!.mimetype,
		})),
	};
}

function isCapacityError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"capacity" in error &&
		error.capacity === true
	);
}

function statusCode(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("statusCode" in error)) {
		return undefined;
	}
	return typeof error.statusCode === "number" ? error.statusCode : undefined;
}

function sendExistingCardUploadError(
	res: Response,
	error: unknown,
): Response<{ error: string }> {
	if (isCapacityError(error)) {
		return res.status(409).json({
			error: EXISTING_CARD_ATTACHMENT_CAPACITY_MESSAGE,
		});
	}
	if (statusCode(error) === 404)
		return res.status(404).json({ error: "Not found" });
	console.error("Failed to add card attachments", error);
	return res.status(500).json({ error: "Unable to add card attachments" });
}

async function publishExistingAttachments(
	workspaceId: number,
	actor: AuthUser,
	cardId: number,
	attachments: StoredAttachment[],
): Promise<void> {
	for (const attachment of attachments) {
		try {
			await publishEvent(workspaceId, {
				type: "attachment.added",
				actor,
				cardId,
				workspaceId,
				payload: {
					attachmentId: attachment.id,
					mimeType: attachment.mimeType,
					createdAt: attachment.createdAt,
				},
			});
		} catch (error) {
			console.error("Failed to publish attachment event:", error);
		}
	}
}

function sendExistingCardUploadResponse(
	res: Response,
	workspaceId: number,
	cardId: number,
	attachments: PreparedAttachment[],
	result: { accepted: StoredAttachment[]; existingCount: number },
): Response {
	const rejectedCount = attachments.length - result.accepted.length;
	const total = result.existingCount + result.accepted.length;
	return res.status(201).json({
		attachments: result.accepted.map((attachment) =>
			mapAttachmentResponse(
				{
					id: attachment.id,
					mime_type: attachment.mimeType,
					created_at: attachment.createdAt,
				},
				{ workspaceId, cardId },
			),
		),
		acceptedCount: result.accepted.length,
		addedCount: result.accepted.length,
		rejectedCount,
		requestedCount: attachments.length,
		total,
		totalCount: total,
		limit: EXISTING_CARD_ATTACHMENT_LIMIT,
		...(rejectedCount > 0
			? {
					message: PARTIAL_UPLOAD_MESSAGE(
						result.accepted.length,
						attachments.length,
					),
				}
			: {}),
	});
}

export async function uploadExistingCardAttachments(
	req: Request,
	res: Response,
): Promise<Response> {
	const workspaceId = req.workspace?.workspaceId;
	const cardId = parsePositiveInteger(
		typeof req.params.cardId === "string" ? req.params.cardId : undefined,
	);
	if (workspaceId === undefined || cardId === null) {
		return res.status(404).json({ error: "Not found" });
	}

	const uploaded = parseUploadedAttachments(req);
	if (uploaded.error) return res.status(400).json({ error: uploaded.error });
	const attachments = uploaded.attachments ?? [];
	const validationError = await validateAttachmentPairs(attachments);
	if (validationError) return res.status(400).json({ error: validationError });

	const storage = getAttachmentStorage();
	const written: WrittenAttachment[] = [];
	let result: { accepted: StoredAttachment[]; existingCount: number };
	try {
		result = await runExistingCardUploadTransaction({
			workspaceId,
			cardId,
			actor: req.user!,
			attachments,
			storage,
			written,
		});
	} catch (error) {
		return sendExistingCardUploadError(res, error);
	}
	await publishExistingAttachments(
		workspaceId,
		req.user!,
		cardId,
		result.accepted,
	);
	return sendExistingCardUploadResponse(
		res,
		workspaceId,
		cardId,
		attachments,
		result,
	);
}
