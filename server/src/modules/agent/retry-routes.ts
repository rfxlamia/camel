import type { Router } from "express";
import { requireAuth } from "../../auth.js";
import { logger } from "../../lib/logger.js";
import { assertWorkspaceMember } from "./membership.js";
import { parseAgentBoardParams } from "./route-validation.js";
import type { createAgentBoardService } from "./service.js";
import { AgentSpendKillSwitchError } from "./spend-kill-switch.js";

export function registerRetryRoute(
	router: Router,
	service: ReturnType<typeof createAgentBoardService>,
) {
	router.post(
		"/workspaces/:workspaceId/agent/boards/:boardId/retry",
		requireAuth,
		async (req, res) => {
			const params = parseAgentBoardParams(
				req.params.workspaceId,
				req.params.boardId,
				res,
			);
			if (!params) return;
			const { workspaceId } = params;
			if (!(await assertWorkspaceMember(req, res, workspaceId))) return;
			let result: Awaited<ReturnType<typeof service.retryBoard>>;
			try {
				result = await service.retryBoard({ ...params, userId: req.user!.id });
			} catch (error) {
				if (error instanceof AgentSpendKillSwitchError) {
					res.status(503).json({ error: error.message, code: error.code });
					return;
				}
				throw error;
			}
			if ("status" in result) return res.status(result.status).json(result);
			const { boardId, created } = result;
			if (created) {
				// retryBoard resolves only after COMMIT. Replays never start execution.
				// Promise wrapping also catches synchronous/pre-handler failures.
				void Promise.resolve()
					.then(() => service.runPipeline({ boardId, workspaceId }))
					.catch(async (err) => {
						logger.error(
							{ err, boardId, workspaceId, requestId: req.id },
							"agent retry launch failed",
						);
						await service.handleRetryLaunchFailure({ boardId, workspaceId });
					})
					.catch((err) => {
						// If the DB is unavailable, startup recovery is the safety net.
						logger.error(
							{ err, boardId, workspaceId },
							"agent retry failure recovery failed",
						);
					});
			}
			res.json({ boardId });
		},
	);
}
