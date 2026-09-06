import type { RequestHandler } from "express";

export const MAX_ATTACHMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_VALIDATION_MESSAGES = Object.freeze({
	mime: "Only PNG and JPEG accepted",
	size: "File size must be under 10MB",
	dimensions: "Image dimensions must be 4096px or smaller",
});
export const CARD_CREATE_METADATA_FIELD = "metadata";
export const ATTACHMENT_METADATA_PARTS = 1;
const MULTER_PARTS_LIMIT_SENTINEL = 1;

export interface AttachmentUploadProfile {
	readonly maxPairs: number;
	readonly files: number;
	readonly parts: number;
	readonly fileSize: number;
}

function createAttachmentUploadProfile(
	maxPairs: number,
): AttachmentUploadProfile {
	const files = maxPairs * 2;
	return {
		maxPairs,
		files,
		parts: files + ATTACHMENT_METADATA_PARTS,
		fileSize: MAX_ATTACHMENT_FILE_SIZE_BYTES,
	};
}

/**
 * Parser ceilings shared by attachment routes. Each profile reserves exactly
 * one multipart part for the JSON `metadata` field.
 */
export const ATTACHMENT_UPLOAD_PROFILES = Object.freeze({
	cardCreate: Object.freeze(createAttachmentUploadProfile(3)),
	existingCard: Object.freeze(createAttachmentUploadProfile(10)),
});

export const ATTACHMENT_UPLOAD_LIMITS = ATTACHMENT_UPLOAD_PROFILES;

export interface CreateAttachmentUploadOptions {
	maxPairs: number;
}

/**
 * Creates a memory-backed parser for thumbnail/original pairs.
 *
 * Multer is loaded lazily so importing this module does not initialize a
 * parser or touch the filesystem. Storage writes remain an explicit route
 * concern, allowing a failed database transaction to remove written pairs.
 */
export async function createAttachmentUpload({
	maxPairs,
}: CreateAttachmentUploadOptions): Promise<RequestHandler> {
	if (!Number.isInteger(maxPairs) || maxPairs < 1) {
		throw new RangeError("maxPairs must be a positive integer");
	}

	const multerModule = await import("multer");
	const multer = multerModule.default ?? multerModule;
	const profile = createAttachmentUploadProfile(maxPairs);
	const upload = multer({
		storage: multer.memoryStorage(),
		limits: {
			fileSize: profile.fileSize,
			files: profile.files,
			// Busboy emits its parts-limit error when the count reaches the configured
			// value, so reserve one sentinel beyond the accepted profile ceiling.
			parts: profile.parts + MULTER_PARTS_LIMIT_SENTINEL,
		},
	});

	return upload.fields([
		{ name: "thumbnail", maxCount: maxPairs },
		{ name: "original", maxCount: maxPairs },
		{ name: CARD_CREATE_METADATA_FIELD, maxCount: 1 },
	]);
}

export interface NormalizedAttachmentUploadError {
	status: number;
	code: string;
	error: string;
}

/** Converts Multer/parser failures into the stable boundary routes expose. */
export function normalizeAttachmentUploadError(
	error: unknown,
): NormalizedAttachmentUploadError {
	const code =
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
			? error.code
			: "UPLOAD_ERROR";
	const message =
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
			? error.message
			: "Attachment upload failed";

	if (code === "LIMIT_FILE_SIZE") {
		return {
			status: 413,
			code,
			error: ATTACHMENT_VALIDATION_MESSAGES.size,
		};
	}

	if (code === "LIMIT_PART_COUNT" || code === "LIMIT_FILE_COUNT") {
		return {
			status: 413,
			code,
			error: "Attachment upload exceeds its multipart limit",
		};
	}

	if (code === "LIMIT_UNEXPECTED_FILE") {
		return {
			status: 400,
			code,
			error: "Attachment pair limit exceeded",
		};
	}

	return { status: 400, code, error: message };
}

export const normalizeAttachmentUploadErrorResponse =
	normalizeAttachmentUploadError;
