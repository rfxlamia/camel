import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
	type NextFunction,
	type Request,
	type RequestHandler,
	type Response,
	Router,
} from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { pool } from "./db/pool.js";
import { getRedisClient } from "./db/redis.js";
import { InMemoryRateLimiter } from "./lib/in-memory-rate-limiter.js";
import {
	validateDisplayName,
	validateUsername,
} from "./validators/input-length.js";

export interface AuthUser {
	id: number;
	username: string | null;
	displayName: string;
	email: string | null;
	emailVerified: boolean;
	needsUsername: boolean;
}

export interface PendingInvite {
	id: number;
	workspaceId: number;
	username: string;
	role: string;
}

export interface SignupWorkspacePlan {
	personalWorkspace: { name: string; ownerUserId: number; isPersonal: boolean };
	memberships: Array<{ userId: number; role: "owner"; personal: boolean }>;
	pendingInvites: PendingInvite[];
	consumedInviteIds: number[];
}

export function createSignupWorkspacePlan(input: {
	user: AuthUser;
	pendingInvites: PendingInvite[];
}): SignupWorkspacePlan {
	const { user, pendingInvites } = input;
	return {
		personalWorkspace: {
			name: `${user.displayName}'s Workspace`,
			ownerUserId: user.id,
			isPersonal: true,
		},
		memberships: [{ userId: user.id, role: "owner", personal: true }],
		pendingInvites,
		consumedInviteIds: [],
	};
}

declare global {
	// biome-ignore lint/style/noNamespace: Express augmentation
	namespace Express {
		interface Request {
			user?: AuthUser;
		}
	}
}

export const SESSION_COOKIE = "camel_session";
const SESSION_TTL_DAYS = 30;
export const BCRYPT_ROUNDS = 10;

export const USERNAME_RE = /^[a-z0-9_]{3,32}$/i;

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

function toUser(row: {
	id: number;
	username: string | null;
	display_name: string;
	email?: string | null;
	email_verified?: boolean;
}): AuthUser {
	return {
		id: row.id,
		username: row.username,
		displayName: row.display_name,
		email: row.email ?? null,
		emailVerified: row.email_verified ?? false,
		needsUsername: row.username === null,
	};
}

export async function mintCamelSession(
	res: Response,
	userId: number,
): Promise<void> {
	const token = randomBytes(32).toString("base64url");
	const expiresAt = new Date(
		Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
	);
	await pool.query(
		"INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
		[token, userId, expiresAt],
	);
	res.cookie(SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		expires: expiresAt,
		path: "/",
	});
}

/**
 * Rotate ONE session token: delete the presented token (if it belongs to the
 * user) and issue a fresh one in the same transaction. Returns the new token,
 * or null if the old token was not a valid session for this user.
 */
export async function rotateSessionToken(
	userId: number,
	oldToken: string,
): Promise<string | null> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		const { rows: existing } = await client.query(
			"SELECT 1 FROM sessions WHERE token = $1 AND user_id = $2",
			[oldToken, userId],
		);
		if (existing.length === 0) {
			await client.query("ROLLBACK");
			return null;
		}

		await client.query("DELETE FROM sessions WHERE token = $1", [oldToken]);

		const newToken = randomBytes(32).toString("base64url");
		const expiresAt = new Date(
			Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
		);
		await client.query(
			"INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
			[newToken, userId, expiresAt],
		);

		await client.query("COMMIT");
		return newToken;
	} catch (err) {
		await client.query("ROLLBACK");
		console.error("[auth] session rotation failed:", err);
		return null;
	} finally {
		client.release();
	}
}

/**
 * Delete expired sessions from the database.
 * Safe to call frequently — no-ops when there's nothing to clean.
 */
export async function cleanupExpiredSessions(): Promise<number> {
	try {
		const result = await pool.query(
			"DELETE FROM sessions WHERE expires_at < now()",
		);
		const count = result.rowCount ?? 0;
		if (count > 0) {
			console.log(`[auth] cleaned up ${count} expired session(s)`);
		}
		return count;
	} catch (err) {
		console.error("[auth] failed to cleanup expired sessions:", err);
		return 0;
	}
}

export async function requireAuth(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	try {
		const token = req.cookies?.[SESSION_COOKIE];
		if (!token)
			return res.status(401).json({ error: "authentication required" });
		const { rows } = await pool.query(
			`SELECT u.id, u.username, u.display_name, u.email, u.email_verified
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > now()`,
			[token],
		);
		if (rows.length === 0) {
			return res.status(401).json({ error: "session expired — sign in again" });
		}
		req.user = toUser(rows[0]);
		next();
	} catch (err) {
		next(err);
	}
}

