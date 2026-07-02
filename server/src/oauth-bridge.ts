import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { Router } from "express";
import { sql } from "kysely";
import { mintCamelSession, SESSION_COOKIE } from "./auth.js";
import { config } from "./config.js";
import { db } from "./db/kysely.js";
import { pool } from "./db/pool.js";

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
		res.redirect(
			`${config.CLIENT_URL}/?oauth_error=${encodeURIComponent(String(code))}`,
		);
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

		// Detect existing camel session
		const oldToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
		console.log(
			"[complete-oauth] baUserId=%d oldToken=%s cookies=%j",
			baUserId,
			oldToken ? oldToken.slice(0, 8) + "..." : "NONE",
			Object.keys(req.cookies ?? {}),
		);
		if (oldToken) {
			// Wrap session lookup + account transfer in a single transaction to
			// prevent TOCTOU race (M4): concurrent OAuth callbacks must not see
			// stale state between the decision query and the mutation.
			type BridgeResult =
				| { kind: "linked"; oldUserId: number }
				| { kind: "collision" }
				| { kind: "noop" };

			const result: BridgeResult = await db.transaction().execute(async (trx) => {
				const oldSession = await trx
					.selectFrom("sessions")
					.select("user_id")
					.where("token", "=", oldToken)
					.where("expires_at", ">", sql<Date>`now()`)
					.executeTakeFirst();
				const oldUserId = oldSession?.user_id;

				if (oldUserId && oldUserId !== baUserId) {
					// Check if the logged-in user already has a username (password-auth user
					// linking OAuth for the first time via EmailGatePage).
					const oldUserRow = await trx
						.selectFrom("users")
						.select("username")
						.where("id", "=", oldUserId)
						.executeTakeFirst();
					const oldUsername = oldUserRow?.username ?? null;

					if (oldUsername) {
						// Transfer the BA OAuth account to the existing user, then delete the
						// orphan user Better Auth created (it couldn't match by email because
						// password-registered users have email=NULL).
						const baUserRow = await trx
							.selectFrom("users")
							.select(["email", "email_verified"])
							.where("id", "=", baUserId)
							.executeTakeFirst();
						const baEmail = baUserRow?.email ?? null;
						const baEmailVerified = baUserRow?.email_verified ?? false;

						// Move OAuth link to existing user (must happen before DELETE to
						// avoid FK cascade destroying the ba_accounts row).
						await trx
							.updateTable("ba_accounts")
							.set({ user_id: oldUserId })
							.where("user_id", "=", baUserId)
							.execute();
						// Delete orphan user — cascades ba_sessions.
						await trx.deleteFrom("users").where("id", "=", baUserId).execute();
						// Set email on existing user now that orphan row is gone (unique
						// index allows this only after the conflicting row is deleted).
						if (baEmail) {
							await trx
								.updateTable("users")
								.set({
									email: baEmail,
									email_verified: baEmailVerified,
									updated_at: sql`now()`,
								})
								.where("id", "=", oldUserId)
								.where("email", "is", null)
								.execute();
						}

						return { kind: "linked", oldUserId };
					}

					// True link collision (Rule 4): different user, not an OAuth link attempt.
					await trx
						.deleteFrom("sessions")
						.where("token", "=", oldToken)
						.execute();
					await trx
						.insertInto("auth_audit")
						.values({
							actor_id: oldUserId,
							event_type: "account_orphaned",
							payload: JSON.stringify({
								orphanedUserId: oldUserId,
								linkedToUserId: baUserId,
							}),
						})
						.execute();
					return { kind: "collision" };
				}

				return { kind: "noop" };
			});

			if (result.kind === "linked") {
				// Old camel session still valid; mint a fresh one to refresh TTL.
				await mintCamelSession(res, result.oldUserId);
				res.redirect(config.CLIENT_URL);
				return;
			}
			if (result.kind === "collision") {
				res.clearCookie(SESSION_COOKIE, { path: "/" });
			}
		}

		// Mint fresh camel_session
		await mintCamelSession(res, baUserId);

		// Route based on user state
		const userRow = await db
			.selectFrom("users")
			.select("username")
			.where("id", "=", baUserId)
			.executeTakeFirst();
		const username = userRow?.username ?? null;
		if (!username) {
			res.redirect(`${config.CLIENT_URL}/?oauth=pick-username`);
		} else {
			res.redirect(config.CLIENT_URL);
		}
	});

	return router;
}
