import { stat } from "node:fs/promises";
import * as path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Router } from "express";
import { sql } from "kysely";
import type { AuthUser } from "../auth.js";
import { config } from "../config.js";
import { type DBExecutor, db } from "../db/kysely.js";
import {
	type AttachmentPair,
	getAttachmentStorage,
} from "../lib/attachment-storage.js";
import {
	ATTACHMENT_UPLOAD_PROFILES,
	createAttachmentUpload,
	MAX_ATTACHMENT_FILE_SIZE_BYTES,
	normalizeAttachmentUploadError,
} from "../lib/attachment-upload.js";
import { validateFileContent } from "../lib/file-validator.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import { recordActivity } from "./helpers.js";

interface AttachmentDeliveryRow {
	id: number;
	card_id: number;
	mime_type: string;
	thumbnail_path: string;
	original_path: string;
}

declare global {
	// biome-ignore lint/style/noNamespace: Express augmentation
	namespace Express {
		interface Request {
			attachmentDelivery?: AttachmentDeliveryRow;
		}
	}
}

function parsePositiveInteger(value: string | undefined): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Checks workspace membership and active-card ownership before a route handler
 * can operate on a card or read a provider path. Attachment routes opt into the
 * additional attachment-on-card check.
 */
export type AttachmentOwnershipGuardOptions = {
	requireAttachment?: boolean;
};

export function createAttachmentOwnershipGuard({
	requireAttachment = true,
}: AttachmentOwnershipGuardOptions = {}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		void requireWorkspaceMember(req, res, () => {
			void loadOwnedCard(req, res, next, requireAttachment);
		});
	};
}

async function loadOwnedCard(
	req: Request,
	res: Response,
	next: NextFunction,
	requireAttachment: boolean,
): Promise<void> {
	try {
		const workspaceId = req.workspace?.workspaceId;
		const cardId = parsePositiveInteger(
			typeof req.params.cardId === "string" ? req.params.cardId : undefined,
		);
		if (workspaceId === undefined || cardId === null) {
			res.status(404).json({ error: "Not found" });
			return;
		}

		const card = await db
			.selectFrom("cards as c")
			.select("c.id")
			.where("c.id", "=", cardId)
			.where("c.workspace_id", "=", workspaceId)
			.where("c.deleted_at", "is", null)
			.executeTakeFirst();
		if (!card) {
			res.status(404).json({ error: "Not found" });
			return;
		}

		if (!requireAttachment) {
			next();
			return;
		}

		await loadOwnedAttachment(req, res, next, card.id);
	} catch (error) {
		next(error);
	}
}

async function loadOwnedAttachment(
	req: Request,
	res: Response,
	next: NextFunction,
	cardId: number,
): Promise<void> {
	const attachmentId = parsePositiveInteger(
		typeof req.params.attachmentId === "string"
			? req.params.attachmentId
			: undefined,
	);
	if (attachmentId === null) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	const attachment = await db
		.selectFrom("attachments as a")
		.select([
			"a.id",
			"a.card_id",
			"a.mime_type",
			"a.thumbnail_path",
			"a.original_path",
		])
		.where("a.id", "=", attachmentId)
		.where("a.card_id", "=", cardId)
		.executeTakeFirst();

	if (!attachment) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	req.attachmentDelivery = attachment;
	next();
}

export const attachmentOwnershipGuard = createAttachmentOwnershipGuard();

function resolveProviderPath(providerPath: string): string | null {
	if (path.isAbsolute(providerPath)) return null;
	const root = path.resolve(config.ATTACHMENTS_DIR);
	const resolved = path.resolve(root, providerPath);
	if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
		return null;
	}
	return resolved;
}

function safeDownloadFilename(
	providerPath: string,
	attachmentId: number,
): string {
	const basename = path
		.basename(providerPath)
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.replace(/^\.+$/, "");
	return basename || `attachment-${attachmentId}`;
}

function matchesIfNoneMatch(req: Request, etag: string): boolean {
	const value = req.headers["if-none-match"];
	if (typeof value !== "string") return false;
	return value
		.split(",")
		.map((candidate) => candidate.trim())
		.some((candidate) => candidate === etag || candidate === `W/${etag}`);
}

