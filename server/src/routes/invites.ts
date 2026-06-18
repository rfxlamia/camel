import { Router } from "express";
import { pool } from "../db/pool.js";
import {
	lookupMembership,
	countUserMemberships,
	checkInviteeCap,
} from "./helpers.js";

export const invitesRouter = Router({ mergeParams: true });

invitesRouter.post("/invites/:inviteId/accept", async (req, res) => {
	const { workspaceId: wsId, inviteId: invId } = req.params as {
		workspaceId: string;
		inviteId: string;
	};
	const workspaceId = Number(wsId);
	const inviteId = Number(invId);
	if (!Number.isInteger(workspaceId) || !Number.isInteger(inviteId)) {
		return res
			.status(400)
			.json({ error: "workspaceId and inviteId must be integers" });
	}

	const invRes = await pool.query(
		`SELECT id, workspace_id, username, role
     FROM workspace_invites
     WHERE id = $1 AND workspace_id = $2 AND username = $3`,
		[inviteId, workspaceId, req.user!.username],
	);
	if (invRes.rows.length === 0) {
		return res.status(404).json({ error: "Not found" });
	}
	const invite = invRes.rows[0];

	const existing = await lookupMembership(req.user!.id, workspaceId);
	if (existing) {
		return res
			.status(409)
			.json({ error: "Already a member of this workspace" });
	}

	const membershipCount = await countUserMemberships(req.user!.id);
	const cap = checkInviteeCap(membershipCount);
	if (!cap.ok) {
		return res.status(cap.status).json({ error: cap.error });
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
			[workspaceId, req.user!.id, invite.role],
		);
		await client.query("DELETE FROM workspace_invites WHERE id = $1", [
			inviteId,
		]);
		await client.query("COMMIT");

		const wsRes = await client.query(
			"SELECT id, name, is_personal FROM workspaces WHERE id = $1",
			[workspaceId],
		);
		const ws = wsRes.rows[0];

		res.json({
			id: ws.id,
			name: ws.name,
			role: invite.role,
			isPersonal: ws.is_personal,
		});
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
});

invitesRouter.delete("/invites/:inviteId", async (req, res) => {
	const { workspaceId: wsId, inviteId: invId } = req.params as {
		workspaceId: string;
		inviteId: string;
	};
	const workspaceId = Number(wsId);
	const inviteId = Number(invId);
	if (!Number.isInteger(workspaceId) || !Number.isInteger(inviteId)) {
		return res
			.status(400)
			.json({ error: "workspaceId and inviteId must be integers" });
	}

	const { rowCount } = await pool.query(
		`DELETE FROM workspace_invites
     WHERE id = $1 AND workspace_id = $2 AND username = $3`,
		[inviteId, workspaceId, req.user!.username],
	);
	if (rowCount === 0) return res.status(404).json({ error: "Not found" });
	res.status(204).end();
});
