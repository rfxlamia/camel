import type { TemplateColumn } from "./lib/templates";
import { publishAutoError } from "./lib/ticketIntakeBus";
import type {
	ActivityEvent,
	AgentArtifact,
	AgentBoard,
	AgentCardOutput,
	Board,
	Card,
	ChatMessage,
	ChatThread,
	Column,
	FlowMetrics,
	MetricsHistoryBucket,
	NotificationsResponse,
	PresenceUser,
	SettingsMap,
	User,
	TrackerEvent,
	TrackerItem,
	TrackerVocabulary,
	TrackerVocabularyKind,
	Workspace,
	WorkspaceListResponse,
	WorkspaceMember,
} from "./types";

class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public code?: string,
		public retryAfterMs?: number,
	) {
		super(message);
	}
}

function readCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	const match = document.cookie.match(
		new RegExp(
			"(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)",
		),
	);
	return match ? decodeURIComponent(match[1]) : null;
}

interface RequestOptions {
	userInitiated?: boolean;
	userAction?: string;
}

export type TicketIntakeDraft = {
	title: string | null;
	description: string | null;
	expected: string | null;
	actual: string | null;
	repro: string | null;
	type: "Bug" | "Feature" | "Improvement" | null;
};

export type TicketIntakeChatResponse =
	| { ready: false; question: string }
	| { ready: true; draft: TicketIntakeDraft };

export type TicketHistoryEntry = {
	title: string;
	issueUrl: string;
	createdAt: string;
};

async function request<T>(
	path: string,
	init?: RequestInit,
	options?: RequestOptions,
): Promise<T> {
	const method = (init?.method ?? "GET").toUpperCase();
	const headers = new Headers(init?.headers);
	const endpoint = `/api${path}`;

	if (!headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	// Add CSRF token for mutating requests
	if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
		const csrf = readCookie("csrf_token");
		if (csrf) headers.set("X-CSRF-Token", csrf);
	}

	const res = await fetch(endpoint, {
		...init,
		headers,
	});
	if (!res.ok) {
		let message = `Request failed (${res.status})`;
		let code: string | undefined;
		let retryAfterMs: number | undefined;
		try {
			const body = await res.json();
			if (body.error) message = body.error;
			if (body.message) message = body.message;
			if (body.code) code = body.code;
			if (typeof body.retryAfterMs === "number") {
				retryAfterMs = body.retryAfterMs;
			}
		} catch {
			// non-JSON error body
		}
		if (options?.userInitiated && res.status >= 500) {
			publishAutoError({
				endpoint,
				status: res.status,
				message,
				timestamp: new Date().toISOString(),
				userAction: options.userAction,
			});
		}
		throw new ApiError(message, res.status, code, retryAfterMs);
	}
	if (res.status === 204) return undefined as T;
	return res.json();
}

