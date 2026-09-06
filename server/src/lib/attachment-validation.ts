import {
	ATTACHMENT_VALIDATION_MESSAGES,
	MAX_ATTACHMENT_FILE_SIZE_BYTES,
} from "./attachment-upload.js";
import { validateFileContent } from "./file-validator.js";

export type AttachmentValidationFile = Pick<
	Express.Multer.File,
	"buffer" | "mimetype" | "size"
>;

export type AttachmentValidationPair = {
	thumbnail: AttachmentValidationFile;
	original: AttachmentValidationFile;
};

function mapFileValidationError(error: string | undefined): string {
	if (error?.includes("dimensions")) {
		return ATTACHMENT_VALIDATION_MESSAGES.dimensions;
	}
	return ATTACHMENT_VALIDATION_MESSAGES.mime;
}

/**
 * Validates every byte payload in an attachment batch before persistence.
 * Both files in a pair share one database MIME value, so their declared MIME
 * types must match after each file has passed signature and dimension checks.
 */
export async function validateAttachmentPairs(
	attachments: readonly AttachmentValidationPair[],
): Promise<string | null> {
	for (const attachment of attachments) {
		for (const file of [attachment.thumbnail, attachment.original]) {
			if (file.size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
				return ATTACHMENT_VALIDATION_MESSAGES.size;
			}
			const validation = await validateFileContent(file.buffer, file.mimetype);
			if (!validation.valid) return mapFileValidationError(validation.error);
		}
		if (attachment.thumbnail.mimetype !== attachment.original.mimetype) {
			return ATTACHMENT_VALIDATION_MESSAGES.mime;
		}
	}
	return null;
}
