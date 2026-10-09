import type { Response } from "express";
import { runChatTurn } from "../../lib/llm/run-chat-turn.js";
import type { ToolEvent } from "../../lib/llm/tool-types.js";
import { logger } from "../../lib/logger.js";
import {
	buildAnthropicMessages,
	CHAT_SYSTEM_PROMPT,
	CHAT_TOOL_BUDGET,
	toolEventsToTrace,
} from "./chat-helpers.js";
import { ThreadNotFoundError } from "./message-runtime.js";
import type { createChatService } from "./service.js";
import {
	safeEndStream,
	safeWriteStreamEvent,
	setStreamHeaders,
} from "./stream-protocol.js";
import { createChatToolFactory } from "./tools/factory.js";
import type { ChatMessage, ChatThread } from "./types.js";

type Service = ReturnType<typeof createChatService>;
const STREAM_ERROR_MESSAGE = "Failed to generate response. Please try again.";
export async function generateMessage(
	service: Service,
	res: Response,
	userId: number,
	threadId: number,
	assistantRowId: number,
	workspaceId: number | undefined,
	history: ChatMessage[],
) {
	const toolEvents: ToolEvent[] = [];
	const toolFactory = createChatToolFactory({
		userId,
		threadId,
		messageId: assistantRowId,
		workspaceId,
		insertAttachment: async (row) => {
			await service.insertAttachment({ ...row, userId });
		},
	});

	// Intentionally keeps running after a client disconnect: safe writes
	// become no-ops, and the finished message is still persisted so it
	// shows up when the user reloads the thread.
	const result = await runChatTurn({
		systemPrompt: CHAT_SYSTEM_PROMPT,
		messages: buildAnthropicMessages(history),
		tools: toolFactory.resolveTools([
			"web_search",
			"query_board_data",
			"create_file",
		]),
		toolBudget: CHAT_TOOL_BUDGET,
		onToken: (text) => {
			safeWriteStreamEvent(res, { type: "token", text });
		},
		onThinking: (text) => {
			safeWriteStreamEvent(res, { type: "thinking", text });
		},
		onToolEvent: (event) => {
			toolEvents.push(event);
			safeWriteStreamEvent(res, { type: "tool_event", event });
		},
	});
	return { result, toolEvents };
}
export async function finishMessage(
	service: Service,
	res: Response,
	userId: number,
	threadId: number,
	assistantRowId: number,
	thread: ChatThread,
	history: ChatMessage[],
	userMessageText: string | undefined,
	generated: Awaited<ReturnType<typeof generateMessage>>,
) {
	const { result, toolEvents } = generated;
	const toolTrace = toolEventsToTrace(toolEvents);
	const updated = await service.updateMessage(assistantRowId, {
		content: result.output,
		thinking: result.thinking ?? null,
		toolTrace,
	});

	const firstUserMessage =
		userMessageText ?? history.find((m) => m.role === "user")?.content;
	if (firstUserMessage && thread.title === "Untitled") {
		await service.autoTitleThread(userId, threadId, firstUserMessage);
	}

	safeWriteStreamEvent(res, { type: "done", messageId: updated.id });
	safeEndStream(res);
}
export async function handleStreamError(
	service: Service,
	res: Response,
	threadId: number,
	assistantRowId: number | undefined,
	err: unknown,
) {
	logger.error({ err, threadId }, "chat message stream failed");
	if (assistantRowId !== undefined) {
		try {
			await service.deleteMessage(assistantRowId);
		} catch (cleanupErr) {
			logger.error({ err: cleanupErr, threadId }, "chat stream cleanup failed");
		}
	}
	// Raw err.message may leak driver/SDK internals — log it, send safe copy.
	// The user message is intentionally retained for inline retry.
	if (!res.headersSent) {
		setStreamHeaders(res);
		res.status(200);
	}
	// A vanished thread can never succeed on retry; everything else can.
	const threadGone = err instanceof ThreadNotFoundError;
	safeWriteStreamEvent(res, {
		type: "error",
		message: threadGone ? "Thread not found" : STREAM_ERROR_MESSAGE,
		retryable: !threadGone,
	});
	safeEndStream(res);
}
