import { Router } from "express";
import { db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";
import {
	checkActorCanManage,
	checkInviteeCap,
	countUserMemberships,
	lookupMembership,
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

	const rows = await db
		.selectFrom("workspace_members as wm")
		.innerJoin("users as u", "u.id", "wm.user_id")
		.select([
			"u.id as user_id",
			"u.username",
			"u.display_name",
			"wm.role",
		])
		.where("wm.workspace_id", "=", workspaceId)
		.orderBy("wm.role")
		.orderBy("u.username")
		.execute();

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
	const target = await db
		.selectFrom("users")
		.select(["id", "username", "display_name"])
		.where("username", "=", normalizedUsername)
		.executeTakeFirst();

	if (target) {
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

		const existingRows = await db
			.selectFrom("workspace_members")
			.select("user_id")
			.where("workspace_id", "=", workspaceId)
			.execute();
		const existingMemberIds = existingRows.map((r) => r.user_id);

		const ws = await db
			.selectFrom("workspaces")
			.select("name")
			.where("id", "=", workspaceId)
			.executeTakeFirst();
		const workspaceName = ws?.name ?? "the workspace";

		await db
			.insertInto("workspace_members")
			.values({ workspace_id: workspaceId, user_id: target.id, role: memberRole })
			.execute();

		domainBus.emit(EVENTS.MEMBER_JOINED, {
			type: EVENTS.MEMBER_JOINED,
			workspaceId,
			actorId: req.user!.id,
			payload: {
				newMemberId: target.id,
				newMemberDisplayName: target.display_name,
				workspaceName,
				existingMemberIds,
			},
		});

		return res.status(201).json({
			userId: target.id,
			username: target.username,
			displayName: target.display_name,
			role: memberRole,
		});
	}

	const dupInvite = await db
		.selectFrom("workspace_invites")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("username", "=", normalizedUsername)
		.executeTakeFirst();
	if (dupInvite) {
		return res
			.status(409)
			.json({ error: "Invite already pending for this username" });
	}

	const inv = await db
		.insertInto("workspace_invites")
		.values({
			workspace_id: workspaceId,
			username: normalizedUsername,
			role: memberRole,
			invited_by: req.user!.id,
		})
		.returning(["id", "workspace_id", "username", "role"])
		.executeTakeFirstOrThrow();

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
