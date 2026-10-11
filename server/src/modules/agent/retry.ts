import type { AgentBoardServiceDeps } from "./service-types.js";

export function createBoardRetry(deps: AgentBoardServiceDeps) {
	return {
		async retryBoard(data: {
			boardId: number;
			workspaceId: number;
			userId: number;
		}) {
			// Access, replay and spend decisions are made inside the source row lock.
			return deps.retryBoardAtomic!(data);
		},
		async handleRetryLaunchFailure({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			// A guard can reject before the pipeline's own error handler. Never
			// overwrite done (e.g. if publishing its completion event rejected).
			if (await deps.failRunningBoard!(boardId, workspaceId)) {
				await deps.publishEvent?.(workspaceId, {
					type: "agent.board.failed",
					boardId,
				});
			}
		},
	};
}
