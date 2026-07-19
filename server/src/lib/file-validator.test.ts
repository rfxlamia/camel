import { describe, expect, it } from "vitest";
import {
	getFileSignature,
	validateFileContent,
	validateTextContent,
} from "./file-validator.js";

describe("PDF signature validation", () => {
	it("accepts a %PDF- buffer declared as application/pdf", async () => {
		const buffer = Buffer.from("%PDF-1.4\nsome pdf content");
		const result = await validateFileContent(buffer, "application/pdf");
		expect(result.valid).toBe(true);
		expect(result.detectedType).toBe("pdf");
	});

	it("rejects EXE bytes declared as application/pdf", async () => {
		const buffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
		const result = await validateFileContent(buffer, "application/pdf");
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/content does not match/);
		expect(result.detectedType).toBe("exe");
	});

	it("rejects plain text declared as application/pdf (no signature)", async () => {
		const buffer = Buffer.from("just some text, not a pdf");
		const result = await validateFileContent(buffer, "application/pdf");
		expect(result.valid).toBe(false);
	});

	it("detects the pdf signature via getFileSignature", () => {
		expect(getFileSignature(Buffer.from("%PDF-1.7\n"))).toBe("pdf");
	});
});

describe("validateTextContent (markdown / plain text)", () => {
	it("accepts UTF-8 markdown", () => {
		const result = validateTextContent(
			Buffer.from("# Judul\n\nIsi dokumen dengan émoji 🐫."),
		);
		expect(result.valid).toBe(true);
		expect(result.detectedType).toBe("text");
	});

	it("rejects an empty buffer", () => {
		const result = validateTextContent(Buffer.alloc(0));
		expect(result.valid).toBe(false);
	});

	it("rejects buffers with NUL bytes", () => {
		const result = validateTextContent(Buffer.from("hello\x00world"));
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/binary content/);
	});

	it("rejects known binary signatures (PNG magic)", () => {
		const png = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.from("rest"),
		]);
		const result = validateTextContent(png);
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/content does not match/);
	});

	it("rejects ELF executables renamed to .md", () => {
		const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
		const result = validateTextContent(elf);
		expect(result.valid).toBe(false);
	});

	it("rejects invalid UTF-8", () => {
		const result = validateTextContent(Buffer.from([0xff, 0xfe, 0xc3, 0x28]));
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/UTF-8/);
	});
});
