import type { AgentBoardServiceDeps } from "./service-types.js";

export type ToolEventPayload = {
	phase: string;
	toolName?: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
	attempt?: number;
	text?: string;
};

export function persistToolEvent(
	deps: AgentBoardServiceDeps,
	data: {
		boardId: number;
		columnSlug: string;
		event: ToolEventPayload;
		attempt: number;
	},
): void {
	const { boardId, columnSlug, event, attempt } = data;

	if (event.phase === "reasoning") {
		deps.insertToolCall?.({
			boardId,
			columnSlug,
			toolName: "_reasoning",
			input: null,
			result: event.text ?? "",
			attempt: 1,
		});
		return;
	}

	const base = {
		boardId,
		columnSlug,
		toolName: event.toolName ?? "",
		attempt: event.attempt ?? attempt,
	};

	if (event.phase === "started") {
		deps.insertToolCall?.({
			...base,
			input: { query: event.query },
			result: "started",
		});
	} else if (event.phase === "result") {
		deps.insertToolCall?.({
			...base,
			input: { query: event.query, resultCount: event.resultCount },
			result: String(event.resultCount ?? 0),
		});
	} else if (event.phase === "failed") {
		deps.insertToolCall?.({
			...base,
			input: { query: event.query },
			result: null,
			errorCode: event.errorCode,
		});
	}
}

export function publishToolSse(
	deps: AgentBoardServiceDeps,
	workspaceId: number,
	boardId: number,
	columnSlug: string,
	e: ToolEventPayload,
): void {
	if (e.phase === "started") {
		deps.publishEvent?.(workspaceId, {
			type: "agent.tool.started",
			columnSlug,
			boardId,
			toolName: e.toolName,
			query: e.query,
			attempt: e.attempt,
		});
	} else if (e.phase === "result") {
		deps.publishEvent?.(workspaceId, {
			type: "agent.tool.result",
			columnSlug,
			boardId,
			toolName: e.toolName,
			query: e.query,
			resultCount: e.resultCount,
			attempt: e.attempt,
		});
	} else if (e.phase === "failed") {
		deps.publishEvent?.(workspaceId, {
			type: "agent.tool.failed",
			columnSlug,
			boardId,
			toolName: e.toolName,
			query: e.query,
			errorCode: e.errorCode,
			attempt: e.attempt,
		});
	}
}
