import type { AuthUser } from "../auth.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { clearPresence, publishEvent } from "../realtime.js";
import { lockWorkspaceMutation } from "./workspace-mutation-lock.js";

// ---- Workspace list serialization -------------------------------------------

export function serializeWorkspaceList(input: {
	workspaces: Array<{
		id: number;
		name: string;
		role: string;
		isPersonal: boolean;
		memberCount?: number;
	}>;
	invites: Array<{
		id: number;
		workspaceId: number;
		workspaceName: string;
		role: string;
	}>;
}) {
	return {
		workspaces: input.workspaces.map((ws) => ({
			id: ws.id,
			name: ws.name,
			role: ws.role,
			isPersonal: ws.isPersonal,
			...(ws.memberCount !== undefined ? { memberCount: ws.memberCount } : {}),
		})),
		pendingInvites: input.invites.map((inv) => ({
			id: inv.id,
			workspaceId: inv.workspaceId,
			workspaceName: inv.workspaceName,
			role: inv.role,
		})),
	};
}

// ---- Auth checks ------------------------------------------------------------

export type AuthCheck =
	| { allowed: true }
	| { allowed: false; status: number; error: string };

export function checkActorCanManage(role: string): AuthCheck {
	if (role === "admin" || role === "owner") return { allowed: true };
	return { allowed: false, status: 404, error: "Not found" };
}

export function checkActorCanChangeRole(role: string): AuthCheck {
	if (role === "owner") return { allowed: true };
	return { allowed: false, status: 404, error: "Not found" };
}

export function checkCanRemoveUser(
	actorId: number,
	targetUserId: number,
	targetRole: string,
): AuthCheck {
	if (actorId === targetUserId) {
		return {
			allowed: false,
			status: 403,
			error: "Cannot remove yourself",
		};
	}
	if (targetRole === "owner") {
		return {
			allowed: false,
			status: 403,
			error: "Cannot remove workspace owner",
		};
	}
	return { allowed: true };
}

// ---- Membership helpers -----------------------------------------------------

export async function lookupMembership(
	userId: number,
	workspaceId: number,
): Promise<string | undefined> {
	const row = await db
		.selectFrom("workspace_members")
		.select("role")
		.where("workspace_id", "=", workspaceId)
		.where("user_id", "=", userId)
		.executeTakeFirst();
	return row?.role;
}

export function parseWorkspaceId(raw: string): number | null {
	const workspaceId = Number(raw);
	return Number.isInteger(workspaceId) ? workspaceId : null;
}

// ---- Board service ----------------------------------------------------------

export type ScopedBoardDeps = {
	getMembership: (
		workspaceId: number,
		userId: number,
	) => Promise<{ role: string } | null>;
	getCardById: (
		workspaceId: number,
		cardId: number,
	) => Promise<{
		id: number;
		workspaceId: number;
		title: string;
		assignee?: { id: number; username: string; displayName: string } | null;
		assignees?: { id: number; username: string; displayName: string }[];
		dueDate?: string | null;
	} | null>;
	getBoardRows: (workspaceId: number) => Promise<
		Array<{
			id: number;
			workspaceId: number;
			title: string;
			cards: Array<{ id: number; workspaceId: number; title: string }>;
		}>
	>;
	getActivityRows: (
		workspaceId: number,
	) => Promise<Array<{ id: number; workspaceId: number; cardTitle: string }>>;
};

export function createScopedBoardService(deps: ScopedBoardDeps) {
	return {
		async getCard({
			userId,
			workspaceId,
			cardId,
		}: {
			userId: number;
			workspaceId: number;
			cardId: number;
		}) {
			const membership = await deps.getMembership(workspaceId, userId);
			if (!membership) return { status: 404 as const, error: "Not found" };

			const card = await deps.getCardById(workspaceId, cardId);
			if (!card || card.workspaceId !== workspaceId) {
				return { status: 404 as const, error: "Not found" };
			}
			return card;
		},

		async getBoard({
			userId,
			workspaceId,
		}: {
			userId: number;
			workspaceId: number;
		}) {
			const membership = await deps.getMembership(workspaceId, userId);
			if (!membership) return { status: 404 as const, error: "Not found" };

			const columns = await deps.getBoardRows(workspaceId);
			const activity = await deps.getActivityRows(workspaceId);
			return { columns, activity };
		},
	};
}

// ---- Workspace access service -----------------------------------------------

