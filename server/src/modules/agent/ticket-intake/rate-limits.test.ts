import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkChatLimit,
	peekSubmitLimit,
	recordSubmitSuccess,
	resetRateLimitsForTesting,
} from "./rate-limits.js";

describe("ticket-intake rate limits", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetRateLimitsForTesting();
	});

	afterEach(() => {
		resetRateLimitsForTesting();
		vi.useRealTimers();
	});

	describe("submit limit", () => {
		const userId = 42;

		it("returns unlocked when user has never submitted", async () => {
			expect(await peekSubmitLimit(userId)).toEqual({ isLocked: false });
		});

		it("stays unlocked when peeked without a successful submit", async () => {
			await peekSubmitLimit(userId);
			await peekSubmitLimit(userId);
			await peekSubmitLimit(userId);

			expect(await peekSubmitLimit(userId)).toEqual({ isLocked: false });
		});

		it("locks for 5 minutes after a successful submit", async () => {
			await recordSubmitSuccess(userId);

			expect(await peekSubmitLimit(userId)).toEqual({
				isLocked: true,
				retryAfterMs: expect.any(Number),
			});

			vi.advanceTimersByTime(5 * 60 * 1000 - 1);
			expect(await peekSubmitLimit(userId)).toEqual({
				isLocked: true,
				retryAfterMs: expect.any(Number),
			});

			vi.advanceTimersByTime(2);
			expect(await peekSubmitLimit(userId)).toEqual({ isLocked: false });
		});
	});

	describe("chat limit", () => {
		const userId = 7;

		it("locks the second message within 10 seconds", async () => {
			expect(await checkChatLimit(userId)).toEqual({
				isLocked: false,
				remainingAttempts: 0,
			});

			expect(await checkChatLimit(userId)).toEqual({
				isLocked: true,
				remainingAttempts: 0,
				retryAfterMs: expect.any(Number),
			});

			vi.advanceTimersByTime(10 * 1000 + 1);
			expect(await checkChatLimit(userId)).toEqual({
				isLocked: false,
				remainingAttempts: 0,
			});
		});
	});
});
