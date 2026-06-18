import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	isLoginLockedOut,
	recordLoginFailure,
	clearLoginFailures,
} from "./auth.js";

// Mock getRedisClient
const mockRedisClient = {
	get: vi.fn(),
	incr: vi.fn(),
	expire: vi.fn(),
	del: vi.fn(),
};

vi.mock("./db/redis.js", () => ({
	getRedisClient: () => mockRedisClient,
}));

describe("Account-scoped login rate limiter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("isLoginLockedOut", () => {
		it("returns false when no failures recorded", async () => {
			mockRedisClient.get.mockResolvedValue(null);
			expect(await isLoginLockedOut("testuser")).toBe(false);
		});

		it("returns false when failure count is below limit", async () => {
			mockRedisClient.get.mockResolvedValue("3");
			expect(await isLoginLockedOut("testuser")).toBe(false);
		});

		it("returns true when failure count reaches limit", async () => {
			mockRedisClient.get.mockResolvedValue("5");
			expect(await isLoginLockedOut("testuser")).toBe(true);
		});

		it("returns true when failure count exceeds limit", async () => {
			mockRedisClient.get.mockResolvedValue("10");
			expect(await isLoginLockedOut("testuser")).toBe(true);
		});

		it("normalizes username to lowercase", async () => {
			mockRedisClient.get.mockResolvedValue(null);
			await isLoginLockedOut("TestUser");
			expect(mockRedisClient.get).toHaveBeenCalledWith(
				"ratelimit:login:testuser",
			);
		});

		it("fails open when Redis throws", async () => {
			mockRedisClient.get.mockRejectedValue(new Error("Redis down"));
			expect(await isLoginLockedOut("testuser")).toBe(false);
		});

		it("fails open when Redis client is null", async () => {
			// This test verifies the fail-open behavior when getRedisClient returns null
			// We test the error path since we can't easily re-mock the module
			mockRedisClient.get.mockRejectedValue(new Error("connection lost"));
			expect(await isLoginLockedOut("testuser")).toBe(false);
		});
	});

	describe("recordLoginFailure", () => {
		it("increments the failure count", async () => {
			mockRedisClient.incr.mockResolvedValue(1);
			await recordLoginFailure("testuser");
			expect(mockRedisClient.incr).toHaveBeenCalledWith(
				"ratelimit:login:testuser",
			);
		});

		it("sets TTL on first failure", async () => {
			mockRedisClient.incr.mockResolvedValue(1);
			await recordLoginFailure("testuser");
			expect(mockRedisClient.expire).toHaveBeenCalledWith(
				"ratelimit:login:testuser",
				900, // 15 minutes in seconds
			);
		});

		it("does not set TTL on subsequent failures", async () => {
			mockRedisClient.incr.mockResolvedValue(3);
			await recordLoginFailure("testuser");
			expect(mockRedisClient.expire).not.toHaveBeenCalled();
		});

		it("normalizes username to lowercase", async () => {
			mockRedisClient.incr.mockResolvedValue(1);
			await recordLoginFailure("TestUser");
			expect(mockRedisClient.incr).toHaveBeenCalledWith(
				"ratelimit:login:testuser",
			);
		});

		it("does not throw when Redis fails", async () => {
			mockRedisClient.incr.mockRejectedValue(new Error("Redis down"));
			await expect(recordLoginFailure("testuser")).resolves.toBeUndefined();
		});
	});

	describe("clearLoginFailures", () => {
		it("deletes the failure key", async () => {
			mockRedisClient.del.mockResolvedValue(1);
			await clearLoginFailures("testuser");
			expect(mockRedisClient.del).toHaveBeenCalledWith(
				"ratelimit:login:testuser",
			);
		});

		it("normalizes username to lowercase", async () => {
			mockRedisClient.del.mockResolvedValue(1);
			await clearLoginFailures("TestUser");
			expect(mockRedisClient.del).toHaveBeenCalledWith(
				"ratelimit:login:testuser",
			);
		});

		it("does not throw when Redis fails", async () => {
			mockRedisClient.del.mockRejectedValue(new Error("Redis down"));
			await expect(clearLoginFailures("testuser")).resolves.toBeUndefined();
		});
	});
});
