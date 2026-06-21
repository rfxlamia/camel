import { randomUUID } from "node:crypto";
import { Router } from "express";
import { betterAuth } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { pool } from "./db/pool.js";
import { config } from "./config.js";
import { mintCamelSession, SESSION_COOKIE } from "./auth.js";

// Pure: extract primary verified email from GitHub /user/emails API response.
export function getGitHubPrimaryEmail(
	emails: Array<{ email: string; primary: boolean; verified: boolean }>,
): string | null {
	return emails.find((e) => e.primary && e.verified)?.email ?? null;
}

// Pure: true for new OAuth users who haven't yet picked a username.
export function isOAuthPendingUser(username: string | null): boolean {
	return username === null;
}

const socialProviders: Record<string, unknown> = {};
if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
	socialProviders.google = {
		clientId: config.GOOGLE_CLIENT_ID,
		clientSecret: config.GOOGLE_CLIENT_SECRET,
	};
}
if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
	socialProviders.github = {
		clientId: config.GITHUB_CLIENT_ID,
		clientSecret: config.GITHUB_CLIENT_SECRET,
		scope: ["user:email"],
		mapProfileToUser: (profile: {
			email?: string | null;
			name?: string | null;
			login?: string;
		}) => {
			if (!profile.email) {
				throw new Error(
					"GitHub didn't provide a verified email — verify your GitHub email or use Google",
				);
			}
			// Fallback: use login username if profile name is missing (display_name is NOT NULL)
			return {
				email: profile.email,
				name: profile.name ?? profile.login ?? "GitHub User",
			};
		},
	};
}

export const auth = betterAuth({
	database: pool,
	secret: config.BETTER_AUTH_SECRET,
	baseURL: config.APP_BASE_URL,
	basePath: "/api/auth",
	trustedOrigins: [config.CLIENT_URL],
	user: {
		modelName: "users",
		fields: {
			name: "display_name",
			emailVerified: "email_verified",
			createdAt: "created_at",
			updatedAt: "updated_at",
		},
	},
	session: {
		modelName: "ba_sessions",
		fields: {
			expiresAt: "expires_at",
			createdAt: "created_at",
			updatedAt: "updated_at",
			ipAddress: "ip_address",
			userAgent: "user_agent",
			userId: "user_id",
		},
	},
	account: {
		modelName: "ba_accounts",
		fields: {
			accountId: "account_id",
			providerId: "provider_id",
			userId: "user_id",
			accessToken: "access_token",
			refreshToken: "refresh_token",
			idToken: "id_token",
			accessTokenExpiresAt: "access_token_expires_at",
			refreshTokenExpiresAt: "refresh_token_expires_at",
			createdAt: "created_at",
			updatedAt: "updated_at",
		},
		accountLinking: {
			enabled: true,
			trustedProviders: ["google", "github"],
		},
	},
	verification: {
		modelName: "ba_verifications",
		fields: {
			expiresAt: "expires_at",
			createdAt: "created_at",
			updatedAt: "updated_at",
		},
	},
	advanced: {
		database: {
			generateId: (options: { model: string }) => {
				if (options.model === "user") return false as unknown as string;
				return randomUUID();
			},
		},
	},
	socialProviders,
	databaseHooks: {
		user: {
			create: {
				after: async (_user: { id: unknown }) => {
					// Workspace provisioning deferred to set-username route (T4)
				},
			},
		},
	},
});

export const betterAuthHandler = toNodeHandler(auth);

// GET /api/auth/complete-oauth — camel_session bridge
export function createOAuthBridgeRouter(): Router {
	const router = Router();

	// Better Auth redirects here on OAuth failure: /api/auth/error?error=<code>
	// Forward the error to the client app so the user sees a meaningful message.
	router.get("/error", (req, res) => {
		const code = req.query.error ?? "oauth_failed";
		res.redirect(`${config.CLIENT_URL}/?oauth_error=${encodeURIComponent(String(code))}`);
	});

	router.get("/complete-oauth", async (req, res) => {
		const baSession = await auth.api.getSession({
			headers: fromNodeHeaders(req.headers),
		});
		if (!baSession?.user) {
			res.redirect(`${config.CLIENT_URL}/?oauth_error=cancelled`);
			return;
		}

		const baUserId = Number(baSession.user.id);

		// Detect link collision (Rule 4)
		const oldToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
		if (oldToken) {
			const { rows: oldRows } = await pool.query<{ user_id: number }>(
				"SELECT user_id FROM sessions WHERE token = $1 AND expires_at > now()",
				[oldToken],
			);
			const oldUserId = oldRows[0]?.user_id;
			if (oldUserId && oldUserId !== baUserId) {
				await pool.query("DELETE FROM sessions WHERE token = $1", [oldToken]);
				await pool.query(
					`INSERT INTO auth_audit (actor_id, event_type, payload)
           VALUES ($1, 'account_orphaned', $2)`,
					[
						oldUserId,
						JSON.stringify({
							orphanedUserId: oldUserId,
							linkedToUserId: baUserId,
						}),
					],
				);
				res.clearCookie(SESSION_COOKIE, { path: "/" });
			}
		}

		// Mint fresh camel_session
		await mintCamelSession(res, baUserId);

		// Route based on user state
		const { rows: userRows } = await pool.query<{ username: string | null }>(
			"SELECT username FROM users WHERE id = $1",
			[baUserId],
		);
		const username = userRows[0]?.username ?? null;
		if (!username) {
			res.redirect(`${config.CLIENT_URL}/?oauth=pick-username`);
		} else {
			res.redirect(config.CLIENT_URL);
		}
	});

	return router;
}
