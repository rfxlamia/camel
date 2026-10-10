import type { Request, Response } from "express";
import { checkChatLimit } from "../../lib/chat-rate-limit.js";
import { lookupMembership } from "../../lib/helpers.js";
import { estimateContextTokens } from "../../lib/llm/run-chat-turn.js";
import type { resolveChatMessageAction } from "./chat-helpers.js";
import {
	buildAnthropicMessages,
	getUserId,
	MAX_CONTEXT_TOKENS,
} from "./chat-helpers.js";
import type { createChatService } from "./service.js";
import type { ChatMessage } from "./types.js";

type Service = ReturnType<typeof createChatService>;
type Action = Exclude<
	ReturnType<typeof resolveChatMessageAction>,
	{ kind: "invalid" }
>;
export class ThreadNotFoundError extends Error {
	constructor() {
		super("Thread not found");
	}
}

export async function checkMessageAccess(
	service: Service,
	req: Request,
	res: Response,
	threadId: number,
	action: Action,
) {
	const userId = getUserId(req);
	const thread = await service.getThread(userId, threadId);
	if (!thread) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	const workspaceId = action.kind === "send" ? action.workspaceId : undefined;
	if (workspaceId !== undefined) {
		const membership = await lookupMembership(userId, workspaceId);
		if (!membership) {
			res.status(404).json({ error: "Not found" });
			return;
		}
	}

	const rateLimit = await checkChatLimit(userId);
	if (rateLimit.isLocked) {
		res.status(429).json({
			error: "Too many chat messages",
			...(rateLimit.retryAfterMs !== undefined
				? { retryAfterMs: rateLimit.retryAfterMs }
				: {}),
		});
		return;
	}
	return { userId, thread, workspaceId };
}
export async function prepareMessageHistory(
	service: Service,
	res: Response,
	userId: number,
	threadId: number,
	action: Action,
) {
	let history = await service.getMessages(threadId);
	let userMessageText: string | undefined;
	let retryTargetId: number | undefined;

	if (action.kind === "send") {
		const tokens = estimateSendTokens(history, threadId, action.message);
		if (tokens > MAX_CONTEXT_TOKENS) {
			res.status(413).json({
				message: "Thread too long, start a new chat",
			});
			return;
		}

		userMessageText = action.message;
	} else {
		const target = await service.getMessage(userId, action.messageId);
		if (!target || target.threadId !== threadId) {
			res.status(404).json({ error: "Not found" });
			return;
		}
		retryTargetId = target.id;
		history = history.filter((m) => m.id < target.id);
		const tokens = estimateContextTokens(buildAnthropicMessages(history));
		if (tokens > MAX_CONTEXT_TOKENS) {
			res.status(413).json({
				message: "Thread too long, start a new chat",
			});
			return;
		}
	}
	return { history, userMessageText, retryTargetId };
}
function estimateSendTokens(
	history: ChatMessage[],
	threadId: number,
	message: string,
) {
	const candidateMessages = [
		...history,
		{
			id: 0,
			threadId,
			role: "user" as const,
			content: message,
			thinking: null,
			toolTrace: null,
			createdAt: new Date(),
		},
	];
	const tokens = estimateContextTokens(
		buildAnthropicMessages(candidateMessages),
	);
	return tokens;
}
export async function persistMessageStart(
	service: Service,
	userId: number,
	threadId: number,
	action: Action,
	history: ChatMessage[],
	retryTargetId: number | undefined,
) {
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
	return { history, assistantRowId: placeholder.id };
}
