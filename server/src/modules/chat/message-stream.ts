import type { Request, Response } from "express";
import { lookupMembership } from "../../lib/helpers.js";
import { logger } from "../../lib/logger.js";
import type { ToolEvent } from "../agent/index.js";
import { checkChatLimit } from "../agent/index.js";
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
import { setStreamHeaders, writeStreamEvent } from "./stream-protocol.js";
import { createChatToolFactory } from "./tools/factory.js";

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
			let streamed = false;

			try {
				if (action.kind === "send") {
					const userRow = await service.insertMessage({
						userId,
						threadId,
						role: "user",
						content: action.message,
					});
					if (!userRow) {
						throw new Error("Thread not found");
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
					throw new Error("Thread not found");
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
						streamed = true;
						writeStreamEvent(res, { type: "token", text });
					},
					onThinking: (text) => {
						writeStreamEvent(res, { type: "thinking", text });
					},
					onToolEvent: (event) => {
						toolEvents.push(event);
						writeStreamEvent(res, { type: "tool_event", event });
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

				writeStreamEvent(res, { type: "done", messageId: updated.id });
				res.end();
			} catch (err) {
				logger.error({ err, threadId }, "chat message stream failed");
				if (assistantRowId !== undefined) {
					await service.deleteMessage(assistantRowId);
				}
				const message =
					err instanceof Error ? err.message : "Failed to generate response";
				if (!res.headersSent) {
					setStreamHeaders(res);
					res.status(200);
				}
				writeStreamEvent(res, {
					type: "error",
					message,
					retryable: true,
				});
				res.end();
				if (!streamed && action.kind === "send") {
					// user message retained for inline retry per spec
				}
			}
		} catch (err) {
			logger.error({ err, threadId }, "chat postMessage failed");
			if (!res.headersSent) {
				res.status(500).json({ error: "Failed to send message" });
			}
		}
	};
}
