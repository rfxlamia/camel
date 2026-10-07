import type { AuthUser } from "../auth.js";
import { db } from "../db/kysely.js";
import type { RecordFocusActivity } from "../modules/focus/index.js";
import {
	createFocusSessionRepo,
	finishActiveFocusSessionForRemoval,
} from "../modules/focus/index.js";
import { clearPresence, publishEvent } from "../realtime.js";
import type { recordActivity as RecordActivity } from "./helpers.js";
import type { WorkspaceAccessDeps } from "./workspace-access-service.js";
import { lookupMembership } from "./workspace-membership.js";
import { lockWorkspaceMutation } from "./workspace-mutation-lock.js";

// Type-only import: `recordActivity` stays the single `card_events` writer in
// helpers.ts and is injected by its wrappers, so there is no runtime cycle.
export type RecordActivityFn = typeof RecordActivity;

export type RemoveMemberDepOptions = {
	now?: () => Date;
	failAfterFocusFinalize?: () => void;
};

export function buildRemoveMemberDep(
	options: RemoveMemberDepOptions,
	recordActivity: RecordActivityFn,
): WorkspaceAccessDeps["removeMember"] {
	const now = options.now ?? (() => new Date());
	return async (workspaceId, userId, actor) => {
		return db.transaction().execute(async (trx) => {
			await lockWorkspaceMutation(trx, workspaceId);

			const focusRepo = createFocusSessionRepo(trx);
			const recordFocusActivity: RecordFocusActivity = async ({
				actor: auditActor,
				workspaceId: auditWorkspaceId,
				sessionId,
				action,
			}) => {
				await recordActivity(
					trx,
					auditActor,
					auditWorkspaceId,
					"focus_session",
					{
						cardId: null,
						payload: {
							kind: "focus_session",
							action,
							sessionId,
							workspaceId: auditWorkspaceId,
							userId,
						},
					},
				);
			};

			const focusSessionFinished = await finishActiveFocusSessionForRemoval({
				repo: focusRepo,
				actor,
				userId,
				workspaceId,
				now: now(),
				recordFocusActivity,
			});

			options.failAfterFocusFinalize?.();

			const deleted = await trx
				.deleteFrom("workspace_members")
				.where("workspace_id", "=", workspaceId)
				.where("user_id", "=", userId)
				.returning("user_id")
				.executeTakeFirst();
			if (!deleted) return null;

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

			return {
				userId: deleted.user_id,
				username: user.username as string,
				focusSessionFinished,
			};
		});
	};
}

function createUpdateMemberRoleDep(): WorkspaceAccessDeps["updateMemberRole"] {
	return async (workspaceId, userId, role) => {
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
	};
}

export function buildDefaultWorkspaceAccessDeps(
	recordActivity: RecordActivityFn,
	removeMemberOptions: RemoveMemberDepOptions = {},
): WorkspaceAccessDeps {
	return {
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
		removeMember: buildRemoveMemberDep(removeMemberOptions, recordActivity),
		updateMemberRole: createUpdateMemberRoleDep(),
		publishEvent,
		clearPresence,
	};
}
