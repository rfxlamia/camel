import type { ChatToolEvent } from "../types";
import type { ToolTraceItem } from "../types";

/** Map live chat stream tool_event payloads into ToolTraceItem steps. */
export function deriveChatToolTrace(events: ChatToolEvent[]): ToolTraceItem[] {
	const items: ToolTraceItem[] = [];
	let pending: ToolTraceItem | null = null;

	for (const event of events) {
		if (event.phase === "started") {
			if (pending) items.push(pending);
			pending = {
				toolName: event.toolName ?? "",
				query: event.query,
			};
			continue;
		}

		if (event.phase === "result") {
			if (pending) {
				items.push({
					...pending,
					resultCount: event.resultCount,
				});
				pending = null;
			} else {
				items.push({
					toolName: event.toolName ?? "",
					query: event.query,
					resultCount: event.resultCount,
				});
			}
			continue;
		}

		if (event.phase === "failed") {
			if (pending) {
				items.push({
					...pending,
					errorCode: event.errorCode,
				});
				pending = null;
			} else {
				items.push({
					toolName: event.toolName ?? "",
					query: event.query,
					errorCode: event.errorCode,
				});
			}
		}
	}

	if (pending) items.push(pending);
	return items;
}
