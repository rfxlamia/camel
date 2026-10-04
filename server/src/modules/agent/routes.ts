/**
 * Agent Board Routes — workspace-scoped endpoints for agentic kanban.
 *
 * Mounts under /api so full paths are:
 *   POST   /api/workspaces/:wid/agent/boards
 *   POST   /api/workspaces/:wid/agent/boards/:bid/message
 *   POST   /api/workspaces/:wid/agent/boards/:bid/approve
 *   GET    /api/workspaces/:wid/agent/boards
 *   GET    /api/workspaces/:wid/agent/boards/:id
 *   GET    /api/workspaces/:wid/agent/boards/:bid/outputs/:slug
 *   GET    /api/workspaces/:wid/agent/boards/:bid/artifact
 *   GET    /api/workspaces/:wid/agent/boards/:bid/artifact/download
 *
 * requireAuth is per-route (NOT router-level) to avoid double-mounting
 * when both this and the existing api router are on /api.
 *
 * CRITICAL: Agent card execution output writes to agent_card_outputs,
 * NOT card_events — human Activity Feed must stay clean.
 */

import { Router } from "express";
import { requireAuth } from "../../auth.js";
import { logger } from "../../lib/logger.js";
import { llmTimeout } from "../../middleware/timeout.js";
import { requireWorkspaceMember } from "./membership.js";
import { resolveMessageAction } from "./message-action.js";
import { registerReadRoutes } from "./read-routes.js";
import {
	type AgentBoardServiceDeps,
	createAgentBoardService,
} from "./service.js";
import { realDeps } from "./service-deps.js";

export { buildArtifactDownload, realArtifactDeps } from "./artifact-db.js";
export {
	deleteCardsForBoard,
	deleteOutputsForBoard,
	getToolTrace,
	loadAgentBoardColumns,
	runInsertColumns,
	selectConversationHistory,
	type ToolTraceItem,
	validateBoardColumns,
} from "./board-db.js";
export { type MessageAction, resolveMessageAction } from "./message-action.js";
export { defaultToolRegistry } from "./service-deps.js";

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createAgentRouter(
	overrides?: Partial<AgentBoardServiceDeps>,
): Router {
	const router = Router();
	const service = createAgentBoardService({ ...realDeps, ...overrides });

	// 2-minute socket timeout for agent routes (LLM calls can be slow)
	router.use(llmTimeout(120000));

	// ---- POST /workspaces/:workspaceId/agent/boards ----
	router.post(
		"/workspaces/:workspaceId/agent/boards",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			if (!Number.isInteger(workspaceId)) {
				return res
					.status(400)
					.json({ error: "workspaceId must be an integer" });
			}

			const { intent } = req.body ?? {};
			if (typeof intent !== "string" || !intent.trim()) {
				return res.status(400).json({ error: "intent is required" });
			}

			if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

			const result = await service.createBoard({
				workspaceId,
				userId: req.user!.id,
				intent: intent.trim(),
			});

			if ("status" in result && typeof result.status === "number") {
				return res.status(result.status).json({
					error: "message" in result ? result.message : "Request failed",
				});
			}
			res.status(201).json(result);
		},
	);

	// ---- POST /workspaces/:workspaceId/agent/boards/:boardId/message ----
	router.post(
		"/workspaces/:workspaceId/agent/boards/:boardId/message",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.boardId);
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			const action = resolveMessageAction(req.body);

			if (action.kind === "invalid") {
				return res.status(400).json({ error: "message or action is required" });
			}

			if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

			const result =
				action.kind === "confirm"
					? await service.confirmRegenerateBoard({
							boardId,
							userId: req.user!.id,
							workspaceId,
						})
					: action.kind === "cancel"
						? await service.cancelRegenerateBoard({
								boardId,
								userId: req.user!.id,
								workspaceId,
							})
						: await service.sendMessage({
								boardId,
								userId: req.user!.id,
								workspaceId,
								message: action.message,
							});

			if ("status" in result && typeof result.status === "number") {
				return res.status(result.status).json(result);
			}
			res.json(result);
		},
	);

	// ---- POST /workspaces/:workspaceId/agent/boards/:boardId/approve ----
	router.post(
		"/workspaces/:workspaceId/agent/boards/:boardId/approve",
		requireAuth,
		async (req, res) => {
			const workspaceId = Number(req.params.workspaceId);
			const boardId = Number(req.params.boardId);
			if (!Number.isInteger(workspaceId) || !Number.isInteger(boardId)) {
				return res.status(400).json({ error: "Invalid params" });
			}

			if (!(await requireWorkspaceMember(req, res, workspaceId))) return;

			const result = await service.approveBoard({
				boardId,
				userId: req.user!.id,
				workspaceId,
			});

			if (result && "status" in result && typeof result.status === "number") {
				return res.status(result.status).json(result);
			}

			// Fire-and-forget execution — client receives progress via SSE
			const requestId = req.id;
			service.runPipeline({ boardId, workspaceId }).catch((err) => {
				logger.error(
					{ err, boardId, workspaceId, requestId },
					"agent runPipeline failed",
				);
			});

			res.json({ ok: true });
		},
	);

	registerReadRoutes(router, service);

	return router;
}