export type WorkspaceAccessDeps = {
	getActorMembership: (
		workspaceId: number,
		actorId: number,
	) => Promise<{ userId: number; role: string } | null>;
	getWorkspace: (
		workspaceId: number,
	) => Promise<{ id: number; name: string } | null>;
	getTargetMembership: (
		workspaceId: number,
		userId: number,
	) => Promise<{ userId: number; role: string } | null>;
	removeMember: (
		workspaceId: number,
		userId: number,
	) => Promise<{ userId: number; username: string } | null>;
	updateMemberRole: (
		workspaceId: number,
		userId: number,
		role: "admin" | "member",
	) => Promise<{
		userId: number;
		username: string;
		displayName: string;
		role: string;
	} | null>;
	publishEvent: (
		workspaceId: number,
		event:
			| {
					type: "membership.removed";
					userId: number;
					workspaceId: number;
					workspaceName: string;
			  }
			| {
					type: "membership.role_changed";
					userId: number;
					workspaceId: number;
					role: string;
			  },
	) => Promise<void>;
	clearPresence: (workspaceId: number, userId: number) => Promise<void>;
};

export function createWorkspaceAccessService(deps: WorkspaceAccessDeps) {
	return {
		async removeMember({
			actorId,
			workspaceId,
			userId,
		}: {
			actorId: number;
			workspaceId: number;
			userId: number;
		}) {
			const actorMembership = await deps.getActorMembership(
				workspaceId,
				actorId,
			);
			if (!actorMembership) return { status: 404 as const, error: "Not found" };

			const manage = checkActorCanManage(actorMembership.role);
			if (!manage.allowed) {
				return { status: manage.status, error: manage.error };
			}

			const targetMembership = await deps.getTargetMembership(
				workspaceId,
				userId,
			);
			if (!targetMembership)
				return { status: 404 as const, error: "Not found" };

			const canRemove = checkCanRemoveUser(
				actorId,
				userId,
				targetMembership.role,
			);
			if (!canRemove.allowed) {
				return { status: canRemove.status, error: canRemove.error };
			}

			const workspace = await deps.getWorkspace(workspaceId);
			if (!workspace) return { status: 404 as const, error: "Not found" };

			const removed = await deps.removeMember(workspaceId, userId);
			if (!removed) return { status: 404 as const, error: "Not found" };
			deps.clearPresence(workspaceId, userId).catch(() => {
				// best-effort; member already removed
			});
			deps
				.publishEvent(workspaceId, {
					type: "membership.removed",
					userId: removed.userId,
					workspaceId,
					workspaceName: workspace.name,
				})
				.catch(() => {
					// best-effort; member already removed
				});
			return { status: 204 as const };
		},

		async updateMemberRole({
			actorId,
			workspaceId,
			userId,
			role,
		}: {
			actorId: number;
			workspaceId: number;
			userId: number;
			role: "admin" | "member";
		}) {
			const actorMembership = await deps.getActorMembership(
				workspaceId,
				actorId,
			);
			if (!actorMembership) return { status: 404 as const, error: "Not found" };

			const canChange = checkActorCanChangeRole(actorMembership.role);
			if (!canChange.allowed) {
				return { status: 404 as const, error: canChange.error };
			}

			const targetMembership = await deps.getTargetMembership(
				workspaceId,
				userId,
			);
			if (!targetMembership)
				return { status: 404 as const, error: "Not found" };

			if (targetMembership.role === "owner") {
				return {
					status: 403 as const,
					error: "Cannot change workspace owner role",
				};
			}

			if (targetMembership.role === role) {
				const member = await deps.updateMemberRole(workspaceId, userId, role);
				if (!member) return { status: 404 as const, error: "Not found" };
				return { status: 200 as const, member };
			}

			const member = await deps.updateMemberRole(workspaceId, userId, role);
			if (!member) return { status: 404 as const, error: "Not found" };

			deps
				.publishEvent(workspaceId, {
					type: "membership.role_changed",
					userId: member.userId,
					workspaceId,
					role: member.role,
				})
				.catch(() => {
					// best-effort; role already updated
				});

			return { status: 200 as const, member };
		},
	};
}

