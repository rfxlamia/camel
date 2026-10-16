import { Router } from "express";
import { db } from "../../db/kysely.js";
import { domainBus, EVENTS } from "../../events.js";
import {
	checkActorCanManage,
	lookupMembership,
	workspaceAccessService,
} from "../../lib/helpers.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { trimmedRequired, workspaceIdParam } from "../../validators/schemas.js";
import {
	MEMBER_PARAMS_MESSAGE,
	memberParams,
	memberRoleBody,
} from "./workspace-params.js";

export const membersRouter = Router({ mergeParams: true });

membersRouter.get("/members", async (req, res) => {
	const parsedId = parseWith(
		workspaceIdParam,
		(req.params as { workspaceId?: string }).workspaceId,
	);
	if (!parsedId.ok) return sendValidationError(res, parsedId.body);
	const workspaceId = parsedId.data;

	const role = await lookupMembership(req.user!.id, workspaceId);
	if (!role) return res.status(404).json({ error: "Not found" });

	const rows = await db
		.selectFrom("workspace_members as wm")
		.innerJoin("users as u", "u.id", "wm.user_id")
		.select(["u.id as user_id", "u.username", "u.display_name", "wm.role"])
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
	const parsedId = parseWith(
		workspaceIdParam,
		(req.params as { workspaceId?: string }).workspaceId,
	);
	if (!parsedId.ok) return sendValidationError(res, parsedId.body);
	const workspaceId = parsedId.data;

	const actorRole = await lookupMembership(req.user!.id, workspaceId);
	if (!actorRole) return res.status(404).json({ error: "Not found" });

	const manage = checkActorCanManage(actorRole);
	if (!manage.allowed) {
		return res.status(manage.status).json({ error: manage.error });
	}

	const { username: rawUsername, role: inviteRole } = req.body ?? {};
	const parsedUsername = parseWith(
		trimmedRequired("username is required"),
		rawUsername,
	);
	if (!parsedUsername.ok) return sendValidationError(res, parsedUsername.body);
	const username = parsedUsername.data;
	const memberRole =
		inviteRole === "admin" || inviteRole === "member" ? inviteRole : "member";

	const normalizedUsername = username.toLowerCase();
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
		// Existing users also get a pending invite — joining requires their
		// acceptance (POST /invites/:inviteId/accept), never a silent add.
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

	try {
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
	} catch (err) {
		// A concurrent POST /members for the same username won the duplicate
		// precheck race above — lose it cleanly instead of a raw 500.
		if ((err as { code?: string }).code === "23505") {
			return res
				.status(409)
				.json({ error: "Invite already pending for this username" });
		}
		throw err;
	}
});

membersRouter.patch("/members/:userId", async (req, res) => {
	const parsedParams = parseWith(memberParams, req.params, {
		message: MEMBER_PARAMS_MESSAGE,
	});
	if (!parsedParams.ok) return sendValidationError(res, parsedParams.body);
	const { workspaceId, userId: targetUserId } = parsedParams.data;

	const parsedRole = parseWith(memberRoleBody, (req.body ?? {}).role);
	if (!parsedRole.ok) return sendValidationError(res, parsedRole.body);
	const role = parsedRole.data;

	const result = await workspaceAccessService.updateMemberRole({
		actorId: req.user!.id,
		workspaceId,
		userId: targetUserId,
		role,
	});

	if (result.status === 200) {
		res.json({
			userId: result.member.userId,
			username: result.member.username,
			displayName: result.member.displayName,
			role: result.member.role,
		});
		return;
	}

	return res.status(result.status).json({ error: result.error });
});

membersRouter.delete("/members/:userId", async (req, res) => {
	const parsedParams = parseWith(memberParams, req.params, {
		message: MEMBER_PARAMS_MESSAGE,
	});
	if (!parsedParams.ok) return sendValidationError(res, parsedParams.body);
	const { workspaceId, userId: targetUserId } = parsedParams.data;

	const result = await workspaceAccessService.removeMember({
		actorId: req.user!.id,
		actor: req.user!,
		workspaceId,
		userId: targetUserId,
	});
	if (result.status !== 204) {
		return res.status(result.status).json({ error: result.error });
	}
	res.status(204).end();
});
