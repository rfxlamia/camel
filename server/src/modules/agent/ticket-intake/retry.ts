/**
 * Exponential-backoff retry executor for transient HTTP/network failures.
 *
 * Pure, dependency-injectable module — no Express or DB coupling.
 * Classifies failures as retryable (500+ / network) vs non-retryable (400–499).
 */

export const DEFAULT_MAX_ATTEMPTS = 10;
export const DEFAULT_INITIAL_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 60_000;

export interface RetryFailure {
	retryable: boolean;
	status?: number;
	message: string;
}

export class RetryError extends Error implements RetryFailure {
	retryable: boolean;
	status?: number;

	constructor(message: string, retryable: boolean, status?: number) {
		super(message);
		this.name = "RetryError";
		this.retryable = retryable;
		this.status = status;
	}
}

export interface ExecuteWithRetryOptions {
	maxAttempts?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	sleepFn?: (ms: number) => Promise<void>;
}

function getStatus(error: unknown): number | undefined {
	if (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof (error as { status: unknown }).status === "number"
	) {
		return (error as { status: number }).status;
	}
	return undefined;
}

function isNetworkError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error.name === "TypeError") return true;
	const message = error.message.toLowerCase();
	return (
		message.includes("fetch failed") ||
		message.includes("network") ||
		message.includes("econnreset") ||
		message.includes("etimedout")
	);
}

export function classifyFailure(error: unknown): RetryFailure {
	const status = getStatus(error);
	const message = error instanceof Error ? error.message : String(error);

	if (status !== undefined) {
		if (status >= 500) {
			return { retryable: true, status, message };
		}
		if (status >= 400) {
			return { retryable: false, status, message };
		}
	}

	if (isNetworkError(error)) {
		return { retryable: true, message };
	}

	return { retryable: false, message };
}

function computeDelayMs(
	attemptIndex: number,
	initialDelayMs: number,
	maxDelayMs: number,
): number {
	const delay = initialDelayMs * 2 ** attemptIndex;
	return Math.min(delay, maxDelayMs);
}

const defaultSleepFn = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export async function executeWithRetry<T>(
	fn: () => Promise<T>,
	options: ExecuteWithRetryOptions = {},
): Promise<T> {
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
	const sleepFn = options.sleepFn ?? defaultSleepFn;

	let lastFailure: RetryFailure | null = null;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			const failure = classifyFailure(error);
			lastFailure = failure;

			if (!failure.retryable) {
				const err = new Error(failure.message, { cause: error }) as RetryError;
				err.name = "RetryError";
				err.retryable = false;
				err.status = failure.status;
				throw err;
			}

			if (attempt < maxAttempts - 1) {
				const delayMs = computeDelayMs(attempt, initialDelayMs, maxDelayMs);
				await sleepFn(delayMs);
			}
		}
	}

	const failure = lastFailure ?? {
		retryable: true,
		message: "Max retry attempts exceeded",
	};
	throw new RetryError(failure.message, failure.retryable, failure.status);
}
