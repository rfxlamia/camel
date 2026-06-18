import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	checkAndRecordLoginAttempt,
	clearLoginFailures,
	createSignupWorkspacePlan,
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

describe("createSignupWorkspacePlan", () => {
	it("creates a personal workspace owned by the new user", () => {
		const plan = createSignupWorkspacePlan({
			user: { id: 4, username: "dave", displayName: "Dave" },
			pendingInvites: [],
		});
		expect(plan.personalWorkspace).toEqual({
			name: "Dave's Workspace",
			ownerUserId: 4,
			isPersonal: true,
		});
		expect(plan.memberships).toEqual([
			{ userId: 4, role: "owner", personal: true },
		]);
		expect(plan.pendingInvites).toEqual([]);
		expect(plan.consumedInviteIds).toEqual([]);
	});

	it("includes pending invites in the plan", () => {
		const plan = createSignupWorkspacePlan({
			user: { id: 1, username: "alice", displayName: "Alice" },
			pendingInvites: [
				{ id: 10, workspaceId: 100, username: "alice", role: "member" },
			],
		});
		expect(plan.pendingInvites).toHaveLength(1);
		expect(plan.pendingInvites[0].workspaceId).toBe(100);
	});
});

describe("Account-scoped login rate limiter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("checkAndRecordLoginAttempt", () => {
		it("returns false when count is below limit", async () => {
			mockRedisClient.incr.mockResolvedValue(3);
			expect(await checkAndRecordLoginAttempt("testuser")).toBe(false);
		});

		it("returns false when count reaches limit exactly", async () => {
			mockRedisClient.incr.mockResolvedValue(5);
			expect(await checkAndRecordLoginAttempt("testuser")).toBe(false);
		});

		it("returns true when count exceeds limit", async () => {
			mockRedisClient.incr.mockResolvedValue(6);
			expect(await checkAndRecordLoginAttempt("testuser")).toBe(true);
		});

		it("sets TTL on first failure (count === 1)", async () => {
			mockRedisClient.incr.mockResolvedValue(1);
			await checkAndRecordLoginAttempt("testuser");
			expect(mockRedisClient.expire).toHaveBeenCalledWith(
				"ratelimit:login:testuser",
				900, // 15 minutes in seconds
			);
		});

		it("does not set TTL on subsequent failures", async () => {
			mockRedisClient.incr.mockResolvedValue(3);
			await checkAndRecordLoginAttempt("testuser");
			expect(mockRedisClient.expire).not.toHaveBeenCalled();
		});

		it("normalizes username to lowercase", async () => {
			mockRedisClient.incr.mockResolvedValue(1);
			await checkAndRecordLoginAttempt("TestUser");
			expect(mockRedisClient.incr).toHaveBeenCalledWith(
				"ratelimit:login:testuser",
			);
		});

		it("fails open when Redis throws", async () => {
			mockRedisClient.incr.mockRejectedValue(new Error("Redis down"));
			expect(await checkAndRecordLoginAttempt("testuser")).toBe(false);
		});

		it("uses atomic INCR to prevent TOCTOU race condition", async () => {
			// Verify INCR is used (not GET + INCR separately)
			mockRedisClient.incr.mockResolvedValue(6);
			await checkAndRecordLoginAttempt("testuser");
			expect(mockRedisClient.incr).toHaveBeenCalledOnce();
			expect(mockRedisClient.get).not.toHaveBeenCalled();
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
