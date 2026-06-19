import { Router } from "express";
import { pool } from "../db/pool.js";
import {
	lookupMembership,
	checkActorCanManage,
	countUserMemberships,
	checkInviteeCap,
	workspaceAccessService,
} from "./helpers.js";

export const membersRouter = Router({ mergeParams: true });

membersRouter.get("/members", async (req, res) => {
	const { workspaceId: wsId } = req.params as { workspaceId: string };
	const workspaceId = Number(wsId);
	if (!Number.isInteger(workspaceId)) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const role = await lookupMembership(req.user!.id, workspaceId);
	if (!role) return res.status(404).json({ error: "Not found" });

	const { rows } = await pool.query(
		`SELECT u.id AS user_id, u.username, u.display_name, wm.role
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.role, u.username`,
		[workspaceId],
	);

	res.json({
		members: rows.map((row) => ({
			userId: row.user_id,
			username: row.username,
			displayName: row.display_name,
			role: row.role,
		})),
	});
});

membersRouter.post("/members", async (req, res) => {
	const { workspaceId: wsId } = req.params as { workspaceId: string };
	const workspaceId = Number(wsId);
	if (!Number.isInteger(workspaceId)) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const actorRole = await lookupMembership(req.user!.id, workspaceId);
	if (!actorRole) return res.status(404).json({ error: "Not found" });

	const manage = checkActorCanManage(actorRole);
	if (!manage.allowed) {
		return res.status(manage.status).json({ error: manage.error });
	}

	const { username, role: inviteRole } = req.body ?? {};
	if (typeof username !== "string" || username.trim() === "") {
		return res.status(400).json({ error: "username is required" });
	}
	const memberRole =
		inviteRole === "admin" || inviteRole === "member" ? inviteRole : "member";

	const normalizedUsername = username.trim().toLowerCase();
	const targetRes = await pool.query(
		"SELECT id, username, display_name FROM users WHERE username = $1",
		[normalizedUsername],
	);

	if (targetRes.rows.length > 0) {
		const target = targetRes.rows[0];
		const existing = await lookupMembership(target.id, workspaceId);
		if (existing) {
			return res
				.status(409)
				.json({ error: "User is already a member of this workspace" });
		}

		const inviteeCount = await countUserMemberships(target.id);
		const cap = checkInviteeCap(inviteeCount);
		if (!cap.ok) {
			return res.status(cap.status).json({ error: cap.error });
		}

		await pool.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
			[workspaceId, target.id, memberRole],
		);

		return res.status(201).json({
			userId: target.id,
			username: target.username,
			displayName: target.display_name,
			role: memberRole,
		});
	}

	const dupInvite = await pool.query(
		"SELECT id FROM workspace_invites WHERE workspace_id = $1 AND username = $2",
		[workspaceId, normalizedUsername],
	);
	if (dupInvite.rows.length > 0) {
		return res
			.status(409)
			.json({ error: "Invite already pending for this username" });
	}

	const invRes = await pool.query(
		`INSERT INTO workspace_invites (workspace_id, username, role, invited_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, workspace_id, username, role`,
		[workspaceId, normalizedUsername, memberRole, req.user!.id],
	);
	const inv = invRes.rows[0];

	res.status(201).json({
		id: inv.id,
		workspaceId: inv.workspace_id,
		username: inv.username,
		role: inv.role,
		pending: true,
	});
});

membersRouter.delete("/members/:userId", async (req, res) => {
	const { workspaceId: wsId, userId: uid } = req.params as {
		workspaceId: string;
		userId: string;
	};
	const workspaceId = Number(wsId);
	const targetUserId = Number(uid);
	if (!Number.isInteger(workspaceId) || !Number.isInteger(targetUserId)) {
		return res
			.status(400)
			.json({ error: "workspaceId and userId must be integers" });
	}

	const result = await workspaceAccessService.removeMember({
		actorId: req.user!.id,
		workspaceId,
		userId: targetUserId,
	});
	if (result.status !== 204) {
		return res.status(result.status).json({ error: result.error });
	}
	res.status(204).end();
});
