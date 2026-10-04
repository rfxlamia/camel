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

// In-memory fallback limiter for when Redis is unavailable
const IN_MEMORY_LOGIN_LIMITER = new InMemoryRateLimiter({
	windowMs: LOGIN_FAILURE_WINDOW_MS,
	maxAttempts: LOGIN_FAILURE_MAX,
});

/**
 * Check if a username is currently locked out due to too many failed login attempts.
 * Returns true if locked out, false otherwise.
 * Fails closed (returns true) if Redis is unavailable and in-memory limit exceeded.
 */
export async function isLoginLockedOut(username: string): Promise<boolean> {
	const client = getRedisClient();
	if (!client) {
		// Fail-closed: use in-memory limiter
		const result = await IN_MEMORY_LOGIN_LIMITER.peek(username.toLowerCase());
		return result.isLocked;
	}

	try {
		const key = `${RATE_LIMIT_PREFIX}${username.toLowerCase()}`;
		const count = await client.get(key);
		return count !== null && Number.parseInt(count, 10) >= LOGIN_FAILURE_MAX;
	} catch {
		// Fail-closed: use in-memory limiter when Redis errors
		const result = await IN_MEMORY_LOGIN_LIMITER.peek(username.toLowerCase());
		return result.isLocked;
	}
}

/**
 * Atomically check and record a login attempt for a username.
 * Returns true if the account is now locked out, false otherwise.
 * Uses INCR to avoid TOCTOU race conditions.
 * Fails closed if Redis is unavailable (uses in-memory fallback).
 */
export async function checkAndRecordLoginAttempt(
	username: string,
): Promise<boolean> {
	const client = getRedisClient();
	if (!client) {
		// Fail-closed: use in-memory limiter
		const result = await IN_MEMORY_LOGIN_LIMITER.checkAndRecord(
			username.toLowerCase(),
		);
		return result.isLocked;
	}

	try {
		const key = `${RATE_LIMIT_PREFIX}${username.toLowerCase()}`;
		const count = await client.incr(key);
		if (count === 1) {
			await client.expire(key, LOGIN_FAILURE_WINDOW_MS / 1000);
		}
		return count > LOGIN_FAILURE_MAX;
	} catch {
		// Fail-closed: use in-memory limiter when Redis errors
		const result = await IN_MEMORY_LOGIN_LIMITER.checkAndRecord(
			username.toLowerCase(),
		);
		return result.isLocked;
	}
}

/**
 * Clear login failure count for a username (call on successful login).
 * Clears from both Redis and in-memory limiter.
 */
export async function clearLoginFailures(username: string): Promise<void> {
	const normalizedUsername = username.toLowerCase();

	// Always clear from in-memory limiter
	await IN_MEMORY_LOGIN_LIMITER.clear(normalizedUsername);

	const client = getRedisClient();
	if (!client) return;

	try {
		await client.del(`${RATE_LIMIT_PREFIX}${normalizedUsername}`);
	} catch {
		// best-effort
	}
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

	const isLockedOut = await checkAndRecordLoginAttempt(username);
	if (isLockedOut) {
		res.status(429).json({
			error: "Too many failed login attempts — please try again later.",
		});
		return;
	}

	next();
}
