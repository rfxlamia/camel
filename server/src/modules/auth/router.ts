import bcrypt from "bcryptjs";
import { type RequestHandler, Router } from "express";
import {
	BCRYPT_ROUNDS,
	createSignupWorkspacePlan,
	mintCamelSession,
	type PendingInvite,
	requireAuth,
	SESSION_COOKIE,
	toUser,
} from "../../auth.js";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import {
	displayNameSchema,
	loginCredentialsSchema,
	passwordSchema,
	REGISTER_USERNAME_MESSAGE,
	usernameSchema,
} from "./auth-schemas.js";
import {
	accountLockoutMiddleware,
	clearLoginFailures,
} from "./login-limiter.js";

export function createAuthRouter(rateLimiter?: RequestHandler): Router {
	const auth = Router();

	// Apply rate limiter before routes if provided
	if (rateLimiter) {
		auth.use(rateLimiter);
	}

	auth.post("/register", async (req, res) => {
		const { username, password, displayName } = req.body ?? {};
		const parsedUsername = parseWith(
			usernameSchema(REGISTER_USERNAME_MESSAGE),
			username,
		);
		if (!parsedUsername.ok)
			return sendValidationError(res, parsedUsername.body);
		const parsedPassword = parseWith(passwordSchema, password);
		if (!parsedPassword.ok)
			return sendValidationError(res, parsedPassword.body);
		const parsedDisplayName = parseWith(displayNameSchema, displayName);
		if (!parsedDisplayName.ok) {
			return sendValidationError(res, parsedDisplayName.body);
		}
		const name = parsedDisplayName.data ?? parsedUsername.data;

		const hash = await bcrypt.hash(parsedPassword.data, BCRYPT_ROUNDS);
		const normalizedUsername = parsedUsername.data.toLowerCase();
		try {
			const user = await db.transaction().execute(async (trx) => {
				const inserted = await trx
					.insertInto("users")
					.values({
						username: normalizedUsername,
						display_name: name,
						password_hash: hash,
					})
					.returning(["id", "username", "display_name"])
					.executeTakeFirstOrThrow();
				const user = toUser(inserted);

				const pendingRows = await trx
					.selectFrom("workspace_invites")
					.select(["id", "workspace_id", "username", "role"])
					.where("username", "=", normalizedUsername)
					.execute();
				const pendingInvites: PendingInvite[] = pendingRows.map((row) => ({
					id: row.id,
					workspaceId: row.workspace_id,
					username: row.username,
					role: row.role,
				}));

				const plan = createSignupWorkspacePlan({ user, pendingInvites });

				const ws = await trx
					.insertInto("workspaces")
					.values({
						name: plan.personalWorkspace.name,
						owner_user_id: plan.personalWorkspace.ownerUserId,
						is_personal: plan.personalWorkspace.isPersonal,
					})
					.returning("id")
					.executeTakeFirstOrThrow();

				for (const membership of plan.memberships) {
					await trx
						.insertInto("workspace_members")
						.values({
							workspace_id: ws.id,
							user_id: membership.userId,
							role: membership.role,
						})
						.execute();
				}

				await seedTrackerVocabulary(trx, ws.id);

				// Consume pending invites: grant membership THEN delete invite
				for (const invite of pendingInvites) {
					await trx
						.insertInto("workspace_members")
						.values({
							workspace_id: invite.workspaceId,
							user_id: user.id,
							role: invite.role,
						})
						.execute();
					await trx
						.deleteFrom("workspace_invites")
						.where("id", "=", invite.id)
						.execute();
				}

				return user;
			});

			await mintCamelSession(res, user.id);
			res.status(201).json({ user });
		} catch (err) {
			if ((err as { code?: string }).code === "23505") {
				return res
					.status(409)
					.json({ error: "That username's already taken — try another." });
			}
			throw err;
		}
	});

	auth.post("/login", accountLockoutMiddleware, async (req, res) => {
		const credentials = parseWith(loginCredentialsSchema, req.body ?? {});
		if (!credentials.ok) return sendValidationError(res, credentials.body);
		const { username, password } = credentials.data;
		const row = await db
			.selectFrom("users")
			.select([
				"id",
				"username",
				"display_name",
				"email",
				"email_verified",
				"password_hash",
			])
			.where("username", "=", username.toLowerCase())
			.executeTakeFirst();
		const ok =
			row !== undefined &&
			row.password_hash !== null &&
			(await bcrypt.compare(password, row.password_hash));
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
			await db
				.deleteFrom("sessions")
				.where("token", "=", presented)
				.where("user_id", "=", row.id)
				.execute();
		}
		await mintCamelSession(res, row.id);
		res.json({ user: toUser(row) });
	});

	auth.post("/logout", async (req, res) => {
		const token = req.cookies?.[SESSION_COOKIE];
		if (token)
			await db.deleteFrom("sessions").where("token", "=", token).execute();
		res.clearCookie(SESSION_COOKIE, { path: "/" });
		res.status(204).end();
	});

	auth.get("/me", requireAuth, (req, res) => {
		res.json({ user: req.user });
	});

	return auth;
}
