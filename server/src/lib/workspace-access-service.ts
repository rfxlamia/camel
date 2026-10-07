import type { AuthUser } from "../auth.js";
import {
	checkActorCanChangeRole,
	checkActorCanManage,
	checkCanRemoveUser,
} from "./workspace-membership.js";

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
		actor: AuthUser,
	) => Promise<{
		userId: number;
		username: string;
		focusSessionFinished: boolean;
	} | null>;
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
			  }
			| {
					type: "focus_session.updated";
					userId: number;
					workspaceId: number;
					payload: { session: null };
			  },
	) => Promise<void>;
	clearPresence: (workspaceId: number, userId: number) => Promise<void>;
};

export function createWorkspaceAccessService(deps: WorkspaceAccessDeps) {
	return {
		async removeMember({
			actorId,
			actor,
			workspaceId,
			userId,
		}: {
			actorId: number;
			actor: AuthUser;
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

			const removed = await deps.removeMember(workspaceId, userId, actor);
			if (!removed) return { status: 404 as const, error: "Not found" };
			deps.clearPresence(workspaceId, userId).catch(() => {
				// best-effort; member already removed
			});
			if (removed.focusSessionFinished) {
				await deps
					.publishEvent(workspaceId, {
						type: "focus_session.updated",
						userId: removed.userId,
						workspaceId,
						payload: { session: null },
					})
					.catch(() => {
						// best-effort; member already removed
					});
			}
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
