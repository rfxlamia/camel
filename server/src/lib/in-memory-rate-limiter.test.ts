import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./in-memory-rate-limiter.js";

describe("InMemoryRateLimiter", () => {
	let limiter: InMemoryRateLimiter;

	beforeEach(() => {
		limiter = new InMemoryRateLimiter({
			windowMs: 15 * 60 * 1000, // 15 minutes
			maxAttempts: 5,
		});
	});

	afterEach(() => {
		limiter.destroy();
	});

	it("should return false when under limit", async () => {
		const result = await limiter.checkAndRecord("user1");
		expect(result.isLocked).toBe(false);
		expect(result.remainingAttempts).toBe(4);
	});

	it("should return true when limit exceeded", async () => {
		for (let i = 0; i < 5; i++) {
			await limiter.checkAndRecord("user1");
		}
		const result = await limiter.checkAndRecord("user1");
		expect(result.isLocked).toBe(true);
		expect(result.remainingAttempts).toBe(0);
	});

	it("should track attempts per key separately", async () => {
		for (let i = 0; i < 3; i++) {
			await limiter.checkAndRecord("user1");
		}
		for (let i = 0; i < 3; i++) {
			await limiter.checkAndRecord("user2");
		}

		const result1 = await limiter.checkAndRecord("user1");
		const result2 = await limiter.checkAndRecord("user2");

		expect(result1.isLocked).toBe(false);
		expect(result2.isLocked).toBe(false);
	});

	it("should clear attempts for a specific key", async () => {
		for (let i = 0; i < 5; i++) {
			await limiter.checkAndRecord("user1");
		}
		await limiter.clear("user1");
		const result = await limiter.checkAndRecord("user1");
		expect(result.isLocked).toBe(false);
		expect(result.remainingAttempts).toBe(4);
	});

	it("peek should report lock state WITHOUT recording an attempt", async () => {
		for (let i = 0; i < 5; i++) {
			await limiter.checkAndRecord("user1");
		}
		expect((await limiter.peek("user1")).isLocked).toBe(false);
		expect((await limiter.peek("user1")).isLocked).toBe(false);
		expect((await limiter.checkAndRecord("user1")).isLocked).toBe(true);
		expect((await limiter.peek("user1")).isLocked).toBe(true);
		expect((await limiter.peek("user1")).isLocked).toBe(true);
	});

	it("peek returns not-locked for an unknown key", async () => {
		const result = await limiter.peek("never-seen");
		expect(result.isLocked).toBe(false);
		expect(result.remainingAttempts).toBe(5);
	});

	it("should handle concurrent requests safely", async () => {
		const promises = Array.from({ length: 10 }, () =>
			limiter.checkAndRecord("user1"),
		);
		const results = await Promise.all(promises);
		const lockedCount = results.filter((r) => r.isLocked).length;
		expect(lockedCount).toBe(5);
	});
});
