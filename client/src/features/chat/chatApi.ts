import type { ApiRequest } from "../../shared/apiRequest";
import type { ChatMessage, ChatThread } from "../../types";

export function createChatApi(request: ApiRequest) {
	return {
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
				return request.stream(`/chat/threads/${threadId}/messages`, body);
			},
			retryMessage: (threadId: number, messageId: number) =>
				request.stream(`/chat/threads/${threadId}/messages`, {
					action: "retry",
					messageId,
				}),
			downloadAttachment: (attachmentId: number) =>
				request.blob(`/chat/attachments/${attachmentId}`),
		},
	};
}
