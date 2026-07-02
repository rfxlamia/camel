import { InMemoryRateLimiter } from "../../lib/in-memory-rate-limiter.js";

const SUBMIT_WINDOW_MS = 5 * 60 * 1000;
const CHAT_WINDOW_MS = 10 * 1000;

function createLimiters() {
	return {
		submit: new InMemoryRateLimiter({
			windowMs: SUBMIT_WINDOW_MS,
			maxAttempts: 1,
		}),
		chat: new InMemoryRateLimiter({
			windowMs: CHAT_WINDOW_MS,
			maxAttempts: 1,
		}),
	};
}

let { submit: submitLimiter, chat: chatLimiter } = createLimiters();

export function resetRateLimitsForTesting(): void {
	submitLimiter.destroy();
	chatLimiter.destroy();
	({ submit: submitLimiter, chat: chatLimiter } = createLimiters());
}

export async function peekSubmitLimit(
	userId: number,
): Promise<{ isLocked: boolean; retryAfterMs?: number }> {
	const peek = await submitLimiter.peek(String(userId));
	return {
		isLocked: peek.isLocked || peek.remainingAttempts <= 0,
		...(peek.retryAfterMs !== undefined ? { retryAfterMs: peek.retryAfterMs } : {}),
	};
}

export async function peekChatLimit(
	userId: number,
): Promise<{ isLocked: boolean; retryAfterMs?: number }> {
	const peek = await chatLimiter.peek(String(userId));
	return {
		isLocked: peek.remainingAttempts <= 0,
		...(peek.retryAfterMs !== undefined ? { retryAfterMs: peek.retryAfterMs } : {}),
	};
}

export async function recordSubmitSuccess(userId: number): Promise<void> {
	await submitLimiter.checkAndRecord(String(userId));
}

export async function checkChatLimit(userId: number) {
	return chatLimiter.checkAndRecord(String(userId));
}
