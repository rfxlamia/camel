import bcrypt from "bcryptjs";
import { Router } from "express";
import {
	BCRYPT_ROUNDS,
	createSignupWorkspacePlan,
	type PendingInvite,
	requireAuth,
	USERNAME_RE,
} from "../auth.js";
import { db } from "../db/kysely.js";
import { validateUsername } from "../validators/input-length.js";

export const oauthRouter = Router();

oauthRouter.post("/set-username", requireAuth, async (req, res) => {
	if (!req.user)
		return res.status(401).json({ error: "authentication required" });
	if (req.user.username !== null) {
		return res.status(409).json({ error: "Username already set." });
	}
	const { username, displayName } = req.body ?? {};
	const validation = validateUsername(username ?? "");
	if (!validation.valid || !USERNAME_RE.test(validation.trimmed ?? "")) {
		return res.status(400).json({
			error: "Username must be 3–32 characters: letters, numbers, underscore.",
		});
	}
	const normalizedUsername = validation.trimmed!.toLowerCase();
	const displayNameFinal =
		typeof displayName === "string" && displayName.trim()
			? displayName.trim()
			: normalizedUsername;

	try {
		const outcome: "ok" | "already_set" = await db
			.transaction()
			.execute(async (trx) => {
				// Conditional on username still being null: closes the TOCTOU
				// window between the req.user precheck above and this write —
				// a concurrent set-username must not be overwritten.
				const updated = await trx
					.updateTable("users")
					.set({ username: normalizedUsername, display_name: displayNameFinal })
					.where("id", "=", req.user!.id)
					.where("username", "is", null)
					.returning("id")
					.executeTakeFirst();
				if (!updated) {
					return "already_set";
				}

				const pendingRows = await trx
					.selectFrom("workspace_invites")
					.select(["id", "workspace_id", "username", "role"])
					.where("username", "=", normalizedUsername)
					.execute();
				const pendingInvites: PendingInvite[] = pendingRows.map((r) => ({
					id: r.id,
					workspaceId: r.workspace_id,
					username: r.username,
					role: r.role,
				}));
				const plan = createSignupWorkspacePlan({
					user: {
						id: req.user!.id,
						username: normalizedUsername,
						displayName: displayNameFinal,
						email: req.user!.email,
						emailVerified: req.user!.emailVerified,
						needsUsername: false,
					},
					pendingInvites,
				});
				const ws = await trx
					.insertInto("workspaces")
					.values({
						name: plan.personalWorkspace.name,
						owner_user_id: plan.personalWorkspace.ownerUserId,
						is_personal: plan.personalWorkspace.isPersonal,
					})
					.returning("id")
					.executeTakeFirstOrThrow();
				for (const m of plan.memberships) {
					await trx
						.insertInto("workspace_members")
						.values({ workspace_id: ws.id, user_id: m.userId, role: m.role })
						.execute();
				}
				// Consume pending invites: grant membership THEN delete invite
				for (const invite of pendingInvites) {
					await trx
						.insertInto("workspace_members")
						.values({
							workspace_id: invite.workspaceId,
							user_id: req.user!.id,
							role: invite.role,
						})
						.execute();
					await trx
						.deleteFrom("workspace_invites")
						.where("id", "=", invite.id)
						.execute();
				}
				return "ok";
			});
		if (outcome === "already_set") {
			return res.status(409).json({ error: "Username already set." });
		}
		res.json({ ok: true });
	} catch (err) {
		if ((err as { code?: string }).code === "23505") {
			return res
				.status(409)
				.json({ error: "Username already taken — try another." });
		}
		throw err;
	}
});

oauthRouter.post("/set-password", requireAuth, async (req, res) => {
	if (!req.user)
		return res.status(401).json({ error: "authentication required" });
	const { password } = req.body ?? {};
	if (typeof password !== "string" || password.length < 8) {
		return res
			.status(400)
			.json({ error: "Password must be at least 8 characters." });
	}
	const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
	// Conditional on password_hash still being null: closes the TOCTOU
	// window between a precheck and this write — a concurrent set-password
	// must not be overwritten.
	const updated = await db
		.updateTable("users")
		.set({ password_hash: hash })
		.where("id", "=", req.user.id)
		.where("password_hash", "is", null)
		.returning("id")
		.executeTakeFirst();
	if (!updated) {
		return res
			.status(409)
			.json({ error: "Password already set. Use change-password instead." });
	}
	res.json({ ok: true });
});
