import type {
	ActivityEvent,
	AgentArtifact,
	AgentBoard,
	AgentCardOutput,
	Board,
	Card,
	Column,
	FlowMetrics,
	MetricsHistoryBucket,
	PresenceUser,
	SettingsMap,
	User,
	Workspace,
	WorkspaceListResponse,
	WorkspaceMember,
} from "./types";

class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public code?: string,
	) {
		super(message);
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api${path}`, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
	if (!res.ok) {
		let message = `Request failed (${res.status})`;
		let code: string | undefined;
		try {
			const body = await res.json();
			if (body.error) message = body.error;
			if (body.message) message = body.message;
			if (body.code) code = body.code;
		} catch {
			// non-JSON error body
		}
		throw new ApiError(message, res.status, code);
	}
	if (res.status === 204) return undefined as T;
	return res.json();
}

export const api = {
	getBoard: (workspaceId: number) =>
		request<Board>(`/workspaces/${workspaceId}/board`),
	getMetrics: (workspaceId: number) =>
		request<FlowMetrics>(`/workspaces/${workspaceId}/metrics`),
	getMetricsHistory: (workspaceId: number, weeks?: number) =>
		request<{ weeks: MetricsHistoryBucket[] }>(
			weeks !== undefined
				? `/workspaces/${workspaceId}/metrics/history?weeks=${weeks}`
				: `/workspaces/${workspaceId}/metrics/history`,
		),
	getCard: (workspaceId: number, id: number) =>
		request<Card>(`/workspaces/${workspaceId}/cards/${id}`),
	createCard: (
		workspaceId: number,
		body: { columnId: number; title: string; description?: string },
	) =>
		request<Card>(`/workspaces/${workspaceId}/cards`, {
			method: "POST",
			body: JSON.stringify({
				columnId: body.columnId,
				title: body.title,
				description: body.description ?? "",
			}),
		}),
	updateCard: (
		workspaceId: number,
		id: number,
		patch: { title?: string; description?: string; version?: number },
	) =>
		request<Card>(`/workspaces/${workspaceId}/cards/${id}`, {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),
	deleteCard: (workspaceId: number, id: number) =>
		request<void>(`/workspaces/${workspaceId}/cards/${id}`, {
			method: "DELETE",
		}),
	getCardActivity: (workspaceId: number, id: number) =>
		request<{ events: ActivityEvent[] }>(
			`/workspaces/${workspaceId}/cards/${id}/activity`,
		),
	moveCard: (
		workspaceId: number,
		id: number,
		body: { toColumnId: number; index: number; version?: number },
	) =>
		request<Card>(`/workspaces/${workspaceId}/cards/${id}/move`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	createColumn: (workspaceId: number, title: string) =>
		request<Column>(`/workspaces/${workspaceId}/columns`, {
			method: "POST",
			body: JSON.stringify({ title }),
		}),
	updateColumn: (
		workspaceId: number,
		id: number,
		patch: { title?: string; wipLimit?: number | null; policy?: string },
	) =>
		request<Column>(`/workspaces/${workspaceId}/columns/${id}`, {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),

	// ---- Auth ----
	register: (username: string, password: string, displayName: string) =>
		request<{ user: User }>("/auth/register", {
			method: "POST",
			body: JSON.stringify({ username, password, displayName }),
		}),
	login: (username: string, password: string) =>
		request<{ user: User }>("/auth/login", {
			method: "POST",
			body: JSON.stringify({ username, password }),
		}),
	logout: () => request<void>("/auth/logout", { method: "POST" }),
	me: () => request<{ user: User }>("/auth/me"),

	// ---- Collaboration ----
	getActivity: (workspaceId: number, limit?: number) =>
		request<{ events: ActivityEvent[] }>(
			limit !== undefined
				? `/workspaces/${workspaceId}/activity?limit=${limit}`
				: `/workspaces/${workspaceId}/activity`,
		),
	getPresence: (workspaceId: number) =>
		request<{ users: PresenceUser[] }>(`/workspaces/${workspaceId}/presence`),
	heartbeat: (workspaceId: number) =>
		request<{ ok: boolean }>(`/workspaces/${workspaceId}/presence/heartbeat`, {
			method: "POST",
		}),

	// Settings
	getSettings: (workspaceId: number) =>
		request<SettingsMap>(`/workspaces/${workspaceId}/settings`),
	updateSettings: (
		workspaceId: number,
		settings: Array<{
			key: string;
			textValue?: string;
			boolValue?: boolean;
			version: number;
		}>,
	) =>
		request<SettingsMap>(`/workspaces/${workspaceId}/settings`, {
			method: "PATCH",
			body: JSON.stringify(settings),
		}),
	resetSettings: (workspaceId: number) =>
		request<void>(`/workspaces/${workspaceId}/settings`, { method: "DELETE" }),
	uploadLogo: async (workspaceId: number, file: File): Promise<SettingsMap> => {
		const formData = new FormData();
		formData.append("logo", file);
		const res = await fetch(`/api/workspaces/${workspaceId}/settings/logo`, {
			method: "POST",
			body: formData,
		});
		if (!res.ok) {
			let message = `Upload failed (${res.status})`;
			try {
				const body = await res.json();
				if (body.error) message = body.error;
			} catch {
				// non-JSON error body
			}
			throw new ApiError(message, res.status);
		}
		return res.json();
	},

	// ---- Workspaces ----
	getWorkspaces: () => request<WorkspaceListResponse>("/workspaces"),
	createWorkspace: (body: { name: string }) =>
		request<Workspace>("/workspaces", {
			method: "POST",
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
		request<{ ok: boolean }>(`/workspaces/${workspaceId}/transfer-ownership`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	deleteWorkspace: (workspaceId: number) =>
		request<void>(`/workspaces/${workspaceId}`, { method: "DELETE" }),

	// ---- Agent ----
	createAgentBoard: (workspaceId: number, intent: string) =>
		request<{ boardId: number; explanation: string }>(
			`/workspaces/${workspaceId}/agent/boards`,
			{
				method: "POST",
				body: JSON.stringify({ intent }),
			},
		),
	sendAgentBoardMessage: (
		workspaceId: number,
		boardId: number,
		payload: string | { action: "confirm_regenerate" | "cancel_regenerate" },
	) => {
		const body =
			typeof payload === "string"
				? { message: payload }
				: { action: payload.action };
		return request<{
			explanation: string;
			boardUpdated: boolean;
			streamed?: boolean;
			pendingRegenerate?: boolean;
		}>(
			`/workspaces/${workspaceId}/agent/boards/${boardId}/message`,
			{ method: "POST", body: JSON.stringify(body) },
		);
	},
	approveAgentBoard: (workspaceId: number, boardId: number) =>
		request<void>(
			`/workspaces/${workspaceId}/agent/boards/${boardId}/approve`,
			{ method: "POST" },
		),
	getAgentBoards: (workspaceId: number) =>
		request<AgentBoard[]>(`/workspaces/${workspaceId}/agent/boards`),
	getAgentBoard: (workspaceId: number, boardId: number) =>
		request<AgentBoard>(`/workspaces/${workspaceId}/agent/boards/${boardId}`),
	getAgentCardOutput: (
		workspaceId: number,
		boardId: number,
		columnSlug: string,
	) =>
		request<AgentCardOutput>(
			`/workspaces/${workspaceId}/agent/boards/${boardId}/outputs/${columnSlug}`,
		),
	getAgentArtifact: (workspaceId: number, boardId: number) =>
		request<AgentArtifact>(
			`/workspaces/${workspaceId}/agent/boards/${boardId}/artifact`,
		),
	agentArtifactDownloadUrl: (workspaceId: number, boardId: number) =>
		`/api/workspaces/${workspaceId}/agent/boards/${boardId}/artifact/download`,
};

export { ApiError };
