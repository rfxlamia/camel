import type { ApiRequest } from "../../shared/apiRequest";
import type {
	Workspace,
	WorkspaceListResponse,
	WorkspaceMember,
} from "../../types";

export function createWorkspacesApi(request: ApiRequest) {
	return {
		getWorkspaces: () => request<WorkspaceListResponse>("/workspaces"),

		createWorkspace: (body: { name: string }) =>
			request<Workspace>("/workspaces", {
				method: "POST",
				body: JSON.stringify(body),
			}),

		updateWorkspace: (workspaceId: number, body: { name: string }) =>
			request<Workspace>(`/workspaces/${workspaceId}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),

		getWorkspaceMembers: (workspaceId: number) =>
			request<{ members: WorkspaceMember[] }>(
				`/workspaces/${workspaceId}/members`,
			),

		addWorkspaceMember: (
			workspaceId: number,
			body: { username: string; role?: WorkspaceMember["role"] },
		) =>
			request<
				| WorkspaceMember
				| {
						id: number;
						workspaceId: number;
						username: string;
						role: string;
						pending: true;
				  }
			>(`/workspaces/${workspaceId}/members`, {
				method: "POST",
				body: JSON.stringify(body),
			}),

		removeWorkspaceMember: (workspaceId: number, userId: number) =>
			request<void>(`/workspaces/${workspaceId}/members/${userId}`, {
				method: "DELETE",
			}),

		updateWorkspaceMemberRole: (
			workspaceId: number,
			userId: number,
			body: { role: "admin" | "member" },
		) =>
			request<WorkspaceMember>(`/workspaces/${workspaceId}/members/${userId}`, {
				method: "PATCH",
				body: JSON.stringify(body),
			}),

		acceptInvite: (workspaceId: number, inviteId: number) =>
			request<Workspace>(
				`/workspaces/${workspaceId}/invites/${inviteId}/accept`,
				{ method: "POST" },
			),

		declineInvite: (workspaceId: number, inviteId: number) =>
			request<void>(`/workspaces/${workspaceId}/invites/${inviteId}`, {
				method: "DELETE",
			}),

		transferWorkspaceOwnership: (
			workspaceId: number,
			body: { newOwnerId: number; previousOwnerRole: WorkspaceMember["role"] },
		) =>
			request<{ ok: boolean }>(
				`/workspaces/${workspaceId}/transfer-ownership`,
				{
					method: "POST",
					body: JSON.stringify(body),
				},
			),

		leaveWorkspace: (workspaceId: number) =>
			request<void>(`/workspaces/${workspaceId}/leave`, { method: "POST" }),

		deleteWorkspace: (workspaceId: number) =>
			request<void>(`/workspaces/${workspaceId}`, { method: "DELETE" }),
	};
}
