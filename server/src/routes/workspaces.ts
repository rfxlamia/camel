import { Router } from "express";
import { sql } from "kysely";
import { db } from "../db/kysely.js";
import {
	countUserMemberships,
	getWorkspaceCapacity,
	lookupMembership,
	serializeWorkspaceList,
} from "./helpers.js";

export const workspacesRouter = Router({ mergeParams: true });

workspacesRouter.get("/", async (req, res) => {
	const userId = req.user!.id;
	const username = req.user!.username;

	const wsRows = await db
		.selectFrom("workspace_members as wm")
		.innerJoin("workspaces as w", "w.id", "wm.workspace_id")
		.select((eb) => [
			"w.id",
			"w.name",
			"w.is_personal",
			"wm.role",
			eb
				.selectFrom("workspace_members as m")
				.select([sql<number>`count(*)::int`.as("count")])
				.whereRef("m.workspace_id", "=", "w.id")
				.as("member_count"),
		])
		.where("wm.user_id", "=", userId)
		.orderBy("w.name")
		.execute();

	const invRows = await db
		.selectFrom("workspace_invites as wi")
		.innerJoin("workspaces as w", "w.id", "wi.workspace_id")
		.select([
			"wi.id",
			"wi.workspace_id",
			"w.name as workspace_name",
			"wi.role",
		])
		.where("wi.username", "=", username as string)
		.orderBy("wi.created_at")
		.execute();

	res.json(
		serializeWorkspaceList({
			workspaces: wsRows.map((row) => ({
				id: row.id,
				name: row.name,
				role: row.role,
				isPersonal: row.is_personal,
				memberCount: Number(row.member_count),
			})),
			invites: invRows.map((row) => ({
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

	const ws = await db.transaction().execute(async (trx) => {
		const inserted = await trx
			.insertInto("workspaces")
			.values({
				name: name.trim(),
				owner_user_id: req.user!.id,
				is_personal: false,
			})
			.returning(["id", "name", "is_personal"])
			.executeTakeFirstOrThrow();
		await trx
			.insertInto("workspace_members")
			.values({
				workspace_id: inserted.id,
				user_id: req.user!.id,
				role: "owner",
			})
			.execute();
		return inserted;
	});

	res.status(201).json({
		id: ws.id,
		name: ws.name,
		role: "owner",
		isPersonal: ws.is_personal,
		memberCount: 1,
	});
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

	const ws = await db
		.selectFrom("workspaces")
		.select("is_personal")
		.where("id", "=", workspaceId)
		.executeTakeFirst();
	if (!ws) return res.status(404).json({ error: "Not found" });
	if (ws.is_personal) {
		return res
			.status(403)
			.json({ error: "Personal workspaces cannot be deleted" });
	}

	const countRow = await db
		.selectFrom("workspace_members")
		.select(sql<number>`count(*)::int`.as("n"))
		.where("workspace_id", "=", workspaceId)
		.executeTakeFirstOrThrow();
	if (countRow.n > 1) {
		return res.status(409).json({
			error: "Remove all other members before deleting this workspace",
		});
	}

	await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
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

	await db.transaction().execute(async (trx) => {
		await trx
			.updateTable("workspace_members")
			.set({ role: "owner" })
			.where("workspace_id", "=", workspaceId)
			.where("user_id", "=", newOwnerId)
			.execute();
		await trx
			.updateTable("workspace_members")
			.set({ role: demotedRole })
			.where("workspace_id", "=", workspaceId)
			.where("user_id", "=", req.user!.id)
			.execute();
		await trx
			.updateTable("workspaces")
			.set({ owner_user_id: newOwnerId })
			.where("id", "=", workspaceId)
			.execute();
	});
	res.json({ ok: true });
});
