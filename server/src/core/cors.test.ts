import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOriginValidator } from "./cors.js";

describe("createOriginValidator", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.stubEnv("NODE_ENV", "development");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		process.env = { ...originalEnv };
	});

	/** Helper: call the validator and capture the boolean passed to callback. */
	function callValidator(
		validator: ReturnType<typeof createOriginValidator>,
		origin: string | undefined,
	): boolean {
		let result = false;
		validator(origin, (_err, allow) => {
			result = allow ?? false;
		});
		return result;
	}

	it("allows localhost:5173 by default in development", () => {
		const validator = createOriginValidator();
		expect(callValidator(validator, "http://localhost:5173")).toBe(true);
	});

	it("rejects unknown origins in development with default config", () => {
		const validator = createOriginValidator();
		expect(callValidator(validator, "http://evil.com")).toBe(false);
	});

	it("allows origins from CORS_ORIGIN env var", () => {
		vi.stubEnv("CORS_ORIGIN", "https://app.example.com");
		const validator = createOriginValidator();
		expect(callValidator(validator, "https://app.example.com")).toBe(true);
	});

	it("supports comma-separated origins", () => {
		vi.stubEnv("CORS_ORIGIN", "https://a.com,https://b.com");
		const validator = createOriginValidator();
		expect(callValidator(validator, "https://a.com")).toBe(true);
		expect(callValidator(validator, "https://b.com")).toBe(true);
		expect(callValidator(validator, "https://c.com")).toBe(false);
	});

	it("trims whitespace from origins", () => {
		vi.stubEnv("CORS_ORIGIN", " https://a.com , https://b.com ");
		const validator = createOriginValidator();
		expect(callValidator(validator, "https://a.com")).toBe(true);
		expect(callValidator(validator, "https://b.com")).toBe(true);
	});

	it("rejects when origin header is missing", () => {
		const validator = createOriginValidator();
		expect(callValidator(validator, undefined)).toBe(false);
	});

	it("in production with no CORS_ORIGIN, denies all and warns", () => {
		vi.stubEnv("NODE_ENV", "production");
		delete process.env.CORS_ORIGIN;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const validator = createOriginValidator();
		expect(callValidator(validator, "https://app.example.com")).toBe(false);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("CORS_ORIGIN"),
		);
		warnSpy.mockRestore();
	});

	it("in production with CORS_ORIGIN set, allows listed origins", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("CORS_ORIGIN", "https://app.example.com");
		const validator = createOriginValidator();
		expect(callValidator(validator, "https://app.example.com")).toBe(true);
		expect(callValidator(validator, "https://evil.com")).toBe(false);
	});
});
