const FILE_SIGNATURES: Record<string, Buffer[]> = {
	png: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
	jpeg: [
		Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
		Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
		Buffer.from([0xff, 0xd8, 0xff, 0xe8]),
	],
	gif: [
		Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]),
		Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
	],
	// Dangerous types: detect to reject with specific "content does not match" error
	exe: [
		Buffer.from([0x4d, 0x5a]), // MZ - Windows PE/DOS executable
	],
	elf: [
		Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF - Linux executable
	],
};

const MIME_TO_SIGNATURE: Record<string, string[]> = {
	"image/png": ["png"],
	"image/jpeg": ["jpeg"],
	"image/gif": ["gif"],
	"image/webp": ["webp"],
};

export interface FileValidationResult {
	valid: boolean;
	detectedType?: string;
	error?: string;
}

export function getFileSignature(buffer: Buffer): string | null {
	if (!buffer || buffer.length < 4) {
		return null;
	}

	// WebP: "RIFF" <4-byte size> "WEBP"
	if (
		buffer.length >= 12 &&
		buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
		buffer.subarray(8, 12).toString("latin1") === "WEBP"
	) {
		return "webp";
	}

	for (const [type, signatures] of Object.entries(FILE_SIGNATURES)) {
		for (const signature of signatures) {
			if (buffer.subarray(0, signature.length).equals(signature)) {
				return type;
			}
		}
	}

	return null;
}

export async function validateFileContent(
	buffer: Buffer,
	declaredMimeType: string,
): Promise<FileValidationResult> {
	if (!buffer || !(buffer instanceof Buffer)) {
		return {
			valid: false,
			error: "invalid file: no content provided",
		};
	}

	if (buffer.length < 4) {
		return {
			valid: false,
			error: "invalid file: file too small",
		};
	}

	const detectedType = getFileSignature(buffer);
	if (!detectedType) {
		return {
			valid: false,
			error: "invalid file: could not determine file type",
		};
	}

	const expectedTypes = MIME_TO_SIGNATURE[declaredMimeType];
	if (!expectedTypes) {
		return {
			valid: false,
			error: `unsupported MIME type: ${declaredMimeType}`,
		};
	}

	if (!expectedTypes.includes(detectedType)) {
		return {
			valid: false,
			error: `content does not match declared type: expected ${declaredMimeType} but detected ${detectedType}`,
			detectedType,
		};
	}

	return {
		valid: true,
		detectedType,
	};
}

export async function validateUploadedFile(
	file: { buffer: Buffer; mimetype: string; size: number },
	options: { maxSize?: number; allowedMimeTypes?: string[] } = {},
): Promise<FileValidationResult> {
	const {
		maxSize = 10 * 1024 * 1024,
		allowedMimeTypes = ["image/png", "image/jpeg"],
	} = options;

	if (file.size > maxSize) {
		return {
			valid: false,
			error: `file size exceeds maximum allowed size of ${maxSize / (1024 * 1024)}MB`,
		};
	}

	if (!allowedMimeTypes.includes(file.mimetype)) {
		return {
			valid: false,
			error: `invalid file type: ${file.mimetype}. Allowed types: ${allowedMimeTypes.join(", ")}`,
		};
	}

	return validateFileContent(file.buffer, file.mimetype);
}
