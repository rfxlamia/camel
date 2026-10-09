import type { Request, Response } from "express";
import { logger } from "../../lib/logger.js";
import { sendValidationError } from "../../validators/http.js";
import { resolveChatMessageAction } from "./chat-helpers.js";
import {
	finishMessage,
	generateMessage,
	handleStreamError,
} from "./message-generation.js";
import {
	checkMessageAccess,
	persistMessageStart,
	prepareMessageHistory,
} from "./message-runtime.js";
import { validateThreadId } from "./route-validation.js";
import type { createChatService } from "./service.js";
import { setStreamHeaders } from "./stream-protocol.js";

type Service = ReturnType<typeof createChatService>;
export function createPostMessageHandler(service: Service) {
	return async (req: Request, res: Response) => {
		const threadId = validateThreadId(req, res);
		if (threadId === undefined) return;
		const action = resolveChatMessageAction(req.body);
		if (action.kind === "invalid")
			return sendValidationError(res, {
				error: "message or action is required",
			});
		try {
			const access = await checkMessageAccess(
				service,
				req,
				res,
				threadId,
				action,
			);
			if (!access) return;
			const prepared = await prepareMessageHistory(
				service,
				res,
				access.userId,
				threadId,
				action,
			);
			if (!prepared) return;
			setStreamHeaders(res);
			res.status(200);
			await streamMessage(service, res, threadId, action, access, prepared);
		} catch (err) {
			logger.error({ err, threadId }, "chat postMessage failed");
			if (!res.headersSent)
				res.status(500).json({ error: "Failed to send message" });
		}
	};
}
async function streamMessage(
	service: Service,
	res: Response,
	threadId: number,
	action: Exclude<
		ReturnType<typeof resolveChatMessageAction>,
		{ kind: "invalid" }
	>,
	access: NonNullable<Awaited<ReturnType<typeof checkMessageAccess>>>,
	prepared: NonNullable<Awaited<ReturnType<typeof prepareMessageHistory>>>,
) {
	let assistantRowId: number | undefined;
	try {
		const started = await persistMessageStart(
			service,
			access.userId,
			threadId,
			action,
			prepared.history,
			prepared.retryTargetId,
		);
		assistantRowId = started.assistantRowId;
		const generated = await generateMessage(
			service,
			res,
			access.userId,
			threadId,
			assistantRowId,
			access.workspaceId,
			started.history,
		);
		await finishMessage(
			service,
			res,
			access.userId,
			threadId,
			assistantRowId,
			access.thread,
			started.history,
			prepared.userMessageText,
			generated,
		);
	} catch (err) {
		await handleStreamError(service, res, threadId, assistantRowId, err);
	}
}
