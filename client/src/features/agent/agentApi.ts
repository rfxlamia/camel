import type { ApiRequest } from "../../shared/apiRequest";
import type { AgentArtifact, AgentBoard, AgentCardOutput } from "../../types";

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

export function createAgentApi(request: ApiRequest) {
	return {
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

		retryAgentBoard: (workspaceId: number, boardId: number) =>
			request<{ boardId: number }>(
				`/workspaces/${workspaceId}/agent/boards/${boardId}/retry`,
				{ method: "POST" },
			),

		getAgentBoards: (workspaceId: number) =>
			request<AgentBoard[]>(`/workspaces/${workspaceId}/agent/boards`),

		getAgentBoard: (workspaceId: number, boardId: number) =>
			request<AgentBoard & { retryOfBoardId: number | null }>(
				`/workspaces/${workspaceId}/agent/boards/${boardId}`,
			),

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
}
