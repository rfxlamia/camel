import { describe, it, expect, vi } from "vitest";
import {
	sanitizeError,
	createErrorHandler,
} from "../middleware/error-handler.js";

describe("Error Sanitization", () => {
	describe("sanitizeError", () => {
		it("should sanitize database errors", () => {
			const dbError = new Error('relation "users" does not exist');
			const sanitized = sanitizeError(dbError);
			expect(sanitized.message).not.toContain('relation "users"');
			expect(sanitized.message).toContain("internal server error");
		});

		it("should sanitize file system errors", () => {
			const fsError = new Error(
				"ENOENT: no such file or directory, open '/etc/passwd'",
			);
			const sanitized = sanitizeError(fsError);
			expect(sanitized.message).not.toContain("/etc/passwd");
			expect(sanitized.message).toContain("internal server error");
		});

		it("should sanitize network errors", () => {
			const networkError = new Error("connect ECONNREFUSED 127.0.0.1:5432");
			const sanitized = sanitizeError(networkError);
			expect(sanitized.message).not.toContain("127.0.0.1:5432");
			expect(sanitized.message).toContain("internal server error");
		});

		it("should preserve user-facing validation errors", () => {
			const validationError = new Error("Username must be 3-32 characters");
			const sanitized = sanitizeError(validationError);
			expect(sanitized.message).toBe("Username must be 3-32 characters");
		});

		it("should handle errors without messages", () => {
			const error = new Error();
			const sanitized = sanitizeError(error);
			expect(sanitized.message).toBe("internal server error");
		});
	});

	describe("createErrorHandler", () => {
		it("should return generic error for 500 errors", () => {
			const handler = createErrorHandler();
			const req = { get: vi.fn() } as any;
			const res = {
				status: vi.fn().mockReturnThis(),
				json: vi.fn(),
			} as any;
			const next = vi.fn();

			const error = new Error("Database connection failed");
			handler(error, req, res, next);

			expect(res.status).toHaveBeenCalledWith(500);
			expect(res.json).toHaveBeenCalledWith({
				error: "internal server error",
			});
		});

		it("should preserve status code for known errors", () => {
			const handler = createErrorHandler();
			const req = { get: vi.fn() } as any;
			const res = {
				status: vi.fn().mockReturnThis(),
				json: vi.fn(),
			} as any;
			const next = vi.fn();

			const error = new Error("Not found") as any;
			error.statusCode = 404;
			handler(error, req, res, next);

			expect(res.status).toHaveBeenCalledWith(404);
			expect(res.json).toHaveBeenCalledWith({
				error: "Not found",
			});
		});

		it("should log detailed errors server-side", () => {
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const handler = createErrorHandler();
			const req = { get: vi.fn() } as any;
			const res = {
				status: vi.fn().mockReturnThis(),
				json: vi.fn(),
			} as any;
			const next = vi.fn();

			const error = new Error("Sensitive database error");
			handler(error, req, res, next);

			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});
	});
});
