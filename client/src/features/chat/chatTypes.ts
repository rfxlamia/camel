import type { ToolTraceItem } from "../agent";

export type ChatMessageRole = "user" | "assistant" | "error";
export type ChatAttachmentFormat = "md" | "txt" | "csv";

export interface ChatThread {
	id: number;
	title: string;
	userId?: number;
	messageCount?: number;
	createdAt?: string;
	updatedAt?: string;
}

export interface ChatMessage {
	id: number;
	threadId?: number;
	role: ChatMessageRole;
	content: string;
	thinking?: string | null;
	toolTrace?: ToolTraceItem[] | null;
	attachments?: ChatAttachment[];
	createdAt?: string;
}

export interface ChatAttachment {
	id: number;
	messageId?: number;
	filename: string;
	format: ChatAttachmentFormat;
	content?: string;
	createdAt?: string;
}

export type ChatToolEvent = {
	phase: string;
	toolName?: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
};

export type StreamEvent =
	| { type: "token"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool_event"; event: ChatToolEvent }
	| { type: "done"; messageId: number }
	| { type: "error"; message: string; retryable?: boolean };
