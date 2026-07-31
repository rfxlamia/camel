import type { Json } from "../db/types.js";

export type ChatMessageRole = "user" | "assistant" | "error";
export type ChatAttachmentFormat = "md" | "txt" | "csv";

export interface ChatThread {
	id: number;
	userId: number;
	title: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface ChatMessage {
	id: number;
	threadId: number;
	role: ChatMessageRole;
	content: string;
	thinking: string | null;
	toolTrace: Json | null;
	createdAt: Date;
}

export interface ChatAttachment {
	id: number;
	messageId: number;
	filename: string;
	format: ChatAttachmentFormat;
	content: string;
	createdAt: Date;
}

export interface InsertMessageParams {
	userId: number;
	threadId: number;
	role: ChatMessageRole;
	content: string;
	thinking?: string | null;
	toolTrace?: Json | null;
}

export interface InsertAttachmentParams {
	userId: number;
	messageId: number;
	filename: string;
	format: ChatAttachmentFormat;
	content: string;
}