export const workspaceAccessService = createWorkspaceAccessService({
	getActorMembership: async (workspaceId, actorId) => {
		const role = await lookupMembership(actorId, workspaceId);
		return role ? { userId: actorId, role } : null;
	},
	getWorkspace: async (workspaceId) => {
		const row = await db
			.selectFrom("workspaces")
			.select(["id", "name"])
			.where("id", "=", workspaceId)
			.executeTakeFirst();
		return row ?? null;
	},
	getTargetMembership: async (workspaceId, userId) => {
		const role = await lookupMembership(userId, workspaceId);
		return role ? { userId, role } : null;
	},
	removeMember: async (workspaceId, userId) => {
		return db.transaction().execute(async (trx) => {
			await lockWorkspaceMutation(trx, workspaceId);
			const deleted = await trx
				.deleteFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", userId)
				.returning("user_id")
				.executeTakeFirst();
			// Lost the race to a concurrent removal of the same member — the
			// caller already checked membership existed, so treat this as a
			// 404-style no-op rather than throwing.
			if (!deleted) return null;

			// Clear signable_assignee_id from columns that reference this member
			await trx
				.updateTable("columns")
				.set({ signable_assignee_id: null })
				.where("workspace_id", "=", workspaceId)
				.where("signable_assignee_id", "=", userId)
				.execute();

			await trx
				.deleteFrom("card_assignees")
				.using("cards")
				.whereRef("card_assignees.card_id", "=", "cards.id")
				.where("cards.workspace_id", "=", workspaceId)
				.where("card_assignees.user_id", "=", userId)
				.execute();

			await trx
				.deleteFrom("tracker_item_assignees")
				.using("tracker_items")
				.whereRef(
					"tracker_item_assignees.tracker_item_id",
					"=",
					"tracker_items.id",
				)
				.where("tracker_items.workspace_id", "=", workspaceId)
				.where("tracker_item_assignees.user_id", "=", userId)
				.execute();

			const user = await trx
				.selectFrom("users")
				.select("username")
				.where("id", "=", deleted.user_id)
				.executeTakeFirstOrThrow();

			return { userId: deleted.user_id, username: user.username as string };
		});
	},
	updateMemberRole: async (workspaceId, userId, role) => {
		return db.transaction().execute(async (trx) => {
			const existing = await trx
				.selectFrom("workspace_members as wm")
				.innerJoin("users as u", "u.id", "wm.user_id")
				.select([
					"wm.user_id as user_id",
					"u.username as username",
					"u.display_name as display_name",
					"wm.role as role",
				])
				.where("wm.workspace_id", "=", workspaceId)
				.where("wm.user_id", "=", userId)
				.executeTakeFirst();

			if (!existing) return null;
			if (existing.role === role) {
				return {
					userId: existing.user_id,
					username: existing.username as string,
					displayName: existing.display_name as string,
					role: existing.role as string,
				};
			}

			const updated = await trx
				.updateTable("workspace_members")
				.set({ role })
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", userId)
				.returning("user_id")
				.executeTakeFirst();
			if (!updated) return null;

			const row = await trx
				.selectFrom("workspace_members as wm")
				.innerJoin("users as u", "u.id", "wm.user_id")
				.select([
					"wm.user_id as user_id",
					"u.username as username",
					"u.display_name as display_name",
					"wm.role as role",
				])
				.where("wm.workspace_id", "=", workspaceId)
				.where("wm.user_id", "=", userId)
				.executeTakeFirst();

			if (!row) return null;
			return {
				userId: row.user_id,
				username: row.username as string,
				displayName: row.display_name as string,
				role: row.role as string,
			};
		});
	},
	publishEvent,
	clearPresence,
});

// ---- Board helpers ----------------------------------------------------------

export type HumanColumn = {
	id: number;
	title: string;
	position: number;
	wip_limit: number | null;
	policy: string;
	is_done: boolean;
	is_signable: boolean;
	signable_assignee_id: number | null;
	color: string | null;
};

export async function getHumanColumns(
	dbExec: DBExecutor,
	workspaceId: number,
): Promise<HumanColumn[]> {
	return dbExec
		.selectFrom("columns")
		.select([
			"id",
			"title",
			"position",
			"wip_limit",
			"policy",
			"is_done",
			"is_signable",
			"signable_assignee_id",
			"color",
		])
		.where("workspace_id", "=", workspaceId)
		.where("board_id", "is", null)
		.orderBy("position")
		.execute();
}

export async function recordActivity(
	dbExec: DBExecutor,
	actor: AuthUser,
	workspaceId: number,
	eventType:
		| "create"
		| "update"
		| "move"
		| "reorder"
		| "delete"
		| "linear_ticket_created",
	opts: {
		cardId?: number | null;
		fromColumnId?: number | null;
		toColumnId?: number | null;
		payload?: Record<string, unknown>;
	},
): Promise<void> {
	await dbExec
		.insertInto("card_events")
		.values({
			card_id: opts.cardId ?? null,
			from_column_id: opts.fromColumnId ?? null,
			to_column_id: opts.toColumnId ?? null,
			actor_id: actor.id,
			event_type: eventType,
			payload: JSON.stringify(opts.payload ?? {}),
			workspace_id: workspaceId,
		})
		.execute();
}
