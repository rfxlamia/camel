import type { AgentEvent } from "../types";

const BOARD_REFETCH_TERMINAL_TYPES = new Set<AgentEvent["type"]>([
	"agent.card.failed",
	"agent.execution.done",
	"agent.artifact.ready",
]);

/** Whether a terminal agent event should trigger a one-time board re-fetch. */
export function shouldRefetchBoardOnTerminalEvent(
	agentEvents: AgentEvent[],
	lastSyncedEventIndex: number,
): { shouldFetch: boolean; eventIndex: number } {
	if (agentEvents.length === 0) {
		return { shouldFetch: false, eventIndex: lastSyncedEventIndex };
	}

	const eventIndex = agentEvents.length - 1;
	if (eventIndex === lastSyncedEventIndex) {
		return { shouldFetch: false, eventIndex: lastSyncedEventIndex };
	}

	const last = agentEvents[eventIndex];
	if (!BOARD_REFETCH_TERMINAL_TYPES.has(last.type)) {
		return { shouldFetch: false, eventIndex: lastSyncedEventIndex };
	}

	return { shouldFetch: true, eventIndex };
}
