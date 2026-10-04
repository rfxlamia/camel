import { InMemoryRateLimiter } from "./in-memory-rate-limiter.js";

// One limiter shared by every chat entry point (AI Chat page and ticket-intake
// chat), so the per-user budget is global. Lives in lib so neither module has
// to import the other for it.
const CHAT_WINDOW_MS = 10 * 1000;

function createChatLimiter() {
	return new InMemoryRateLimiter({ windowMs: CHAT_WINDOW_MS, maxAttempts: 1 });
}

let chatLimiter = createChatLimiter();

export function resetChatLimitForTesting(): void {
	chatLimiter.destroy();
	chatLimiter = createChatLimiter();
}

export async function peekChatLimit(
	userId: number,
): Promise<{ isLocked: boolean; retryAfterMs?: number }> {
	const peek = await chatLimiter.peek(String(userId));
	return {
		isLocked: peek.remainingAttempts <= 0,
		...(peek.retryAfterMs !== undefined
			? { retryAfterMs: peek.retryAfterMs }
			: {}),
	};
}

export async function checkChatLimit(userId: number) {
	return chatLimiter.checkAndRecord(String(userId));
}
