import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { sql } from "kysely";
import { db } from "./db/kysely.js";
import { logger } from "./lib/logger.js";

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
export function toUser(row: {
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
	await db
		.insertInto("sessions")
		.values({ token, user_id: userId, expires_at: expiresAt })
		.execute();
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
	try {
		return await db.transaction().execute(async (trx) => {
			const deleted = await trx
				.deleteFrom("sessions")
				.where("token", "=", oldToken)
				.where("user_id", "=", userId)
				.where("expires_at", ">", new Date())
				.returning("token")
				.executeTakeFirst();
			if (!deleted) {
				return null;
			}

			const newToken = randomBytes(32).toString("base64url");
			const expiresAt = new Date(
				Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
			);
			await trx
				.insertInto("sessions")
				.values({ token: newToken, user_id: userId, expires_at: expiresAt })
				.execute();

			return newToken;
		});
	} catch (err) {
		logger.error({ err }, "auth: session rotation failed");
		return null;
	}
}

/**
 * Delete expired sessions from the database.
 * Safe to call frequently — no-ops when there's nothing to clean.
 */
export async function cleanupExpiredSessions(): Promise<number> {
	try {
		const result = await db
			.deleteFrom("sessions")
			.where("expires_at", "<", sql<Date>`now()`)
			.executeTakeFirst();
		const count = Number(result.numDeletedRows ?? 0);
		if (count > 0) {
			logger.info({ count }, "auth: cleaned up expired sessions");
		}
		return count;
	} catch (err) {
		logger.error({ err }, "auth: failed to cleanup expired sessions");
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
		const row = await db
			.selectFrom("sessions as s")
			.innerJoin("users as u", "u.id", "s.user_id")
			.select([
				"u.id",
				"u.username",
				"u.display_name",
				"u.email",
				"u.email_verified",
			])
			.where("s.token", "=", token)
			.where("s.expires_at", ">", sql<Date>`now()`)
			.executeTakeFirst();
		if (!row) {
			return res.status(401).json({ error: "session expired — sign in again" });
		}
		req.user = toUser(row);
		next();
	} catch (err) {
		next(err);
	}
}
