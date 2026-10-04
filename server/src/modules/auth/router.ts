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
	USERNAME_RE,
} from "../../auth.js";
import { seedTrackerVocabulary } from "../../core/tracker-vocabulary-seed.js";
import { db } from "../../db/kysely.js";
import {
	validateDisplayName,
	validateUsername,
} from "../../validators/input-length.js";
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
		const { username, password } = req.body ?? {};
		if (typeof username !== "string" || typeof password !== "string") {
			return res
				.status(400)
				.json({ error: "Username and password are required." });
		}
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
