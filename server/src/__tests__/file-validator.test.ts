import { describe, expect, it } from "vitest";
import { getFileSignature, validateFileContent } from "../lib/file-validator";

function createPngHeader(width: number, height: number): Buffer {
	const buffer = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
	buffer.writeUInt32BE(13, 8);
	buffer.write("IHDR", 12, "ascii");
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	return buffer;
}

function createJpegHeader(width: number, height: number): Buffer {
	return Buffer.from([
		0xff,
		0xd8,
		0xff,
		0xe0,
		0x00,
		0x04,
		0x00,
		0x00,
		0xff,
		0xc0,
		0x00,
		0x07,
		0x08,
		(height >> 8) & 0xff,
		height & 0xff,
		(width >> 8) & 0xff,
		width & 0xff,
		0x01,
	]);
}

describe("File Content Validation", () => {
	describe("getFileSignature", () => {
		it("should detect PNG files", () => {
			const pngBuffer = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
			]);
			expect(getFileSignature(pngBuffer)).toBe("png");
		});

		it("should detect JPEG files", () => {
			const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
			expect(getFileSignature(jpegBuffer)).toBe("jpeg");
		});

		it("should detect GIF files", () => {
			const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
			expect(getFileSignature(gifBuffer)).toBe("gif");
		});

		it("should return null for unknown files", () => {
			const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
			expect(getFileSignature(unknownBuffer)).toBeNull();
		});

		it("should handle empty buffers", () => {
			const emptyBuffer = Buffer.alloc(0);
			expect(getFileSignature(emptyBuffer)).toBeNull();
		});
	});

	describe("validateFileContent", () => {
		it("should validate PNG file content", async () => {
			const pngBuffer = createPngHeader(1024, 768);
			const result = await validateFileContent(pngBuffer, "image/png");
			expect(result.valid).toBe(true);
			expect(result.detectedType).toBe("png");
		});

		it("should validate JPEG file content", async () => {
			const jpegBuffer = createJpegHeader(1024, 768);
			const result = await validateFileContent(jpegBuffer, "image/jpeg");
			expect(result.valid).toBe(true);
			expect(result.detectedType).toBe("jpeg");
		});

		it("reject HTML file with image extension", async () => {
			const htmlBuffer = Buffer.from(
				'<html><script>alert("xss")</script></html>',
			);
			const result = await validateFileContent(htmlBuffer, "image/png");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("invalid file");
		});

		it("reject executable file with image extension", async () => {
			const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
			const result = await validateFileContent(exeBuffer, "image/png");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("content does not match");
		});

		it("rejects PNG dimensions over 4096 pixels", async () => {
			const widthResult = await validateFileContent(
				createPngHeader(4097, 1024),
				"image/png",
			);
			const heightResult = await validateFileContent(
				createPngHeader(1024, 4097),
				"image/png",
			);
			const validResult = await validateFileContent(
				createPngHeader(4096, 4096),
				"image/png",
			);

			expect(widthResult.valid).toBe(false);
			expect(widthResult.error).toContain("dimensions");
			expect(heightResult.valid).toBe(false);
			expect(heightResult.error).toContain("dimensions");
			expect(validResult.valid).toBe(true);
		});

		it("rejects JPEG dimensions over 4096 pixels", async () => {
			const widthResult = await validateFileContent(
				createJpegHeader(4097, 1024),
				"image/jpeg",
			);
			const heightResult = await validateFileContent(
				createJpegHeader(1024, 4097),
				"image/jpeg",
			);
			const validResult = await validateFileContent(
				createJpegHeader(4096, 4096),
				"image/jpeg",
			);

			expect(widthResult.valid).toBe(false);
			expect(widthResult.error).toContain("dimensions");
			expect(heightResult.valid).toBe(false);
			expect(heightResult.error).toContain("dimensions");
			expect(validResult.valid).toBe(true);
		});

		it("rejects malformed image dimension headers without throwing", async () => {
			const malformedPng = Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
			]);
			const malformedJpeg = Buffer.from([
				0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0,
				0x00, 0x03,
			]);

			await expect(
				validateFileContent(malformedPng, "image/png"),
			).resolves.toMatchObject({ valid: false });
			await expect(
				validateFileContent(malformedJpeg, "image/jpeg"),
			).resolves.toMatchObject({ valid: false });
		});

		it("should handle null/undefined buffers", async () => {
			const result = await validateFileContent(null as any, "image/png");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("invalid file");
		});
	});
});
