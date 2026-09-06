import type { RequestHandler } from "express";

export const MAX_ATTACHMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const EXTRA_MULTIPART_FIELDS = 2;

export interface AttachmentUploadProfile {
	readonly maxPairs: number;
	readonly files: number;
	readonly parts: number;
	readonly fileSize: number;
}

/**
 * Parser ceilings shared by attachment routes. The two extra parts reserve
 * space for route metadata while keeping the file and part counts finite.
 */
export const ATTACHMENT_UPLOAD_PROFILES = Object.freeze({
	cardCreate: Object.freeze({
		maxPairs: 3,
		files: 6,
		parts: 8,
		fileSize: MAX_ATTACHMENT_FILE_SIZE_BYTES,
	}),
	existingCard: Object.freeze({
		maxPairs: 10,
		files: 20,
		parts: 22,
		fileSize: MAX_ATTACHMENT_FILE_SIZE_BYTES,
	}),
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
	const maxFiles = maxPairs * 2;
	const upload = multer({
		storage: multer.memoryStorage(),
		limits: {
			fileSize: MAX_ATTACHMENT_FILE_SIZE_BYTES,
			files: maxFiles,
			parts: maxFiles + EXTRA_MULTIPART_FIELDS,
		},
	});

	return upload.fields([
		{ name: "thumbnail", maxCount: maxPairs },
		{ name: "original", maxCount: maxPairs },
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
			error: "Attachment file size must be under 10MB",
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

export const normalizeAttachmentUploadErrorResponse = normalizeAttachmentUploadError;
