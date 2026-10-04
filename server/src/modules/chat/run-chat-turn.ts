/**
 * Shared LLM chat turn runner — multi-turn messages, tools, extended thinking.
 *
 * Extracted from agent/llm.ts so the AI Chat page and agent pipeline share
 * the same tool loop, streaming, and sanitization logic.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import type { Tool, ToolEvent } from "../agent/index.js";
import {
	createSafeSystemPrompt,
	sanitizeLLMOutput,
	sanitizeUserInput,
} from "../agent/index.js";
import { getClient, runSingleShot, runWithTools } from "./run-turn-loops.js";

export {
	MAX_TOKENS,
	OUTPUT_BUDGET,
	THINKING_BUDGET,
} from "./run-turn-loops.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunChatTurnOptions {
	systemPrompt: string;
	messages: Anthropic.MessageParam[];
	tools?: Tool[];
	toolBudget?: number;
	/**
	 * Request extended thinking for this turn. Defaults to true; `false` skips
	 * it. The ANTHROPIC_THINKING_ENABLED env switch can only turn it off.
	 */
	thinking?: boolean;
	onToken: (token: string) => void;
	onThinking?: (text: string) => void;
	onToolEvent?: (e: ToolEvent) => void;
}

export interface RunChatTurnResult {
	output: string;
	thinking?: string;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/** Rough token estimate for overflow checks (chars / 4 heuristic). */
export function estimateContextTokens(
	messages: Anthropic.MessageParam[],
): number {
	let chars = 0;
	for (const msg of messages) {
		chars += countMessageChars(msg.content);
	}
	return Math.ceil(chars / 4);
}

function countMessageChars(content: Anthropic.MessageParam["content"]): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let total = 0;
	for (const block of content) {
		if (block.type === "text") total += block.text.length;
		if (block.type === "tool_result" && typeof block.content === "string") {
			total += block.content.length;
		}
	}
	return total;
}

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

function sanitizeMessages(
	messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
	return messages.map((msg) => {
		if (msg.role !== "user") return msg;
		if (typeof msg.content === "string") {
			return { ...msg, content: sanitizeUserInput(msg.content) };
		}
		if (!Array.isArray(msg.content)) return msg;
		return {
			...msg,
			content: msg.content.map((block) => {
				if (block.type === "text") {
					return { ...block, text: sanitizeUserInput(block.text) };
				}
				return block;
			}),
		};
	});
}

// ---------------------------------------------------------------------------
// runChatTurn
// ---------------------------------------------------------------------------

export async function runChatTurn(
	options: RunChatTurnOptions,
): Promise<RunChatTurnResult> {
	const {
		systemPrompt,
		messages,
		tools = [],
		toolBudget = 3,
		thinking: wantThinking = true,
		onToken,
		onThinking,
		onToolEvent,
	} = options;

	const useThinking =
		wantThinking && config.ANTHROPIC_THINKING_ENABLED === "true";
	const client = getClient();
	const safeSystem = createSafeSystemPrompt(systemPrompt);
	const sanitizedMessages = sanitizeMessages(messages);

	let result: RunChatTurnResult;

	if (tools.length === 0) {
		result = await runSingleShot(
			client,
			safeSystem,
			sanitizedMessages,
			useThinking,
			onToken,
			onThinking,
		);
	} else {
		result = await runWithTools(
			client,
			safeSystem,
			sanitizedMessages,
			tools,
			toolBudget,
			useThinking,
			onToken,
			onToolEvent,
			onThinking,
		);
	}

	return {
		...result,
		output: sanitizeLLMOutput(result.output),
	};
}
