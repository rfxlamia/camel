/**
 * LLM layer for Agentic Kanban — thin wrappers around the Anthropic SDK.
 *
 * All functions are pure async with no DB dependencies, making them
 * fully unit-testable via mocked Anthropic client.
 *
 * Architecture:
 *   - API key: `config.ANTHROPIC_API_KEY` (validated at startup)
 *   - Base URL: `config.ANTHROPIC_BASE_URL` (optional, for MiMo etc.)
 *   - Model: `config.ANTHROPIC_MODEL` (optional override)
 *   - NATIVE flag: true when using real Anthropic API (enables thinking/cache_control)
 *                  false when using compatible endpoint like MiMo
 */

export {
	getClient,
	MAX_TOKENS,
	OUTPUT_BUDGET,
	THINKING_BUDGET,
} from "../../lib/llm/client.js";
export { type ClassifyResult, classifyIntent } from "./classify-intent.js";
export { type ExecuteResult, executeCard } from "./execute-card.js";
export {
	type ConversationMessage,
	classifyFollowUpIntent,
	type FollowUpIntent,
	type FollowUpResult,
} from "./follow-up-intent.js";
export {
	detectReportPeriod,
	generateClarificationQuestion,
	type ReportPeriodResult,
} from "./report-period.js";
