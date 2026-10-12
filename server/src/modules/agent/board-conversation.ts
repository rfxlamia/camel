import { logger } from "../../lib/logger.js";
import { routeBoardMessage } from "./board-message-routing.js";
import type { AgentBoardServiceDeps } from "./service-types.js";
import { assertAgentSpendAllowed } from "./spend-kill-switch.js";

export function createBoardConversation(
	deps: AgentBoardServiceDeps,
	runPipeline: (args: {
		boardId: number;
		workspaceId: number;
	}) => Promise<void>,
	handleLaunchFailure: (args: {
		boardId: number;
		workspaceId: number;
	}) => Promise<void>,
) {
	const pendingRegenerate = new Map<number, string>();

	return {
		// ---- sendMessage (Generate-Explain-Refine loop) ----
		async sendMessage({
			boardId,
			userId,
			workspaceId,
			message,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
			message: string;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board) return { status: 404 as const };
			if (board.workspaceId !== workspaceId) return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			return routeBoardMessage(
				deps,
				pendingRegenerate,
				board,
				boardId,
				workspaceId,
				message,
			);
		},

		// ---- confirmRegenerateBoard ----
		async confirmRegenerateBoard({
			boardId,
			userId,
			workspaceId,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			// Atomic claim: delete() returns true only for the first caller
			// CRITICAL: get() and delete() must remain synchronous and adjacent — do not insert await between them
			const newIntent = pendingRegenerate.get(boardId);
			if (!newIntent) {
				return { ok: true as const };
			}
			assertAgentSpendAllowed();
			if (!pendingRegenerate.delete(boardId)) {
				return { ok: true as const };
			}

			await deps.insertConversation!({
				boardId,
				role: "assistant",
				content: `Regenerating board with new direction: ${newIntent}`,
			});

			await deps.updateBoard!(boardId, {
				original_intent: newIntent,
				execution_status: "running",
			});
			await deps.deleteOutputsForBoard!(boardId);
			await deps.deleteCardsForBoard!(boardId);

			await deps.publishEvent?.(workspaceId, {
				type: "agent.board.generating",
			});

			void runPipeline({ boardId, workspaceId })
				.catch(async (err: unknown) => {
					logger.error({ err }, "confirmRegenerateBoard: runPipeline failed");
					await handleLaunchFailure({ boardId, workspaceId });
				})
				.catch((err: unknown) => {
					logger.error(
						{ err, boardId, workspaceId },
						"confirmRegenerateBoard: failure recovery failed",
					);
				});

			return { ok: true as const };
		},

		// ---- cancelRegenerateBoard ----
		async cancelRegenerateBoard({
			boardId,
			userId,
			workspaceId,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			pendingRegenerate.delete(boardId);

			await deps.insertConversation!({
				boardId,
				role: "assistant",
				content: "Regeneration cancelled.",
			});

			return { ok: true as const };
		},
	};
}
