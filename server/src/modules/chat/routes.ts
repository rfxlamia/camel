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

import express, { Router } from "express";
import { requireAuth } from "../../auth.js";
import { db } from "../../db/kysely.js";
import { attachmentContentType, getUserId } from "./chat-helpers.js";
import { createPostMessageHandler } from "./message-stream.js";
import { createChatService } from "./service.js";

export {
	type ChatMessageAction,
	MAX_CONTEXT_TOKENS,
	resolveChatMessageAction,
} from "./chat-helpers.js";

export function createChatRouter(): Router {
	const router = Router();
	const service = createChatService(db);

	router.use(express.json());

	router.get("/api/chat/threads", requireAuth, async (req, res) => {
		const threads = await service.listThreads(getUserId(req));
		res.json(threads);
	});

	router.post("/api/chat/threads", requireAuth, async (req, res) => {
		const thread = await service.createThread(getUserId(req));
		res.json(thread);
	});

	router.get("/api/chat/threads/:id", requireAuth, async (req, res) => {
		const threadId = Number(req.params.id);
		if (!Number.isInteger(threadId)) {
			return res.status(400).json({ error: "thread id must be an integer" });
		}

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

		const updated = await service.renameThread(
			getUserId(req),
			threadId,
			title.trim(),
		);
		if (!updated) {
			return res.status(404).json({ error: "Not found" });
		}
		res.json(updated);
	});

	router.delete("/api/chat/threads/:id", requireAuth, async (req, res) => {
		const threadId = Number(req.params.id);
		if (!Number.isInteger(threadId)) {
			return res.status(400).json({ error: "thread id must be an integer" });
		}

		const deleted = await service.deleteThread(getUserId(req), threadId);
		if (!deleted) {
			return res.status(404).json({ error: "Not found" });
		}
		res.status(204).send();
	});

	router.get("/api/chat/attachments/:id", requireAuth, async (req, res) => {
		const attachmentId = Number(req.params.id);
		if (!Number.isInteger(attachmentId)) {
			return res
				.status(400)
				.json({ error: "attachment id must be an integer" });
		}

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
	});

	router.post(
		"/api/chat/threads/:id/messages",
		requireAuth,
		createPostMessageHandler(service),
	);

	return router;
}