export function createAuthRouter(rateLimiter?: RequestHandler): Router {
	const auth = Router();

	// Apply rate limiter before routes if provided
	if (rateLimiter) {
		auth.use(rateLimiter);
	}

	auth.post("/register", async (req, res) => {
		const { username, password, displayName } = req.body ?? {};
		const usernameValidation = validateUsername(username ?? "");
		if (!usernameValidation.valid) {
			return res.status(400).json({
				error:
					"Username must be 3-32 characters: letters, numbers, underscore.",
			});
		}
		if (!USERNAME_RE.test(usernameValidation.trimmed!)) {
			return res.status(400).json({
				error:
					"Username must be 3-32 characters: letters, numbers, underscore.",
			});
		}
		if (typeof password !== "string" || password.length < 8) {
			return res
				.status(400)
				.json({ error: "Password must be at least 8 characters." });
		}
		const displayNameValidation = validateDisplayName(displayName ?? "");
		if (!displayNameValidation.valid) {
			return res.status(400).json({ error: displayNameValidation.error });
		}
		const name = displayNameValidation.trimmed ?? usernameValidation.trimmed!;

		const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
		const normalizedUsername = usernameValidation.trimmed!.toLowerCase();
		const client = await pool.connect();
		try {
			await client.query("BEGIN");

			const { rows } = await client.query(
				`INSERT INTO users (username, display_name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, display_name`,
				[normalizedUsername, name, hash],
			);
			const user = toUser(rows[0]);

			const pendingRes = await client.query(
				`SELECT id, workspace_id, username, role
       FROM workspace_invites WHERE username = $1`,
				[normalizedUsername],
			);
			const pendingInvites: PendingInvite[] = pendingRes.rows.map((row) => ({
				id: row.id,
				workspaceId: row.workspace_id,
				username: row.username,
				role: row.role,
			}));

			const plan = createSignupWorkspacePlan({ user, pendingInvites });

			const wsRes = await client.query(
				`INSERT INTO workspaces (name, owner_user_id, is_personal)
       VALUES ($1, $2, $3)
       RETURNING id`,
				[
					plan.personalWorkspace.name,
					plan.personalWorkspace.ownerUserId,
					plan.personalWorkspace.isPersonal,
				],
			);
			const workspaceId = wsRes.rows[0].id;

			for (const membership of plan.memberships) {
				await client.query(
					`INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)`,
					[workspaceId, membership.userId, membership.role],
				);
			}

			await client.query("COMMIT");
			await mintCamelSession(res, user.id);
			res.status(201).json({ user });
		} catch (err) {
			await client.query("ROLLBACK");
			if ((err as { code?: string }).code === "23505") {
				return res
					.status(409)
					.json({ error: "That username's already taken — try another." });
			}
			throw err;
		} finally {
			client.release();
		}
	});

	auth.post("/login", accountLockoutMiddleware, async (req, res) => {
		const { username, password } = req.body ?? {};
		if (typeof username !== "string" || typeof password !== "string") {
			return res
				.status(400)
				.json({ error: "Username and password are required." });
		}
		const { rows } = await pool.query(
			"SELECT id, username, display_name, password_hash FROM users WHERE username = $1",
			[username.toLowerCase()],
		);
		const ok =
			rows.length > 0 &&
			(await bcrypt.compare(password, rows[0].password_hash));
		if (!ok) {
			// Failure already recorded by accountLockoutMiddleware
			return res
				.status(401)
				.json({ error: "Wrong username or password — try again." });
		}
		await clearLoginFailures(username);
		// Retire the presented stale session cookie (if any) before minting a new one.
		// This prevents session fixation — only the current login gets a fresh token.
		const presented = req.cookies?.[SESSION_COOKIE];
		if (presented) {
			await pool.query(
				"DELETE FROM sessions WHERE token = $1 AND user_id = $2",
				[presented, rows[0].id],
			);
		}
		await mintCamelSession(res, rows[0].id);
		res.json({ user: toUser(rows[0]) });
	});

	auth.post("/logout", async (req, res) => {
		const token = req.cookies?.[SESSION_COOKIE];
		if (token)
			await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
		res.clearCookie(SESSION_COOKIE, { path: "/" });
		res.status(204).end();
	});

	auth.get("/me", requireAuth, (req, res) => {
		res.json({ user: req.user });
	});

	return auth;
}
