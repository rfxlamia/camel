import type { AuthUser } from "../auth.js";
import type { DBExecutor } from "../db/kysely.js";
import {
	buildDefaultWorkspaceAccessDeps,
	buildRemoveMemberDep,
	type RemoveMemberDepOptions,
} from "./workspace-access-deps.js";
import {
	createWorkspaceAccessService,
	type WorkspaceAccessDeps,
} from "./workspace-access-service.js";

// Workspace access, auth checks and membership lookups live in their own kernel
// files; re-exported here so existing importers keep using `lib/helpers.js`.
export type { RemoveMemberDepOptions } from "./workspace-access-deps.js";
export {
	createWorkspaceAccessService,
	type WorkspaceAccessDeps,
} from "./workspace-access-service.js";
export {
	type AuthCheck,
	checkActorCanChangeRole,
	checkActorCanManage,
	checkCanRemoveUser,
	lookupMembership,
} from "./workspace-membership.js";

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
		| "linear_ticket_created"
		| "focus_session"
		| "attachment_added"
		| "attachment_removed"
		| "tracker_project_created"
		| "tracker_project_updated"
		| "tracker_project_deleted"
		| "tracker_phase_created"
		| "tracker_phase_updated"
		| "tracker_phase_deleted"
		| "tracker_vocabulary_created",
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

// ---- Workspace access wiring ------------------------------------------------

export function createRemoveMemberDep(
	options: RemoveMemberDepOptions = {},
): WorkspaceAccessDeps["removeMember"] {
	return buildRemoveMemberDep(options, recordActivity);
}

export function createDefaultWorkspaceAccessDeps(
	removeMemberOptions?: RemoveMemberDepOptions,
): WorkspaceAccessDeps {
	return buildDefaultWorkspaceAccessDeps(recordActivity, removeMemberOptions);
}

export const workspaceAccessService = createWorkspaceAccessService(
	createDefaultWorkspaceAccessDeps(),
);
