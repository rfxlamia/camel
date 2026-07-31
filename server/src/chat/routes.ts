/**
 * Chat REST routes — thread CRUD and NDJSON streaming message endpoint.
 *
 * Mounts under /api so full paths are:
 *   GET    /api/chat/threads
 *   POST   /api/chat/threads
 *   GET    /api/chat/threads/:id
 *   PATCH  /api/chat/threads/:id
 *   DELETE /api/chat/threads/:id
 *   POST   /api/chat/threads/:id/messages
 *   GET    /api/chat/attachments/:id
 */

import type Anthropic from "@anthropic-ai/sdk";
import express, { type Request, Router } from "express";
import type { ToolEvent } from "../agent/tools/types.js";
import { checkChatLimit } from "../agent/ticket-intake/rate-limits.js";
import { requireAuth } from "../auth.js";
import type { Json } from "../db/types.js";
import { db } from "../db/kysely.js";
import { lookupMembership } from "../routes/helpers.js";
import { estimateContextTokens, runChatTurn } from "./run-chat-turn.js";
import { createChatService } from "./service.js";
import { setStreamHeaders, writeStreamEvent } from "./stream-protocol.js";
import { createChatToolFactory } from "./tools/factory.js";
import type { ChatMessage } from "./types.js";

/** Conservative input token budget before hard-failing long threads. */
export const MAX_CONTEXT_TOKENS = 180_000;

const CHAT_TOOL_BUDGET = 3;

const CHAT_SYSTEM_PROMPT = `You are Camel's AI assistant — helpful, concise, and accurate.

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

function getUserId(req: Request): number {
	if (req.user) return req.user.id;
	const fallback = (req as Request & { userId?: number }).userId;
	if (fallback !== undefined) return fallback;
	throw new Error("unauthenticated");
}

function buildAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
	return messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		.map((m) => ({
			role: m.role as "user" | "assistant",
			content: m.content,
		}));
}

function toolEventsToTrace(events: ToolEvent[]): Json {
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

function attachmentContentType(format: string): string {
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

export function createChatRouter(): Router {
	const router = Router();
	const service = createChatService(db);

	router.use(express.json());

	router.get("/api/chat/threads", requireAuth, async (req, res) => {
		try {
			const threads = await service.listThreads(getUserId(req));
			res.json(threads);
		} catch (err) {
			console.error("chat listThreads error:", err);
			res.status(500).json({ error: "Failed to list threads" });
		}
	});

	router.post("/api/chat/threads", requireAuth, async (req, res) => {
		try {
			const thread = await service.createThread(getUserId(req));
			res.json(thread);
		} catch (err) {
			console.error("chat createThread error:", err);
			res.status(500).json({ error: "Failed to create thread" });
		}
	});

	router.get("/api/chat/threads/:id", requireAuth, async (req, res) => {
		const threadId = Number(req.params.id);
		if (!Number.isInteger(threadId)) {
			return res.status(400).json({ error: "thread id must be an integer" });
		}

		try {
			const thread = await service.getThread(getUserId(req), threadId);
			if (!thread) {
				return res.status(404).json({ error: "Not found" });
			}

			const messages = await service.getMessages(threadId);
			const attachmentsByMessage = await service.getAttachmentsForMessages(
				messages.map((m) => m.id),
			);

			res.json({
				...thread,
				messages: messages.map((m) => ({
					...m,
					attachments: attachmentsByMessage.get(m.id) ?? [],
				})),
			});
		} catch (err) {
			console.error("chat getThread error:", err);
			res.status(500).json({ error: "Failed to load thread" });
		}
	});

	router.patch("/api/chat/threads/:id", requireAuth, async (req, res) => {
		const threadId = Number(req.params.id);
		if (!Number.isInteger(threadId)) {
			return res.status(400).json({ error: "thread id must be an integer" });
		}

		const { title } = req.body ?? {};
		if (typeof title !== "string" || !title.trim()) {
			return res.status(400).json({ error: "title is required" });
		}

		try {
			const updated = await service.renameThread(
				getUserId(req),
				threadId,
				title.trim(),
			);
			if (!updated) {
				return res.status(404).json({ error: "Not found" });
			}
			res.json(updated);
		} catch (err) {
			console.error("chat renameThread error:", err);
			res.status(500).json({ error: "Failed to rename thread" });
		}
	});

	router.delete("/api/chat/threads/:id", requireAuth, async (req, res) => {
		const threadId = Number(req.params.id);
		if (!Number.isInteger(threadId)) {
			return res.status(400).json({ error: "thread id must be an integer" });
		}

		try {
			const deleted = await service.deleteThread(getUserId(req), threadId);
			if (!deleted) {
				return res.status(404).json({ error: "Not found" });
			}
			res.status(204).send();
		} catch (err) {
			console.error("chat deleteThread error:", err);
			res.status(500).json({ error: "Failed to delete thread" });
		}
	});

	router.get("/api/chat/attachments/:id", requireAuth, async (req, res) => {
		const attachmentId = Number(req.params.id);
		if (!Number.isInteger(attachmentId)) {
			return res.status(400).json({ error: "attachment id must be an integer" });
		}

		try {
			const attachment = await service.getAttachment(
				getUserId(req),
				attachmentId,
			);
			if (!attachment) {
				return res.status(404).json({ error: "Not found" });
			}

			res.setHeader(
				"Content-Disposition",
				`attachment; filename="${attachment.filename}"`,
			);
			res.setHeader("Content-Type", attachmentContentType(attachment.format));
			res.send(attachment.content);
		} catch (err) {
			console.error("chat getAttachment error:", err);
			res.status(500).json({ error: "Failed to download attachment" });
		}
	});

	router.post(
		"/api/chat/threads/:id/messages",
		requireAuth,
		async (req, res) => {
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
						userMessageText ??
						history.find((m) => m.role === "user")?.content;
					if (firstUserMessage && thread.title === "Untitled") {
						await service.autoTitleThread(userId, threadId, firstUserMessage);
					}

					writeStreamEvent(res, { type: "done", messageId: updated.id });
					res.end();
				} catch (err) {
					console.error("chat message stream error:", err);
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
				console.error("chat postMessage error:", err);
				if (!res.headersSent) {
					res.status(500).json({ error: "Failed to send message" });
				}
			}
		},
	);

	return router;
}
