import { resetChatLimitForTesting } from "../../../lib/chat-rate-limit.js";
import { InMemoryRateLimiter } from "../../../lib/in-memory-rate-limiter.js";

// Chat limiting is shared with the AI Chat page and lives in lib; re-exported
// here so ticket-intake callers keep one import.
export { checkChatLimit, peekChatLimit } from "../../../lib/chat-rate-limit.js";

const SUBMIT_WINDOW_MS = 5 * 60 * 1000;

function createSubmitLimiter() {
	return new InMemoryRateLimiter({
		windowMs: SUBMIT_WINDOW_MS,
		maxAttempts: 1,
	});
}

let submitLimiter = createSubmitLimiter();

export function resetRateLimitsForTesting(): void {
	submitLimiter.destroy();
	submitLimiter = createSubmitLimiter();
	resetChatLimitForTesting();
}

export async function peekSubmitLimit(
	userId: number,
): Promise<{ isLocked: boolean; retryAfterMs?: number }> {
	const peek = await submitLimiter.peek(String(userId));
	return {
		isLocked: peek.isLocked || peek.remainingAttempts <= 0,
		...(peek.retryAfterMs !== undefined
			? { retryAfterMs: peek.retryAfterMs }
			: {}),
	};
}

export async function recordSubmitSuccess(userId: number): Promise<void> {
	await submitLimiter.checkAndRecord(String(userId));
}
