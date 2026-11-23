import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/redis.js", () => ({
	getRedisClient: vi.fn(() => null),
}));

import {
	checkAndRecordLoginAttempt,
	checkAndRecordPasswordChangeAttempt,
	clearPasswordChangeFailures,
	isLoginLockedOut,
	isPasswordChangeLockedOut,
} from "./login-limiter.js";

describe("Auth Redis Fallback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should use in-memory limiter when Redis unavailable", async () => {
		for (let i = 0; i < 5; i++) {
			const result = await checkAndRecordLoginAttempt("testuser");
			expect(result).toBe(false);
		}

		const result = await checkAndRecordLoginAttempt("testuser");
		expect(result).toBe(true);
	});

	it("should report locked out after exceeding limit", async () => {
		for (let i = 0; i < 6; i++) {
			await checkAndRecordLoginAttempt("testuser");
		}

		const result = await isLoginLockedOut("testuser");
		expect(result).toBe(true);
	});

	it("locks password changes once the failure budget is spent", async () => {
		const userId = 4242;
		await clearPasswordChangeFailures(userId);
		for (let i = 0; i < 5; i++) {
			expect(await checkAndRecordPasswordChangeAttempt(userId)).toBe(false);
		}

		// The next guess must already be locked. Peek used to report open
		// until a sixth failure, so a correct password still went through.
		expect(await isPasswordChangeLockedOut(userId)).toBe(true);
		await clearPasswordChangeFailures(userId);
	});
});
