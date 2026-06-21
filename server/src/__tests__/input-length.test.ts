import { describe, it, expect } from "vitest";
import {
	validateCardTitle,
	validateCardDescription,
	validateBoardName,
	validateDisplayName,
	validateUsername,
} from "../validators/input-length.js";

describe("Input Length Validation", () => {
	describe("validateCardTitle", () => {
		it("should accept valid title", () => {
			const result = validateCardTitle("My Task");
			expect(result.valid).toBe(true);
			expect(result.trimmed).toBe("My Task");
		});

		it("should reject empty title", () => {
			const result = validateCardTitle("");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("required");
		});

		it("should reject title exceeding max length", () => {
			const longTitle = "a".repeat(256);
			const result = validateCardTitle(longTitle);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("255");
		});

		it("should accept title at max length", () => {
			const maxTitle = "a".repeat(255);
			const result = validateCardTitle(maxTitle);
			expect(result.valid).toBe(true);
		});

		it("should trim whitespace", () => {
			const result = validateCardTitle("  My Task  ");
			expect(result.valid).toBe(true);
			expect(result.trimmed).toBe("My Task");
		});
	});

	describe("validateCardDescription", () => {
		it("should accept valid description", () => {
			const result = validateCardDescription("This is a description");
			expect(result.valid).toBe(true);
		});

		it("should accept empty description", () => {
			const result = validateCardDescription("");
			expect(result.valid).toBe(true);
		});

		it("should reject description exceeding max length", () => {
			const longDesc = "a".repeat(10001);
			const result = validateCardDescription(longDesc);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("10000");
		});
	});

	describe("validateBoardName", () => {
		it("should accept valid board name", () => {
			const result = validateBoardName("My Board");
			expect(result.valid).toBe(true);
			expect(result.trimmed).toBe("My Board");
		});

		it("should reject empty board name", () => {
			const result = validateBoardName("");
			expect(result.valid).toBe(false);
		});

		it("should reject board name exceeding max length", () => {
			const longName = "a".repeat(101);
			const result = validateBoardName(longName);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("100");
		});
	});

	describe("validateDisplayName", () => {
		it("should accept valid display name", () => {
			const result = validateDisplayName("John Doe");
			expect(result.valid).toBe(true);
		});

		it("should reject display name exceeding max length", () => {
			const longName = "a".repeat(51);
			const result = validateDisplayName(longName);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("50");
		});
	});

	describe("validateUsername", () => {
		it("should accept valid username", () => {
			const result = validateUsername("john_doe");
			expect(result.valid).toBe(true);
		});

		it("should reject username exceeding max length", () => {
			const longUsername = "a".repeat(33);
			const result = validateUsername(longUsername);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("32");
		});

		it("should reject username below min length", () => {
			const result = validateUsername("ab");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("3");
		});
	});
});
