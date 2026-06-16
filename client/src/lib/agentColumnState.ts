import type { AgentBoard, AgentEvent } from "../types";

/** Per-column execution state from live SSE events (boardId-scoped). */
export function deriveColumnState(
	agentEvents: AgentEvent[],
	boardId: number,
	slug: string,
	executionStatus: AgentBoard["executionStatus"],
): "active" | "done" | "failed" | "pending" {
	// Filter by boardId + columnSlug (mirror derive*ForColumn + drop missing boardId).
	// Precedence: failed > done > (active only if running) > pending.
	// Never blanket based on board.executionStatus==="done" (EC4).
	const scoped = agentEvents.filter(
		(e) => e.boardId === boardId && e.columnSlug === slug,
	);
	const hasFailed = scoped.some((e) => e.type === "agent.card.failed");
	if (hasFailed) return "failed";
	const hasDone = scoped.some((e) => e.type === "agent.card.done");
	if (hasDone) return "done";
	const hasStarted = scoped.some((e) => e.type === "agent.card.started");
	if (hasStarted && executionStatus === "running") return "active";
	return "pending";
}