async function deliverAttachment(
	req: Request,
	res: Response,
	next: NextFunction,
	kind: "thumbnail" | "original",
	download: boolean,
): Promise<void> {
	const attachment = req.attachmentDelivery;
	if (!attachment) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	const providerPath =
		kind === "thumbnail" ? attachment.thumbnail_path : attachment.original_path;
	const filePath = resolveProviderPath(providerPath);
	if (!filePath) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	try {
		const metadata = await stat(filePath);
		if (!metadata.isFile()) {
			res.status(404).json({ error: "Not found" });
			return;
		}

		const etag = `"${metadata.size.toString(16)}-${Math.floor(metadata.mtimeMs).toString(16)}"`;
		res.setHeader("Cache-Control", "private, max-age=300");
		res.setHeader("ETag", etag);
		res.setHeader("Content-Type", attachment.mime_type);
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader(
			"Content-Disposition",
			download
				? `attachment; filename="${safeDownloadFilename(providerPath, attachment.id)}"`
				: "inline",
		);
		if (matchesIfNoneMatch(req, etag)) {
			res.removeHeader("Content-Type");
			res.status(304).end();
			return;
		}

		res.sendFile(providerPath, { root: config.ATTACHMENTS_DIR }, (error) => {
			if (error && !res.headersSent) next(error);
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			res.status(404).json({ error: "Not found" });
			return;
		}
		next(error);
	}
}

type UploadedFile = Express.Multer.File;
type PreparedAttachment = {
	thumbnail: UploadedFile;
	original: UploadedFile;
	mimeType: string;
};
type WrittenAttachment = {
	pair: AttachmentPair;
	mimeType: string;
	thumbnailSize: number;
	originalSize: number;
};
type StoredAttachment = {
	id: number;
	mimeType: string;
	createdAt: string;
};

type ExistingCardAttachmentCapacityHook = (input: {
	cardId: number;
	existingCount: number;
	availableSlots: number;
	requestedCount: number;
}) => void | Promise<void>;

let existingCardAttachmentCapacityHook:
	| ExistingCardAttachmentCapacityHook
	| undefined;

/** Narrow synchronization seam used by the PostgreSQL contention integration test. */
export function setExistingCardAttachmentCapacityHookForTests(
	hook: ExistingCardAttachmentCapacityHook | null,
): void {
	existingCardAttachmentCapacityHook = hook ?? undefined;
}

export const setAttachmentCapacityHookForTests =
	setExistingCardAttachmentCapacityHookForTests;

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
			const message =
				normalized.code === "LIMIT_FILE_SIZE"
					? "File size must be under 10MB"
					: normalized.error;
			res.status(normalized.status).json({
				error: message,
				code: normalized.code,
			});
		});
	} catch (error) {
		next(error);
	}
};

