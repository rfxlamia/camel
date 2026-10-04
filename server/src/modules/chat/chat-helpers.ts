import type Anthropic from "@anthropic-ai/sdk";
import type { Request } from "express";
import type { Json } from "../../db/types.js";
import type { ToolEvent } from "../../lib/llm/tool-types.js";
import type { ChatMessage } from "./types.js";

/** Conservative input token budget before hard-failing long threads. */
export const MAX_CONTEXT_TOKENS = 180_000;

export const CHAT_TOOL_BUDGET = 3;

export const CHAT_SYSTEM_PROMPT = `You are Camel's AI assistant — helpful, concise, and accurate.

You can use tools to search the web, query kanban board data, and create downloadable files (markdown, text, or CSV).

When the user asks about board metrics, cards, or workspace activity:
- If you do not know which workspace they mean, ask them to clarify before calling query_board_data.
- Only call query_board_data after the user has indicated a workspace or when workspace context is clearly established.

When creating files, use the create_file tool with well-formatted content.`;

export type ChatMessageAction =
	| { kind: "send"; message: string; workspaceId?: number }
	| { kind: "retry"; messageId: number }
	| { kind: "invalid" };

export function resolveChatMessageAction(body: unknown): ChatMessageAction {
	if (body && typeof body === "object") {
		const record = body as Record<string, unknown>;
		if (record.action === "retry") {
			const messageId = record.messageId;
			if (typeof messageId === "number" && Number.isInteger(messageId)) {
				return { kind: "retry", messageId };
			}
			return { kind: "invalid" };
		}
		if (typeof record.message === "string") {
			const trimmed = record.message.trim();
			if (trimmed) {
				const workspaceId =
					record.workspaceId !== undefined &&
					typeof record.workspaceId === "number" &&
					Number.isInteger(record.workspaceId)
						? record.workspaceId
						: undefined;
				return { kind: "send", message: trimmed, workspaceId };
			}
		}
	}
	return { kind: "invalid" };
}

interface ToolTraceItem {
	toolName: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
}

export function getUserId(req: Request): number {
	if (req.user) return req.user.id;
	const fallback = (req as Request & { userId?: number }).userId;
	if (fallback !== undefined) return fallback;
	throw new Error("unauthenticated");
}

export function buildAnthropicMessages(
	messages: ChatMessage[],
): Anthropic.MessageParam[] {
	return messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map((m) => ({
			role: m.role as "user" | "assistant",
			content: m.content,
		}));
}

export function toolEventsToTrace(events: ToolEvent[]): Json {
	const items: ToolTraceItem[] = [];
	let pending: ToolTraceItem | null = null;

	for (const event of events) {
		if (event.phase === "started") {
			if (pending) items.push(pending);
			pending = {
				toolName: event.toolName ?? "",
				query: event.query,
			};
			continue;
		}

		if (event.phase === "result") {
			if (pending) {
				items.push({
					...pending,
					resultCount: event.resultCount,
				});
				pending = null;
			} else {
				items.push({
					toolName: event.toolName ?? "",
					query: event.query,
					resultCount: event.resultCount,
				});
			}
			continue;
		}

		if (event.phase === "failed") {
			if (pending) {
				items.push({
					...pending,
					errorCode: event.errorCode,
				});
				pending = null;
			} else {
				items.push({
					toolName: event.toolName ?? "",
					query: event.query,
					errorCode: event.errorCode,
				});
			}
		}
	}

	if (pending) items.push(pending);
	return items as unknown as Json;
}

export function attachmentContentType(format: string): string {
	switch (format) {
		case "md":
			return "text/markdown; charset=utf-8";
		case "txt":
			return "text/plain; charset=utf-8";
		case "csv":
			return "text/csv; charset=utf-8";
		default:
			return "application/octet-stream";
	}
}
