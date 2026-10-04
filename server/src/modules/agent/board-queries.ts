import type { AgentBoardServiceDeps } from "./service-types.js";

export function createBoardQueries(deps: AgentBoardServiceDeps) {
	return {
		// ---- getCardOutput ----
		async getCardOutput({
			boardId,
			columnSlug,
			workspaceId,
		}: {
			boardId: number;
			columnSlug: string;
			workspaceId: number;
		}) {
			// Enforce workspace ownership before exposing any output —
			// matches getBoardById/approveBoard guards.
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };

			const output = await deps.getOutput!({ boardId, columnSlug });
			if (!output) return { status: 404 as const };
			return { output: output.output, thinking: output.thinking };
		},

		// ---- getArtifact ----
		async getArtifact({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };

			const artifact = await deps.getArtifact!(boardId);
			if (!artifact) return { status: 404 as const };
			return artifact;
		},

		// ---- getBoards (workspace-scoped, sorted newest first) ----
		async getBoards({ workspaceId }: { workspaceId: number }) {
			return deps.listBoards!(workspaceId);
		},

		// ---- getBoardById (history replay — no re-trigger) ----
		async getBoardById({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };
			return board;
		},
	};
}