function uploadedExistingAttachments(req: Request): {
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

function mapAttachmentValidationError(error: string | undefined): string {
	if (error?.includes("dimensions exceed") || error?.includes("dimensions")) {
		return "Image dimensions must be 4096px or smaller";
	}
	return "Only PNG and JPEG accepted";
}

async function validateExistingAttachments(
	attachments: PreparedAttachment[],
): Promise<string | null> {
	for (const attachment of attachments) {
		for (const file of [attachment.thumbnail, attachment.original]) {
			if (file.size >= MAX_ATTACHMENT_FILE_SIZE_BYTES) {
				return "File size must be under 10MB";
			}
			const validation = await validateFileContent(file.buffer, file.mimetype);
			if (!validation.valid) {
				return mapAttachmentValidationError(validation.error);
			}
		}
		if (attachment.thumbnail.mimetype !== attachment.original.mimetype) {
			return "Only PNG and JPEG accepted";
		}
	}
	return null;
}

async function removeWrittenExistingAttachments(
	storage: ReturnType<typeof getAttachmentStorage>,
	attachments: WrittenAttachment[],
): Promise<void> {
	await storage.removePairs(attachments.map(({ pair }) => pair));
}

function toIso(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

async function persistExistingCardAttachments(
	trx: DBExecutor,
	input: {
		workspaceId: number;
		cardId: number;
		actor: AuthUser;
		attachments: PreparedAttachment[];
		storage: ReturnType<typeof getAttachmentStorage>;
		written: WrittenAttachment[];
	},
): Promise<{
	accepted: StoredAttachment[];
	existingCount: number;
}> {
	const card = await trx
		.selectFrom("cards")
		.select(["id", "column_id"])
		.where("id", "=", input.cardId)
		.where("workspace_id", "=", input.workspaceId)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
	if (!card) throw Object.assign(new Error("Not found"), { statusCode: 404 });

	const countRow = await trx
		.selectFrom("attachments")
		.select(sql<number>`count(*)::int`.as("count"))
		.where("card_id", "=", card.id)
		.executeTakeFirstOrThrow();
	const existingCount = countRow.count;
	const availableSlots = Math.max(0, 3 - existingCount);
	await existingCardAttachmentCapacityHook?.({
		cardId: card.id,
		existingCount,
		availableSlots,
		requestedCount: input.attachments.length,
	});
	if (availableSlots === 0) {
		throw Object.assign(new Error("Max 3 images per card"), {
			statusCode: 409,
			capacity: true,
		});
	}

	const accepted: StoredAttachment[] = [];
	for (const attachment of input.attachments.slice(0, availableSlots)) {
		const pair = await input.storage.writePair({
			thumbnail: attachment.thumbnail.buffer,
			original: attachment.original.buffer,
		});
		input.written.push({
			pair,
			mimeType: attachment.mimeType,
			thumbnailSize: attachment.thumbnail.size,
			originalSize: attachment.original.size,
		});
		const row = await trx
			.insertInto("attachments")
			.values({
				card_id: card.id,
				mime_type: attachment.mimeType,
				thumbnail_path: pair.thumbnailPath,
				original_path: pair.originalPath,
				thumbnail_size_bytes: attachment.thumbnail.size,
				original_size_bytes: attachment.original.size,
			})
			.returning(["id", "mime_type", "created_at"])
			.executeTakeFirstOrThrow();
		await recordActivity(
			trx,
			input.actor,
			input.workspaceId,
			"attachment_added",
			{
				cardId: card.id,
				toColumnId: card.column_id,
				payload: {
					attachmentId: row.id,
					mimeType: row.mime_type,
					createdAt: toIso(row.created_at),
				},
			},
		);
		accepted.push({
			id: row.id,
			mimeType: row.mime_type,
			createdAt: toIso(row.created_at),
		});
	}
	return { accepted, existingCount };
}

async function publishExistingAttachment(
	workspaceId: number,
	actor: AuthUser,
	cardId: number,
	attachment: StoredAttachment,
): Promise<void> {
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

async function uploadExistingCardAttachments(req: Request, res: Response) {
	const workspaceId = req.workspace?.workspaceId;
	const cardId = parsePositiveInteger(
		typeof req.params.cardId === "string" ? req.params.cardId : undefined,
	);
	if (workspaceId === undefined || cardId === null) {
		return res.status(404).json({ error: "Not found" });
	}

	const uploaded = uploadedExistingAttachments(req);
	if (uploaded.error) return res.status(400).json({ error: uploaded.error });
	const attachments = uploaded.attachments ?? [];
	const validationError = await validateExistingAttachments(attachments);
	if (validationError) return res.status(400).json({ error: validationError });

	const storage = getAttachmentStorage();
	const written: WrittenAttachment[] = [];
	let result: { accepted: StoredAttachment[]; existingCount: number };
	try {
		result = await db.transaction().execute((trx) =>
			persistExistingCardAttachments(trx, {
				workspaceId,
				cardId,
				actor: req.user!,
				attachments,
				storage,
				written,
			}),
		);
	} catch (error) {
		await removeWrittenExistingAttachments(storage, written);
		if ((error as { capacity?: boolean }).capacity) {
			return res.status(409).json({ error: "Max 3 images per card" });
		}
		if ((error as { statusCode?: number }).statusCode === 404) {
			return res.status(404).json({ error: "Not found" });
		}
		console.error("Failed to add card attachments", error);
		return res.status(500).json({ error: "Unable to add card attachments" });
	}

	const total = result.existingCount + result.accepted.length;
	for (const attachment of result.accepted) {
		await publishExistingAttachment(workspaceId, req.user!, cardId, attachment);
	}
	const rejectedCount = attachments.length - result.accepted.length;
	return res.status(201).json({
		attachments: result.accepted,
		acceptedCount: result.accepted.length,
		addedCount: result.accepted.length,
		rejectedCount,
		requestedCount: attachments.length,
		total,
		totalCount: total,
		limit: 3,
		...(rejectedCount > 0
			? {
					message: `${result.accepted.length} of ${attachments.length} images added — card limit is 3 images`,
				}
			: {}),
	});
}

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
