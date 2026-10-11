import type { AgentBoard } from "../../types";

/** Optional for older API payloads; fresh retries include their preserved source. */
export interface AgentBoardAttempt extends AgentBoard {
	retryOfBoardId?: number | null;
}
