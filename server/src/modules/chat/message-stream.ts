import type { Request, Response } from "express";
import { checkChatLimit } from "../../lib/chat-rate-limit.js";
import { lookupMembership } from "../../lib/helpers.js";
import { logger } from "../../lib/logger.js";
import type { ToolEvent } from "../agent/index.js";
import {
	buildAnthropicMessages,
	CHAT_SYSTEM_PROMPT,
	CHAT_TOOL_BUDGET,
	getUserId,
	MAX_CONTEXT_TOKENS,
	resolveChatMessageAction,
	toolEventsToTrace,
} from "./chat-helpers.js";
import { estimateContextTokens, runChatTurn } from "./run-chat-turn.js";
import type { createChatService } from "./service.js";
import {
	safeEndStream,
	safeWriteStreamEvent,
	setStreamHeaders,
} from "./stream-protocol.js";
import { createChatToolFactory } from "./tools/factory.js";

class ThreadNotFoundError extends Error {
	constructor() {
		super("Thread not found");
	}
}

const STREAM_ERROR_MESSAGE = "Failed to generate response. Please try again.";

export function createPostMessageHandler(
	service: ReturnType<typeof createChatService>,
) {
	return async (req: Request, res: Response) => {
		const threadId = Number(req.params.id);
		if (!Number.isInteger(threadId)) {
			return res.status(400).json({ error: "thread id must be an integer" });
		}

		const action = resolveChatMessageAction(req.body);
		if (action.kind === "invalid") {
			return res.status(400).json({ error: "message or action is required" });
		}

		try {
			const userId = getUserId(req);
			const thread = await service.getThread(userId, threadId);
			if (!thread) {
				return res.status(404).json({ error: "Not found" });
			}

			const workspaceId =
				action.kind === "send" ? action.workspaceId : undefined;
			if (workspaceId !== undefined) {
				const membership = await lookupMembership(userId, workspaceId);
				if (!membership) {
					return res.status(404).json({ error: "Not found" });
				}
			}

			const rateLimit = await checkChatLimit(userId);
			if (rateLimit.isLocked) {
				return res.status(429).json({
					error: "Too many chat messages",
					...(rateLimit.retryAfterMs !== undefined
						? { retryAfterMs: rateLimit.retryAfterMs }
						: {}),
				});
			}

			let history = await service.getMessages(threadId);
			let userMessageText: string | undefined;
			let retryTargetId: number | undefined;

			if (action.kind === "send") {
				const candidateMessages = [
					...history,
					{
						id: 0,
						threadId,
						role: "user" as const,
						content: action.message,
						thinking: null,
						toolTrace: null,
						createdAt: new Date(),
					},
				];
				const tokens = estimateContextTokens(
					buildAnthropicMessages(candidateMessages),
				);
				if (tokens > MAX_CONTEXT_TOKENS) {
					return res.status(413).json({
						message: "Thread too long, start a new chat",
					});
				}

				userMessageText = action.message;
			} else {
				const target = await service.getMessage(userId, action.messageId);
				if (!target || target.threadId !== threadId) {
					return res.status(404).json({ error: "Not found" });
				}
				retryTargetId = target.id;
				history = history.filter((m) => m.id < target.id);
				const tokens = estimateContextTokens(buildAnthropicMessages(history));
				if (tokens > MAX_CONTEXT_TOKENS) {
					return res.status(413).json({
						message: "Thread too long, start a new chat",
					});
				}
			}

			setStreamHeaders(res);
			res.status(200);

			let assistantRowId: number | undefined;

			try {
				if (action.kind === "send") {
					const userRow = await service.insertMessage({
						userId,
						threadId,
						role: "user",
						content: action.message,
					});
					if (!userRow) {
						throw new ThreadNotFoundError();
					}
					history = [...history, userRow];
				} else if (retryTargetId !== undefined) {
					await service.deleteMessage(retryTargetId);
					history = history.filter((m) => m.id !== retryTargetId);
				}

				const placeholder = await service.insertMessage({
					userId,
					threadId,
					role: "assistant",
					content: "",
				});
				if (!placeholder) {
					throw new ThreadNotFoundError();
				}
				assistantRowId = placeholder.id;

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
			} catch (err) {
				logger.error({ err, threadId }, "chat message stream failed");
				if (assistantRowId !== undefined) {
					try {
						await service.deleteMessage(assistantRowId);
					} catch (cleanupErr) {
						logger.error(
							{ err: cleanupErr, threadId },
							"chat stream cleanup failed",
						);
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
		} catch (err) {
			logger.error({ err, threadId }, "chat postMessage failed");
			if (!res.headersSent) {
				res.status(500).json({ error: "Failed to send message" });
			}
		}
	};
}
