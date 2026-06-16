import type { AgentEvent } from "../types";

/** Derive concatenated live thinking text for a given boardId + columnSlug.
 * Filters only `agent.card.thinking` events; concatenates their `token` in order.
 * Drops any event missing boardId or columnSlug (prevents EC3 cross-board bleed when slugs reuse).
 */
export function deriveThinkingForColumn(
	agentEvents: AgentEvent[],
	boardId: number,
	columnSlug: string,
): string {
	return agentEvents
		.filter(
			(e) =>
				e.type === "agent.card.thinking" &&
				e.boardId === boardId &&
				e.columnSlug === columnSlug,
		)
		.map((e) => e.token ?? "")
		.join("");
}

/** Derive concatenated live streamed output text for a given boardId + columnSlug.
 * Filters only `agent.card.token` events; concatenates their `token` in order.
 * Same scoping rules as deriveThinkingForColumn.
 */
export function deriveStreamedOutputForColumn(
	agentEvents: AgentEvent[],
	boardId: number,
	columnSlug: string,
): string {
	return agentEvents
		.filter(
			(e) =>
				e.type === "agent.card.token" &&
				e.boardId === boardId &&
				e.columnSlug === columnSlug,
		)
		.map((e) => e.token ?? "")
		.join("");
}

/** Select content source: live if non-empty, else fall back to DB.
 * Mirrors the "live if present, else DB" selection rule in pickToolTraceForColumn (see EC1).
 * Used by UI to decide render from agentEvents vs fetched agent_card_outputs.
 */
export function pickContent(live: string, db: string): string {
	return live && live.length > 0 ? live : db;
}

/** Whether to clear accumulated agentEvents when the active workspace changes.
 * True only when switching from one workspace to a different one (not initial set).
 */
export function shouldClearOnWorkspaceChange(
	prevId: number | null,
	nextId: number | null,
): boolean {
	if (prevId === null) return false;
	if (nextId === null) return false;
	return prevId !== nextId;
}
