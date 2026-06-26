import bcrypt from "bcryptjs";
import { Router } from "express";
import {
	BCRYPT_ROUNDS,
	createSignupWorkspacePlan,
	type PendingInvite,
	requireAuth,
	USERNAME_RE,
} from "../auth.js";
import { pool } from "../db/pool.js";
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

	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			"UPDATE users SET username = $1, display_name = $2 WHERE id = $3",
			[normalizedUsername, displayNameFinal, req.user.id],
		);
		const pendingRes = await client.query<{
			id: number;
			workspace_id: number;
			username: string;
			role: string;
		}>(
			"SELECT id, workspace_id, username, role FROM workspace_invites WHERE username = $1",
			[normalizedUsername],
		);
		const pendingInvites: PendingInvite[] = pendingRes.rows.map((r) => ({
			id: r.id,
			workspaceId: r.workspace_id,
			username: r.username,
			role: r.role,
		}));
		const plan = createSignupWorkspacePlan({
			user: {
				id: req.user.id,
				username: normalizedUsername,
				displayName: displayNameFinal,
				email: req.user.email,
				emailVerified: req.user.emailVerified,
				needsUsername: false,
			},
			pendingInvites,
		});
		const wsRes = await client.query<{ id: number }>(
			"INSERT INTO workspaces (name, owner_user_id, is_personal) VALUES ($1, $2, $3) RETURNING id",
			[
				plan.personalWorkspace.name,
				plan.personalWorkspace.ownerUserId,
				plan.personalWorkspace.isPersonal,
			],
		);
		const workspaceId = wsRes.rows[0].id;
		for (const m of plan.memberships) {
			await client.query(
				"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)",
				[workspaceId, m.userId, m.role],
			);
		}
		// Consume pending invites: grant membership THEN delete invite
		for (const invite of pendingInvites) {
			await client.query(
				"INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)",
				[invite.workspaceId, req.user.id, invite.role],
			);
			await client.query("DELETE FROM workspace_invites WHERE id = $1", [
				invite.id,
			]);
		}
		await client.query("COMMIT");
		res.json({ ok: true });
	} catch (err) {
		await client.query("ROLLBACK");
		if ((err as { code?: string }).code === "23505") {
			return res
				.status(409)
				.json({ error: "Username already taken — try another." });
		}
		throw err;
	} finally {
		client.release();
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
	const { rows } = await pool.query<{ password_hash: string | null }>(
		"SELECT password_hash FROM users WHERE id = $1",
		[req.user.id],
	);
	if (rows[0]?.password_hash !== null) {
		return res
			.status(409)
			.json({ error: "Password already set. Use change-password instead." });
	}
	const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
	await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
		hash,
		req.user.id,
	]);
	res.json({ ok: true });
});
