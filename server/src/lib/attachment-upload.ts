import type { Request, RequestHandler } from "express";

export const MAX_ATTACHMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES =
	MAX_ATTACHMENT_FILE_SIZE_BYTES * 3 * 2;
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
	readonly maxTotalBytes: number;
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
		maxTotalBytes: Math.min(
			files * MAX_ATTACHMENT_FILE_SIZE_BYTES,
			MAX_ATTACHMENT_TOTAL_BYTES,
		),
	};
}

/**
 * Parser ceilings shared by attachment routes. Each profile reserves exactly
 * one multipart part for the JSON `metadata` field.
 */
export const ATTACHMENT_UPLOAD_PROFILES = Object.freeze({
	cardCreate: Object.freeze(createAttachmentUploadProfile(3)),
	existingCard: Object.freeze(createAttachmentUploadProfile(3)),
});

export const ATTACHMENT_UPLOAD_LIMITS = ATTACHMENT_UPLOAD_PROFILES;

export interface CreateAttachmentUploadOptions {
	maxPairs: number;
	/** Lower test-only override; production profiles retain their aggregate ceiling. */
	maxTotalBytes?: number;
}

type UploadFileCallback = (
	error?: unknown,
	info?: Partial<Express.Multer.File>,
) => void;

type BoundedMemoryStorage = {
	_handleFile(
		req: Request,
		file: Express.Multer.File,
		callback: UploadFileCallback,
	): void;
	_removeFile(
		req: Request,
		file: Express.Multer.File,
		callback: (error: Error | null) => void,
	): void;
};

type UploadRequestState = {
	totalBytes: number;
	exceeded: boolean;
};

class AggregateUploadLimitError extends Error {
	readonly code = "LIMIT_FILE_TOTAL_SIZE";

	constructor() {
		super("Attachment upload exceeds its aggregate file size limit");
		this.name = "AggregateUploadLimitError";
	}
}

const uploadRequestStates = new WeakMap<Request, UploadRequestState>();

function createBoundedMemoryStorage(
	maxTotalBytes: number,
): BoundedMemoryStorage {
	return {
		_handleFile(req, file, callback) {
			const state = uploadRequestStates.get(req) ?? {
				totalBytes: 0,
				exceeded: false,
			};
			uploadRequestStates.set(req, state);
			if (state.exceeded) {
				file.stream.resume();
				callback(new AggregateUploadLimitError());
				return;
			}

			const chunks: Buffer[] = [];
			let fileSize = 0;
			let settled = false;
			const abort = (error: Error) => {
				if (settled) return;
				settled = true;
				chunks.length = 0;
				file.stream.resume();
				callback(error);
			};

			file.stream.on("data", (chunk: Buffer) => {
				if (settled) return;
				const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				fileSize += bytes.length;
				state.totalBytes += bytes.length;
				if (state.totalBytes > maxTotalBytes) {
					state.exceeded = true;
					abort(new AggregateUploadLimitError());
					return;
				}
				chunks.push(bytes);
			});
			file.stream.once("error", abort);
			file.stream.once("end", () => {
				if (settled) return;
				settled = true;
				callback(null, { buffer: Buffer.concat(chunks), size: fileSize });
			});
		},
		_removeFile(_req, file, callback) {
			Reflect.deleteProperty(file, "buffer");
			callback(null);
		},
	};
}

/**
 * Creates a bounded in-memory parser for thumbnail/original pairs.
 *
 * Multer is loaded lazily so importing this module does not initialize a
 * parser or touch the filesystem. Storage writes remain an explicit route
 * concern, allowing a failed database transaction to remove written pairs.
 */
export async function createAttachmentUpload({
	maxPairs,
	maxTotalBytes: requestedMaxTotalBytes,
}: CreateAttachmentUploadOptions): Promise<RequestHandler> {
	if (!Number.isInteger(maxPairs) || maxPairs < 1) {
		throw new RangeError("maxPairs must be a positive integer");
	}

	const multerModule = await import("multer");
	const multer = multerModule.default ?? multerModule;
	const profile = createAttachmentUploadProfile(maxPairs);
	const maxTotalBytes = Math.min(
		requestedMaxTotalBytes ?? profile.maxTotalBytes,
		profile.maxTotalBytes,
	);
	if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) {
		throw new RangeError("maxTotalBytes must be a positive safe integer");
	}
	const upload = multer({
		storage: createBoundedMemoryStorage(maxTotalBytes),
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

	if (
		code === "LIMIT_PART_COUNT" ||
		code === "LIMIT_FILE_COUNT" ||
		code === "LIMIT_FILE_TOTAL_SIZE"
	) {
		return {
			status: 413,
			code,
			error:
				code === "LIMIT_FILE_TOTAL_SIZE"
					? "Attachment upload exceeds its aggregate file size limit"
					: "Attachment upload exceeds its multipart limit",
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
