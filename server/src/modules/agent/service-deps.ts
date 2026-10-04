import { publishEvent as realPublishEvent } from "../../realtime.js";
import {
	classifyFollowUpIntent as realClassifyFollowUpIntent,
	classifyIntent as realClassifyIntent,
	detectReportPeriod as realDetectReportPeriod,
	executeCard as realExecuteCard,
	generateClarificationQuestion as realGenerateClarificationQuestion,
} from "./llm.js";
import type { AgentBoardServiceDeps } from "./service.js";
import { activityDeps } from "./service-deps-activity.js";
import { boardDeps } from "./service-deps-board.js";
import { outputDeps } from "./service-deps-output.js";
import { createToolRegistry } from "./tools/registry.js";
import { webSearch } from "./tools/webSearch.js";

export const defaultToolRegistry = createToolRegistry([webSearch]);

export const realDeps: AgentBoardServiceDeps = {
	classifyIntent: realClassifyIntent,
	classifyFollowUpIntent: realClassifyFollowUpIntent,
	executeCard: realExecuteCard,
	generateClarificationQuestion: realGenerateClarificationQuestion,
	detectReportPeriod: realDetectReportPeriod,
	toolRegistry: defaultToolRegistry,
	publishEvent: realPublishEvent as (
		workspaceId: number,
		event: Record<string, unknown>,
	) => Promise<void>,

	...boardDeps,
	...outputDeps,
	...activityDeps,
};
