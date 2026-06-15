import type { AgentEvent, ToolTraceItem } from "../types";

/** Map live SSE agent.tool.* events into merged logical trace steps. */
export function deriveToolTrace(agentEvents: AgentEvent[]): ToolTraceItem[] {
	const items: ToolTraceItem[] = [];
	let pending: ToolTraceItem | null = null;

	for (const e of agentEvents) {
		if (
			e.type !== "agent.tool.started" &&
			e.type !== "agent.tool.result" &&
			e.type !== "agent.tool.failed"
		) {
			continue;
		}

		const base: ToolTraceItem = {
			columnSlug: e.columnSlug ?? "",
			toolName: e.toolName ?? "",
			query: e.query,
			attempt: e.attempt,
		};

		if (e.type === "agent.tool.started") {
			if (pending) items.push(pending);
			pending = base;
			continue;
		}

		if (
			pending &&
			pending.toolName === base.toolName &&
			pending.columnSlug === base.columnSlug
		) {
			items.push({
				...pending,
				query: pending.query ?? base.query,
				resultCount:
					e.type === "agent.tool.result" ? e.resultCount : pending.resultCount,
				errorCode:
					e.type === "agent.tool.failed" ? e.errorCode : pending.errorCode,
				attempt: e.attempt ?? pending.attempt,
			});
			pending = null;
			continue;
		}

		if (pending) {
			items.push(pending);
			pending = null;
		}

		items.push({
			...base,
			resultCount: e.type === "agent.tool.result" ? e.resultCount : undefined,
			errorCode: e.type === "agent.tool.failed" ? e.errorCode : undefined,
		});
	}

	if (pending) items.push(pending);
	return items;
}

export function filterToolTraceByColumn(
	steps: ToolTraceItem[],
	columnSlug: string,
): ToolTraceItem[] {
	return steps.filter((s) => s.columnSlug === columnSlug);
}

/** Prefer the trace source with more steps; ties go to live (in-flight execution). */
export function pickToolTraceForColumn(
	stored: ToolTraceItem[],
	live: ToolTraceItem[],
	columnSlug: string,
): ToolTraceItem[] {
	const storedScoped = filterToolTraceByColumn(stored, columnSlug);
	const liveScoped = filterToolTraceByColumn(live, columnSlug);
	if (liveScoped.length === 0) return storedScoped;
	if (storedScoped.length === 0) return liveScoped;
	return liveScoped.length >= storedScoped.length ? liveScoped : storedScoped;
}
