import type { AgentEvent } from "../types";

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
	if (last.type !== "agent.card.done" && last.type !== "agent.card.failed") {
		return { shouldFetch: false, eventIndex: lastSyncedEventIndex };
	}

	return { shouldFetch: true, eventIndex };
}
