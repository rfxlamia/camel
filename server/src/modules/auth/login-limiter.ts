import { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient } from "../../db/redis.js";
import { InMemoryRateLimiter } from "../../lib/in-memory-rate-limiter.js";

// ---- Rate limiting ----------------------------------------------------------

const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_FAILURE_MAX = 5; // max failures per username per window
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const AUTH_RATE_LIMIT_MAX = 100; // max requests per IP per window

const RATE_LIMIT_PREFIX = "ratelimit:login:";
const RATE_LIMIT_PASSWORD_CHANGE_PREFIX = "ratelimit:password-change:";

// In-memory fallback limiters for when Redis is unavailable.
// The password-change limiter must stay a separate instance: its keys are user
// ids, which would collide with all-numeric usernames in the login limiter.
const IN_MEMORY_LOGIN_LIMITER = new InMemoryRateLimiter({
	windowMs: LOGIN_FAILURE_WINDOW_MS,
	maxAttempts: LOGIN_FAILURE_MAX,
});
const IN_MEMORY_PASSWORD_CHANGE_LIMITER = new InMemoryRateLimiter({
	windowMs: LOGIN_FAILURE_WINDOW_MS,
	maxAttempts: LOGIN_FAILURE_MAX,
});

// ---- Shared per-subject failure tracking ------------------------------------
// Redis-backed, falling back in-memory (fail-closed) when Redis is down.

async function isLockedOut(
	prefix: string,
	subjectKey: string,
	fallback: InMemoryRateLimiter,
	max: number,
): Promise<boolean> {
	const client = getRedisClient();
	if (!client) {
		const result = await fallback.peek(subjectKey);
		return result.isLocked;
	}

	try {
		const count = await client.get(`${prefix}${subjectKey}`);
		return count !== null && Number.parseInt(count, 10) >= max;
	} catch {
		// Fail-closed: use in-memory limiter when Redis errors
		const result = await fallback.peek(subjectKey);
		return result.isLocked;
	}
}

/**
 * Atomically check and record a failed attempt for a subject.
 * Uses INCR to avoid TOCTOU race conditions.
 */
async function checkAndRecordAttempt(
	prefix: string,
	subjectKey: string,
	fallback: InMemoryRateLimiter,
	max: number,
	windowSeconds: number,
): Promise<boolean> {
	const client = getRedisClient();
	if (!client) {
		// Fail-closed: use in-memory limiter
		const result = await fallback.checkAndRecord(subjectKey);
		return result.isLocked;
	}

	try {
		const key = `${prefix}${subjectKey}`;
		const count = await client.incr(key);
		if (count === 1) {
			await client.expire(key, windowSeconds);
		}
		return count > max;
	} catch {
		// Fail-closed: use in-memory limiter when Redis errors
		const result = await fallback.checkAndRecord(subjectKey);
		return result.isLocked;
	}
}

/**
 * Clear the failure count for a subject (call on success).
 * Clears from both the in-memory limiter and Redis (best-effort).
 */
async function clearFailures(
	prefix: string,
	subjectKey: string,
	fallback: InMemoryRateLimiter,
): Promise<void> {
	await fallback.clear(subjectKey);

	const client = getRedisClient();
	if (!client) return;

	try {
		await client.del(`${prefix}${subjectKey}`);
	} catch {
		// best-effort
	}
}

// ---- Login (keyed by username) ----------------------------------------------

/** Check if a username is currently locked out due to too many failed logins. */
export async function isLoginLockedOut(username: string): Promise<boolean> {
	return isLockedOut(
		RATE_LIMIT_PREFIX,
		username.toLowerCase(),
		IN_MEMORY_LOGIN_LIMITER,
		LOGIN_FAILURE_MAX,
	);
}

/**
 * Atomically check and record a login attempt for a username.
 * Returns true if the account is now locked out, false otherwise.
 */
export async function checkAndRecordLoginAttempt(
	username: string,
): Promise<boolean> {
	return checkAndRecordAttempt(
		RATE_LIMIT_PREFIX,
		username.toLowerCase(),
		IN_MEMORY_LOGIN_LIMITER,
		LOGIN_FAILURE_MAX,
		LOGIN_FAILURE_WINDOW_MS / 1000,
	);
}

/** Clear login failure count for a username (call on successful login). */
export async function clearLoginFailures(username: string): Promise<void> {
	return clearFailures(
		RATE_LIMIT_PREFIX,
		username.toLowerCase(),
		IN_MEMORY_LOGIN_LIMITER,
	);
}

// ---- Change-password (keyed by user id) -------------------------------------

/** Check if a user is locked out of change-password after repeated failures. */
export async function isPasswordChangeLockedOut(
	userId: number,
): Promise<boolean> {
	return isLockedOut(
		RATE_LIMIT_PASSWORD_CHANGE_PREFIX,
		String(userId),
		IN_MEMORY_PASSWORD_CHANGE_LIMITER,
		LOGIN_FAILURE_MAX,
	);
}

/**
 * Atomically check and record a failed change-password attempt for a user.
 * Returns true if the user is now locked out, false otherwise.
 */
export async function checkAndRecordPasswordChangeAttempt(
	userId: number,
): Promise<boolean> {
	return checkAndRecordAttempt(
		RATE_LIMIT_PASSWORD_CHANGE_PREFIX,
		String(userId),
		IN_MEMORY_PASSWORD_CHANGE_LIMITER,
		LOGIN_FAILURE_MAX,
		LOGIN_FAILURE_WINDOW_MS / 1000,
	);
}

/** Clear change-password failure count for a user (call on success). */
export async function clearPasswordChangeFailures(
	userId: number,
): Promise<void> {
	return clearFailures(
		RATE_LIMIT_PASSWORD_CHANGE_PREFIX,
		String(userId),
		IN_MEMORY_PASSWORD_CHANGE_LIMITER,
	);
}

/**
 * Create the IP-scoped rate limiter for auth endpoints.
 * Uses more restrictive limits when Redis is unavailable (fail-closed).
 */
export function createAuthRateLimiter() {
	const client = getRedisClient();
	if (!client) {
		// Fail-closed: use more restrictive limits with in-memory store
		return rateLimit({
			windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
			max: Math.floor(AUTH_RATE_LIMIT_MAX / 2), // More restrictive when Redis is down
			standardHeaders: true,
			legacyHeaders: false,
			message: { error: "Too many requests — please try again later." },
		});
	}

	return rateLimit({
		windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
		max: AUTH_RATE_LIMIT_MAX,
		standardHeaders: true,
		legacyHeaders: false,
		passOnStoreError: true,
		store: new RedisStore({
			sendCommand: (...args: string[]) => client.sendCommand(args),
			prefix: "ratelimit:auth:ip:",
		}),
		message: { error: "Too many requests — please try again later." },
	});
}

/**
 * Middleware that atomically checks and records login attempts.
 * Returns 429 if the username has exceeded the failure limit.
 * Uses atomic INCR to prevent TOCTOU race conditions.
 */
export async function accountLockoutMiddleware(
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> {
	const { username } = req.body ?? {};
	if (typeof username !== "string") {
		next();
		return;
	}

	const isLockedOutResult = await checkAndRecordLoginAttempt(username);
	if (isLockedOutResult) {
		res.status(429).json({
			error: "Too many failed login attempts — please try again later.",
		});
		return;
	}

	next();
}