async function chatStream(
	threadId: number,
	body: Record<string, unknown>,
): Promise<ReadableStream<Uint8Array>> {
	const headers = new Headers({ "Content-Type": "application/json" });
	const csrf = readCookie("csrf_token");
	if (csrf) headers.set("X-CSRF-Token", csrf);

	const res = await fetch(`/api/chat/threads/${threadId}/messages`, {
		method: "POST",
		headers,
		credentials: "include",
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		let message = `Request failed (${res.status})`;
		let code: string | undefined;
		let retryAfterMs: number | undefined;
		try {
			const errorBody = await res.json();
			if (errorBody.error) message = errorBody.error;
			if (errorBody.message) message = errorBody.message;
			if (errorBody.code) code = errorBody.code;
			if (typeof errorBody.retryAfterMs === "number") {
				retryAfterMs = errorBody.retryAfterMs;
			}
		} catch {
			// non-JSON error body
		}
		throw new ApiError(message, res.status, code, retryAfterMs);
	}

	if (!res.body) {
		throw new ApiError("Empty response body", res.status);
	}

	return res.body;
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
		request<Card>(
			`/workspaces/${workspaceId}/cards`,
			{
				method: "POST",
				body: JSON.stringify({
					columnId: body.columnId,
					title: body.title,
					description: body.description ?? "",
				}),
			},
			{ userInitiated: true, userAction: "submit" },
		),
	updateCard: (
		workspaceId: number,
		id: number,
		patch: {
			title?: string;
			description?: string;
			assigneeIds?: number[];
			dueDate?: string | null;
			version?: number;
		},
	) =>
		request<Card>(
			`/workspaces/${workspaceId}/cards/${id}`,
			{
				method: "PATCH",
				body: JSON.stringify(patch),
			},
			{ userInitiated: true, userAction: "Save" },
		),
	deleteCard: (workspaceId: number, id: number, version?: number) =>
		request<void>(`/workspaces/${workspaceId}/cards/${id}`, {
			method: "DELETE",
			body: JSON.stringify({ version }),
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
		request<Card>(
			`/workspaces/${workspaceId}/cards/${id}/move`,
			{
				method: "POST",
				body: JSON.stringify(body),
			},
			{ userInitiated: true, userAction: "drag-drop" },
		),
	createColumn: (workspaceId: number, title: string) =>
		request<Column>(`/workspaces/${workspaceId}/columns`, {
			method: "POST",
			body: JSON.stringify({ title }),
		}),
	applyTemplate: (
		workspaceId: number,
		body: { templateName: string; columns: TemplateColumn[] },
	) =>
		request<Column[]>(`/workspaces/${workspaceId}/columns/batch`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	updateColumn: (
		workspaceId: number,
		id: number,
		patch: {
			title?: string;
			wipLimit?: number | null;
			policy?: string;
			isDone?: boolean;
			isSignable?: boolean;
			signableAssigneeId?: number | null;
			color?: string | null;
		},
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
	setUsername: (username: string, displayName?: string) =>
		request<{ ok: boolean }>("/auth/set-username", {
			method: "POST",
			body: JSON.stringify({ username, displayName }),
		}),
	setPassword: (password: string) =>
		request<{ ok: boolean }>("/auth/set-password", {
			method: "POST",
			body: JSON.stringify({ password }),
		}),
	startOAuth: async (provider: "google" | "github") => {
		const res = await fetch("/api/auth/sign-in/social", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				provider,
				callbackURL: "/api/auth/complete-oauth",
				redirect: false,
			}),
		});
		const data = await res.json();
		if (data.url) window.location.href = data.url;
	},

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

	// ---- Notifications ----
	getNotifications: (
		workspaceId: number,
		opts?: { cursor?: number; limit?: number },
	) => {
		const params = new URLSearchParams();
		if (opts?.cursor !== undefined) params.set("cursor", String(opts.cursor));
		if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
		const query = params.toString();
		return request<NotificationsResponse>(
			query
				? `/workspaces/${workspaceId}/notifications?${query}`
				: `/workspaces/${workspaceId}/notifications`,
		);
	},
	markNotificationAsRead: (workspaceId: number, id: number) =>
		request<{ ok: boolean }>(
			`/workspaces/${workspaceId}/notifications/${id}/read`,
			{ method: "PATCH" },
		),
	markAllNotificationsAsRead: (workspaceId: number) =>
		request<{ ok: boolean; markedCount: number }>(
			`/workspaces/${workspaceId}/notifications/read-all`,
			{ method: "POST" },
		),

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
		const headers = new Headers();
		const csrf = readCookie("csrf_token");
		if (csrf) headers.set("X-CSRF-Token", csrf);
		const res = await fetch(`/api/workspaces/${workspaceId}/settings/logo`, {
			method: "POST",
			headers,
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

	// ---- Tracker ----
	createTrackerItem: (
		workspaceId: number,
		body: {
			title: string;
			description?: string;
			statusId?: number;
			priorityId?: number | null;
			assigneeIds?: number[];
		},
	) =>
		request<TrackerItem>(`/workspaces/${workspaceId}/tracker/items`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	listTrackerItems: (workspaceId: number, opts?: { q?: string }) => {
		const params = new URLSearchParams();
		if (opts?.q !== undefined) params.set("q", opts.q);
		const query = params.toString();
		return request<TrackerItem[]>(
			query
				? `/workspaces/${workspaceId}/tracker/items?${query}`
				: `/workspaces/${workspaceId}/tracker/items`,
		);
	},
	getTrackerItem: (workspaceId: number, key: string) =>
		request<TrackerItem>(`/workspaces/${workspaceId}/tracker/items/${key}`),
	updateTrackerItem: (
		workspaceId: number,
		key: string,
		patch: {
			title?: string;
			description?: string;
			statusId?: number;
			priorityId?: number | null;
			assigneeIds?: number[];
			version?: number;
		},
	) =>
		request<TrackerItem>(`/workspaces/${workspaceId}/tracker/items/${key}`, {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),
	deleteTrackerItem: (
		workspaceId: number,
		key: string,
		body?: { version?: number },
	) =>
		request<void>(`/workspaces/${workspaceId}/tracker/items/${key}`, {
			method: "DELETE",
			body: JSON.stringify(body ?? {}),
		}),
	getTrackerChangelog: (workspaceId: number, key: string) =>
		request<{ events: TrackerEvent[] }>(
			`/workspaces/${workspaceId}/tracker/items/${key}/events`,
		),
	listTrackerVocabularies: (workspaceId: number, kind: TrackerVocabularyKind) =>
		request<TrackerVocabulary[]>(
			`/workspaces/${workspaceId}/tracker/vocabularies?kind=${kind}`,
		),
	createTrackerVocabulary: (
		workspaceId: number,
		body: {
			kind: TrackerVocabularyKind;
			name: string;
			position: number;
			colour?: string;
		},
	) =>
		request<TrackerVocabulary>(`/workspaces/${workspaceId}/tracker/vocabularies`, {
			method: "POST",
			body: JSON.stringify(body),
		}),

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
		}>(`/workspaces/${workspaceId}/agent/boards/${boardId}/message`, {
			method: "POST",
			body: JSON.stringify(body),
		});
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

	// ---- Chat ----
	chat: {
		listThreads: () =>
			request<ChatThread[]>("/chat/threads", { credentials: "include" }),
		createThread: () =>
			request<ChatThread>("/chat/threads", {
				method: "POST",
				credentials: "include",
			}),
		renameThread: (threadId: number, title: string) =>
			request<ChatThread>(`/chat/threads/${threadId}`, {
				method: "PATCH",
				body: JSON.stringify({ title }),
				credentials: "include",
			}),
		deleteThread: (threadId: number) =>
			request<void>(`/chat/threads/${threadId}`, {
				method: "DELETE",
				credentials: "include",
			}),
		getMessages: async (threadId: number) => {
			const data = await request<
				ChatMessage[] | (ChatThread & { messages: ChatMessage[] })
			>(`/chat/threads/${threadId}`, { credentials: "include" });
			return Array.isArray(data) ? data : data.messages;
		},
		sendMessage: (
			threadId: number,
			message: string,
			opts?: { workspaceId?: number },
		) => {
			const body: { message: string; workspaceId?: number } = { message };
			if (opts?.workspaceId !== undefined) {
				body.workspaceId = opts.workspaceId;
			}
			return chatStream(threadId, body);
		},
		retryMessage: (threadId: number, messageId: number) =>
			chatStream(threadId, { action: "retry", messageId }),
		downloadAttachment: async (attachmentId: number) => {
			const res = await fetch(`/api/chat/attachments/${attachmentId}`, {
				credentials: "include",
			});
			if (!res.ok) {
				let message = `Request failed (${res.status})`;
				try {
					const errorBody = await res.json();
					if (errorBody.error) message = errorBody.error;
					if (errorBody.message) message = errorBody.message;
				} catch {
					// non-JSON error body
				}
				throw new ApiError(message, res.status);
			}
			return res.blob();
		},
	},

	// ---- Ticket intake ----
	ticketIntake: {
		getConfig: () => request<{ enabled: boolean }>("/ticket-intake/config"),
		getChatLimit: (workspaceId: number) =>
			request<{ isLocked: boolean; retryAfterMs?: number }>(
				`/workspaces/${workspaceId}/ticket-intake/chat-limit`,
			),
		sendMessage: (
			workspaceId: number,
			body: {
				message: string;
				isFirstTurn?: boolean;
				autoError?: boolean;
				conversationHistory?: Array<{ role: string; content: string }>;
			},
		) =>
			request<TicketIntakeChatResponse>(
				`/workspaces/${workspaceId}/ticket-intake/chat`,
				{
					method: "POST",
					body: JSON.stringify(body),
				},
			),
		submit: (
			workspaceId: number,
			body: {
				title: string;
				description: string;
				type: string;
				cardId?: number;
				source?: string;
			},
		) =>
			request<{ status: "submitting" }>(
				`/workspaces/${workspaceId}/ticket-intake/submit`,
				{
					method: "POST",
					body: JSON.stringify(body),
				},
			),
		resubmit: (
			workspaceId: number,
			body: {
				title: string;
				description: string;
				type: string;
				cardId?: number;
				source?: string;
			},
		) =>
			request<{ status: "submitting" }>(
				`/workspaces/${workspaceId}/ticket-intake/resubmit`,
				{
					method: "POST",
					body: JSON.stringify(body),
				},
			),
		getHistory: (workspaceId: number, cardId: number) =>
			request<{ tickets: TicketHistoryEntry[] }>(
				`/workspaces/${workspaceId}/ticket-intake/history?cardId=${cardId}`,
			),
	},
};

export { ApiError };
