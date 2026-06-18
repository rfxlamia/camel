import { Router } from "express";
import { pool } from "../db/pool.js";
import {
	serializeWorkspaceList,
	getWorkspaceCapacity,
	countUserMemberships,
	lookupMembership,
} from "./helpers.js";

export const workspacesRouter = Router({ mergeParams: true });

workspacesRouter.get("/", async (req, res) => {
	const userId = req.user!.id;
	const username = req.user!.username;

	const wsRes = await pool.query(
		`SELECT w.id, w.name, w.is_personal, wm.role,
            (SELECT COUNT(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count
     FROM workspace_members wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1
     ORDER BY w.name`,
		[userId],
	);

	const invRes = await pool.query(
		`SELECT wi.id, wi.workspace_id, w.name AS workspace_name, wi.role
     FROM workspace_invites wi
     JOIN workspaces w ON w.id = wi.workspace_id
     WHERE wi.username = $1
     ORDER BY wi.created_at`,
		[username],
	);

	res.json(
		serializeWorkspaceList({
			workspaces: wsRes.rows.map((row) => ({
				id: row.id,
				name: row.name,
				role: row.role,
				isPersonal: row.is_personal,
				memberCount: row.member_count,
			})),
			invites: invRes.rows.map((row) => ({
				id: row.id,
				workspaceId: row.workspace_id,
				workspaceName: row.workspace_name,
				role: row.role,
			})),
		}),
	);
});

workspacesRouter.post("/", async (req, res) => {
	const { name } = req.body ?? {};
	if (typeof name !== "string" || name.trim() === "") {
		return res.status(400).json({ error: "name is required" });
	}

	const membershipCount = await countUserMemberships(req.user!.id);
	const cap = getWorkspaceCapacity(membershipCount);
	if (!cap.ok) {
		return res.status(cap.status).json({ error: cap.error });
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const wsRes = await client.query(
			`INSERT INTO workspaces (name, owner_user_id, is_personal)
       VALUES ($1, $2, false)
       RETURNING id, name, is_personal`,
			[name.trim(), req.user!.id],
		);
		const ws = wsRes.rows[0];
		await client.query(
			`INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
			[ws.id, req.user!.id],
		);
		await client.query("COMMIT");

		res.status(201).json({
			id: ws.id,
			name: ws.name,
			role: "owner",
			isPersonal: ws.is_personal,
			memberCount: 1,
		});
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
});

workspacesRouter.delete("/:workspaceId", async (req, res) => {
	const workspaceId = Number(req.params.workspaceId);
	if (!Number.isInteger(workspaceId)) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const actorRole = await lookupMembership(req.user!.id, workspaceId);
	if (!actorRole) return res.status(404).json({ error: "Not found" });
	if (actorRole !== "owner")
		return res.status(404).json({ error: "Not found" });

	const wsRes = await pool.query(
		"SELECT is_personal FROM workspaces WHERE id = $1",
		[workspaceId],
	);
	if (wsRes.rows.length === 0)
		return res.status(404).json({ error: "Not found" });
	if (wsRes.rows[0].is_personal) {
		return res
			.status(403)
			.json({ error: "Personal workspaces cannot be deleted" });
	}

	const countRes = await pool.query(
		"SELECT COUNT(*)::int AS n FROM workspace_members WHERE workspace_id = $1",
		[workspaceId],
	);
	if (countRes.rows[0].n > 1) {
		return res.status(409).json({
			error: "Remove all other members before deleting this workspace",
		});
	}

	await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
	res.status(204).end();
});

workspacesRouter.post("/:workspaceId/transfer-ownership", async (req, res) => {
	const workspaceId = Number(req.params.workspaceId);
	if (!Number.isInteger(workspaceId)) {
		return res.status(400).json({ error: "workspaceId must be an integer" });
	}

	const actorRole = await lookupMembership(req.user!.id, workspaceId);
	if (!actorRole || actorRole !== "owner") {
		return res.status(404).json({ error: "Not found" });
	}

	const { newOwnerId, previousOwnerRole } = req.body ?? {};
	if (!Number.isInteger(newOwnerId)) {
		return res.status(400).json({ error: "newOwnerId is required" });
	}
	if (newOwnerId === req.user!.id) {
		return res
			.status(400)
			.json({ error: "Cannot transfer ownership to yourself" });
	}
	const demotedRole =
		previousOwnerRole === "admin" || previousOwnerRole === "member"
			? previousOwnerRole
			: "admin";

	const newOwnerRole = await lookupMembership(newOwnerId, workspaceId);
	if (!newOwnerRole) {
		return res.status(404).json({ error: "Not found" });
	}

	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			`UPDATE workspace_members SET role = 'owner'
       WHERE workspace_id = $1 AND user_id = $2`,
			[workspaceId, newOwnerId],
		);
		await client.query(
			`UPDATE workspace_members SET role = $3
       WHERE workspace_id = $1 AND user_id = $2`,
			[workspaceId, req.user!.id, demotedRole],
		);
		await client.query(
			"UPDATE workspaces SET owner_user_id = $2 WHERE id = $1",
			[workspaceId, newOwnerId],
		);
		await client.query("COMMIT");
		res.json({ ok: true });
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
});
