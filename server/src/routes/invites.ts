import { Router } from "express";
import { db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";
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

	// Wrap invite consumption + membership insert in a single transaction to
	// prevent TOCTOU races (M14): the invite must be deleted atomically as the
	// authorization check itself — a revoked invite must not still be usable
	// just because it existed when this request started. ON CONFLICT on the
	// membership insert is the authoritative guard against concurrent accepts.
	type TxResult =
		| { kind: "not_found" }
		| { kind: "already_member" }
		| {
				kind: "ok";
				role: string;
				workspaceName: string;
				existingMemberIds: number[];
				ws: { id: number; name: string; is_personal: boolean };
		  };

	const result: TxResult = await db.transaction().execute(async (trx) => {
		// Atomically consume the invite: this delete IS the authorization check.
		const deletedInvite = await trx
			.deleteFrom("workspace_invites")
			.where("id", "=", inviteId)
			.where("workspace_id", "=", workspaceId)
			.where("username", "=", req.user!.username as string)
			.returning("role")
			.executeTakeFirst();
		if (!deletedInvite) {
			return { kind: "not_found" };
		}

		// Check membership inside the transaction for consistent snapshot.
		const existing = await trx
			.selectFrom("workspace_members")
			.select("user_id")
			.where("workspace_id", "=", workspaceId)
			.where("user_id", "=", req.user!.id)
			.executeTakeFirst();
		if (existing) {
			return { kind: "already_member" };
		}

		const memberRows = await trx
			.selectFrom("workspace_members")
			.select("user_id")
			.where("workspace_id", "=", workspaceId)
			.execute();
		const existingMemberIds = memberRows.map((r) => r.user_id);

		const wsNameRow = await trx
			.selectFrom("workspaces")
			.select("name")
			.where("id", "=", workspaceId)
			.executeTakeFirst();
		const workspaceName = wsNameRow?.name ?? "the workspace";

		// INSERT with ON CONFLICT to atomically handle duplicate membership.
		const inserted = await trx
			.insertInto("workspace_members")
			.values({
				workspace_id: workspaceId,
				user_id: req.user!.id,
				role: deletedInvite.role,
			})
			.onConflict((oc) => oc.columns(["workspace_id", "user_id"]).doNothing())
			.returning("user_id")
			.executeTakeFirst();
		if (!inserted) {
			return { kind: "already_member" };
		}

		const ws = await trx
			.selectFrom("workspaces")
			.select(["id", "name", "is_personal"])
			.where("id", "=", workspaceId)
			.executeTakeFirstOrThrow();

		return {
			kind: "ok",
			role: deletedInvite.role,
			workspaceName,
			existingMemberIds,
			ws,
		};
	});

	if (result.kind === "not_found") {
		return res.status(404).json({ error: "Not found" });
	}
	if (result.kind === "already_member") {
		return res
			.status(409)
			.json({ error: "Already a member of this workspace" });
	}

	domainBus.emit(EVENTS.MEMBER_JOINED, {
		type: EVENTS.MEMBER_JOINED,
		workspaceId,
		actorId: req.user!.id,
		payload: {
			newMemberId: req.user!.id,
			newMemberDisplayName: req.user!.displayName,
			workspaceName: result.workspaceName,
			existingMemberIds: result.existingMemberIds,
		},
	});

	res.json({
		id: result.ws.id,
		name: result.ws.name,
		role: result.role,
		isPersonal: result.ws.is_personal,
	});
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

	const result = await db
		.deleteFrom("workspace_invites")
		.where("id", "=", inviteId)
		.where("workspace_id", "=", workspaceId)
		.where("username", "=", req.user!.username as string)
		.executeTakeFirst();
	if (Number(result.numDeletedRows) === 0)
		return res.status(404).json({ error: "Not found" });
	res.status(204).end();
});
