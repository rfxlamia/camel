const FILE_SIGNATURES: Record<string, Buffer[]> = {
	png: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
	jpeg: [
		Buffer.from([0xff, 0xd8, 0xff]),
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
};

export const MAX_IMAGE_DIMENSION = 4096;
const MAX_JPEG_HEADER_BYTES = 64 * 1024;

interface ImageDimensions {
	width: number;
	height: number;
}

interface DimensionValidationResult {
	dimensions?: ImageDimensions;
	error?: string;
}

export interface FileValidationResult {
	valid: boolean;
	detectedType?: string;
	dimensions?: ImageDimensions;
	error?: string;
}

const INVALID_PNG_DIMENSIONS =
	"invalid image dimensions: PNG IHDR is missing or malformed";
const INVALID_JPEG_DIMENSIONS =
	"invalid image dimensions: JPEG SOF marker is missing or malformed";
const OVERSIZED_DIMENSIONS = "image dimensions exceed maximum of 4096 pixels";

function validateDimensions(
	dimensions: ImageDimensions,
): DimensionValidationResult {
	if (
		dimensions.width < 1 ||
		dimensions.height < 1 ||
		dimensions.width > MAX_IMAGE_DIMENSION ||
		dimensions.height > MAX_IMAGE_DIMENSION
	) {
		return { dimensions, error: OVERSIZED_DIMENSIONS };
	}

	return { dimensions };
}

function parsePngDimensions(buffer: Buffer): DimensionValidationResult {
	if (
		buffer.length < 24 ||
		buffer.readUInt32BE(8) !== 13 ||
		buffer.toString("ascii", 12, 16) !== "IHDR"
	) {
		return { error: INVALID_PNG_DIMENSIONS };
	}

	return validateDimensions({
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20),
	});
}

function isJpegSofMarker(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

interface JpegMarker {
	marker: number;
	offset: number;
}

function readJpegMarker(
	buffer: Buffer,
	offset: number,
	limit: number,
): JpegMarker | null {
	if (buffer[offset] !== 0xff) {
		return null;
	}

	while (offset < limit && buffer[offset] === 0xff) {
		offset += 1;
	}
	if (offset >= limit) {
		return null;
	}

	return { marker: buffer[offset], offset: offset + 1 };
}

function readJpegSegmentLength(
	buffer: Buffer,
	offset: number,
	limit: number,
): number | null {
	if (offset + 2 > limit) {
		return null;
	}

	const segmentLength = buffer.readUInt16BE(offset);
	if (segmentLength < 2 || offset + segmentLength > limit) {
		return null;
	}

	return segmentLength;
}

function isJpegStandaloneMarker(marker: number): boolean {
	return (
		marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)
	);
}

function parseJpegSofDimensions(
	buffer: Buffer,
	offset: number,
	segmentLength: number,
): DimensionValidationResult {
	if (segmentLength < 7) {
		return { error: INVALID_JPEG_DIMENSIONS };
	}

	return validateDimensions({
		height: buffer.readUInt16BE(offset + 3),
		width: buffer.readUInt16BE(offset + 5),
	});
}

function parseJpegDimensions(buffer: Buffer): DimensionValidationResult {
	if (
		buffer.length < 4 ||
		buffer[0] !== 0xff ||
		buffer[1] !== 0xd8 ||
		buffer[2] !== 0xff
	) {
		return { error: INVALID_JPEG_DIMENSIONS };
	}

	const limit = Math.min(buffer.length, MAX_JPEG_HEADER_BYTES);
	let offset = 2;

	while (offset < limit) {
		const markerInfo = readJpegMarker(buffer, offset, limit);
		if (!markerInfo) {
			return { error: INVALID_JPEG_DIMENSIONS };
		}
		offset = markerInfo.offset;

		if (isJpegStandaloneMarker(markerInfo.marker)) {
			continue;
		}
		if (markerInfo.marker === 0xda) {
			return { error: INVALID_JPEG_DIMENSIONS };
		}

		const segmentLength = readJpegSegmentLength(buffer, offset, limit);
		if (segmentLength === null) {
			return { error: INVALID_JPEG_DIMENSIONS };
		}

		if (isJpegSofMarker(markerInfo.marker)) {
			return parseJpegSofDimensions(buffer, offset, segmentLength);
		}

		offset += segmentLength;
	}

	return { error: INVALID_JPEG_DIMENSIONS };
}

function validateImageDimensions(
	buffer: Buffer,
	detectedType: string,
): DimensionValidationResult {
	if (detectedType === "png") {
		return parsePngDimensions(buffer);
	}
	if (detectedType === "jpeg") {
		return parseJpegDimensions(buffer);
	}
	return {};
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

	const dimensions = validateImageDimensions(buffer, detectedType);
	if (dimensions.error) {
		return {
			valid: false,
			detectedType,
			dimensions: dimensions.dimensions,
			error: dimensions.error,
		};
	}

	return {
		valid: true,
		detectedType,
		dimensions: dimensions.dimensions,
	};
}
