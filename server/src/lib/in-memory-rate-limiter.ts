interface RateLimitEntry {
	count: number;
	expiresAt: number;
}

interface CheckResult {
	isLocked: boolean;
	remainingAttempts: number;
}

export class InMemoryRateLimiter {
	private store = new Map<string, RateLimitEntry>();
	private windowMs: number;
	private maxAttempts: number;
	private cleanupInterval: NodeJS.Timeout;

	constructor(options: { windowMs: number; maxAttempts: number }) {
		this.windowMs = options.windowMs;
		this.maxAttempts = options.maxAttempts;
		this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
	}

	async checkAndRecord(key: string): Promise<CheckResult> {
		const now = Date.now();
		const entry = this.store.get(key);

		if (!entry || entry.expiresAt < now) {
			this.store.set(key, {
				count: 1,
				expiresAt: now + this.windowMs,
			});
			return {
				isLocked: false,
				remainingAttempts: this.maxAttempts - 1,
			};
		}

		entry.count++;

		return {
			isLocked: entry.count > this.maxAttempts,
			remainingAttempts: Math.max(0, this.maxAttempts - entry.count),
		};
	}

	async peek(key: string): Promise<CheckResult> {
		const now = Date.now();
		const entry = this.store.get(key);

		if (!entry || entry.expiresAt < now) {
			return { isLocked: false, remainingAttempts: this.maxAttempts };
		}

		return {
			isLocked: entry.count > this.maxAttempts,
			remainingAttempts: Math.max(0, this.maxAttempts - entry.count),
		};
	}

	async clear(key: string): Promise<void> {
		this.store.delete(key);
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.store.entries()) {
			if (entry.expiresAt < now) {
				this.store.delete(key);
			}
		}
	}

	destroy(): void {
		clearInterval(this.cleanupInterval);
		this.store.clear();
	}
}
