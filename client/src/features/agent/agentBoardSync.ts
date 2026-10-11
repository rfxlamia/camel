import type { AgentEvent } from "../../types";

const BOARD_REFETCH_EVENT_TYPES = new Set<AgentEvent["type"]>([
	"agent.board.failed",
	"agent.card.failed",
	"agent.execution.done",
	"agent.artifact.ready",
]);

/** Whether an agent sync event should trigger a one-time board re-fetch. */
export function shouldRefetchBoardOnSyncEvent(
	agentEvents: AgentEvent[],
	lastSyncedEventIndex: number,
	boardId?: number,
): { shouldFetch: boolean; eventIndex: number } {
	if (agentEvents.length === 0) {
		return { shouldFetch: false, eventIndex: lastSyncedEventIndex };
	}

	// Scan the new batch, not just its tail: a token may follow a terminal event.
	for (
		let eventIndex = agentEvents.length - 1;
		eventIndex > lastSyncedEventIndex;
		eventIndex--
	) {
		const event = agentEvents[eventIndex];
		if (
			BOARD_REFETCH_EVENT_TYPES.has(event.type) &&
			(boardId === undefined ||
				event.boardId === undefined ||
				event.boardId === boardId)
		) {
			return { shouldFetch: true, eventIndex };
		}
	}
	return { shouldFetch: false, eventIndex: lastSyncedEventIndex };
}
