import type { AuthUser } from "../auth.js";
import { pool } from "../db/pool.js";
import { clearPresence, publishEvent } from "../realtime.js";

// ---- Workspace capacity -----------------------------------------------------

export const WORKSPACE_LIMIT = 10;
export const CAP_ERROR_MESSAGE = `You've reached the workspace limit (${WORKSPACE_LIMIT}).`;

export type WorkspaceCapacity =
	| { ok: true }
	| { ok: false; status: 409; error: string };

export function getWorkspaceCapacity(
	membershipCount: number,
): WorkspaceCapacity {
	if (membershipCount >= WORKSPACE_LIMIT) {
		return { ok: false, status: 409, error: CAP_ERROR_MESSAGE };
	}
	return { ok: true };
}

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

export function checkCanRemoveUser(
	_actorRole: string,
	targetRole: string,
): AuthCheck {
	if (targetRole === "owner") {
		return {
			allowed: false,
			status: 403,
			error: "Cannot remove workspace owner",
		};
	}
	return { allowed: true };
}

export function checkInviteeCap(membershipCount: number): WorkspaceCapacity {
	return getWorkspaceCapacity(membershipCount);
}

// ---- Membership helpers -----------------------------------------------------

export async function countUserMemberships(userId: number): Promise<number> {
	const { rows } = await pool.query(
		"SELECT COUNT(*)::int AS n FROM workspace_members WHERE user_id = $1",
		[userId],
	);
	return rows[0].n;
}

export async function lookupMembership(
	userId: number,
	workspaceId: number,
): Promise<string | undefined> {
	const { rows } = await pool.query(
		"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
		[workspaceId, userId],
	);
	return rows[0]?.role as string | undefined;
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
	) => Promise<{ userId: number; username: string }>;
	publishEvent: (
		workspaceId: number,
		event: {
			type: "membership.removed";
			userId: number;
			workspaceId: number;
			workspaceName: string;
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
				actorMembership.role,
				targetMembership.role,
			);
			if (!canRemove.allowed) {
				return { status: canRemove.status, error: canRemove.error };
			}

			const workspace = await deps.getWorkspace(workspaceId);
			if (!workspace) return { status: 404 as const, error: "Not found" };

			const removed = await deps.removeMember(workspaceId, userId);
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
	};
}

export const workspaceAccessService = createWorkspaceAccessService({
	getActorMembership: async (workspaceId, actorId) => {
		const role = await lookupMembership(actorId, workspaceId);
		return role ? { userId: actorId, role } : null;
	},
	getWorkspace: async (workspaceId) => {
		const { rows } = await pool.query(
			"SELECT id, name FROM workspaces WHERE id = $1",
			[workspaceId],
		);
		return rows[0]
			? { id: rows[0].id as number, name: rows[0].name as string }
			: null;
	},
	getTargetMembership: async (workspaceId, userId) => {
		const role = await lookupMembership(userId, workspaceId);
		return role ? { userId, role } : null;
	},
	removeMember: async (workspaceId, userId) => {
		const { rows } = await pool.query(
			`DELETE FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2
       RETURNING user_id`,
			[workspaceId, userId],
		);
		// Clear signable_assignee_id from columns that reference this member
		await pool.query(
			"UPDATE columns SET signable_assignee_id = NULL WHERE workspace_id = $1 AND signable_assignee_id = $2",
			[workspaceId, userId],
		);
		const { rows: userRows } = await pool.query(
			"SELECT username FROM users WHERE id = $1",
			[rows[0].user_id],
		);
		return {
			userId: rows[0].user_id as number,
			username: userRows[0].username as string,
		};
	},
	publishEvent,
	clearPresence,
});

// ---- Board helpers ----------------------------------------------------------

export type Queryable = Pick<typeof pool, "query">;

export type HumanColumn = {
	id: number;
	title: string;
	position: number;
	wip_limit: number | null;
	policy: string;
	is_done: boolean;
	is_signable: boolean;
	signable_assignee_id: number | null;
};

export async function getHumanColumns(
	db: Queryable,
	workspaceId: number,
): Promise<HumanColumn[]> {
	const { rows } = await db.query(
		`SELECT id, title, position, wip_limit, policy, is_done, is_signable, signable_assignee_id
     FROM columns WHERE workspace_id = $1 AND board_id IS NULL ORDER BY position`,
		[workspaceId],
	);
	return rows;
}

export async function recordActivity(
	db: Queryable,
	actor: AuthUser,
	workspaceId: number,
	eventType: "create" | "update" | "move" | "reorder" | "delete",
	opts: {
		cardId?: number | null;
		fromColumnId?: number | null;
		toColumnId?: number | null;
		payload?: Record<string, unknown>;
	},
): Promise<void> {
	await db.query(
		`INSERT INTO card_events (card_id, from_column_id, to_column_id, actor_id, event_type, payload, workspace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[
			opts.cardId ?? null,
			opts.fromColumnId ?? null,
			opts.toColumnId ?? null,
			actor.id,
			eventType,
			JSON.stringify(opts.payload ?? {}),
			workspaceId,
		],
	);
}
