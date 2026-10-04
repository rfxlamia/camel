import { detectPromptInjection } from "../../lib/llm/prompt-sanitizer.js";
import type { Tool, ToolEvent } from "../../lib/llm/tool-types.js";
import { logger } from "../../lib/logger.js";
import { runChatTurn } from "../chat/index.js";
import { renderSystemPrompt } from "./templates.js";

// ---------------------------------------------------------------------------
// executeCard — run a single card's agent with streaming
// ---------------------------------------------------------------------------

export interface ExecuteResult {
	output: string;
	thinking?: string;
}

export async function executeCard(
	systemPrompt: string,
	intent: string,
	previousOutputs: string[],
	// Per-column extended-thinking flag (columns.reasoning); false skips it.
	reasoning: boolean,
	onToken: (token: string) => void,
	tools: Tool[] = [],
	toolBudget = 3,
	onToolEvent?: (e: ToolEvent) => void,
	// onThinking receives live thinking_delta text on both single-shot and
	// tools paths. Optional for backward compat with existing callers.
	onThinking?: (text: string) => void,
	userContent?: string,
): Promise<ExecuteResult> {
	// Security: Check for prompt injection attempts (LOG AND CONTINUE, don't hard-fail)
	//
	// This is intentionally a soft, logging-only layer — NOT a blocking control.
	// The real defense is boundary escaping (sanitizeUserInput wraps untrusted content
	// in XML boundaries with escaped special chars) plus createSafeSystemPrompt.
	// Blocking here would reintroduce the false-positive DoS risk that the heuristic
	// is designed to avoid. See also: prompt-sanitizer.ts for multilingual coverage.
	if (detectPromptInjection(intent)) {
		logger.warn(
			{ intentLength: intent.length },
			"executeCard: prompt injection detected in intent",
		);
	}

	// Substitute {original_intent} before calling LLM
	const rendered = renderSystemPrompt(systemPrompt, {
		original_intent: intent,
	});

	// Build the user message with any previous outputs
	let messageContent = userContent ?? intent;
	if (previousOutputs.length > 0) {
		messageContent +=
			"\n\n<previous_outputs>\n" +
			previousOutputs.join("\n---\n") +
			"\n</previous_outputs>";
	}

	return runChatTurn({
		systemPrompt: rendered,
		messages: [{ role: "user", content: messageContent }],
		tools,
		toolBudget,
		thinking: reasoning,
		onToken,
		onThinking,
		onToolEvent,
	});
}
