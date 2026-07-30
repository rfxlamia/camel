/**
 * Shared LLM chat turn runner — multi-turn messages, tools, extended thinking.
 *
 * Extracted from agent/llm.ts so the AI Chat page and agent pipeline share
 * the same tool loop, streaming, and sanitization logic.
 */

import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { config } from "../config.js";
import {
	createSafeSystemPrompt,
	sanitizeLLMOutput,
	sanitizeUserInput,
} from "../agent/prompt-sanitizer.js";
import { toAnthropicToolDefs } from "../agent/tools/registry.js";
import { countSearchResults } from "../agent/tools/trace.js";
import type { Tool, ToolEvent } from "../agent/tools/types.js";

// ---------------------------------------------------------------------------
// Client + token budgets (mirrors agent/llm.ts — kept in sync)
// ---------------------------------------------------------------------------

const NATIVE = config.ANTHROPIC_BASE_URL ? false : true;
const MODEL = config.ANTHROPIC_MODEL;

export const OUTPUT_BUDGET = 16384;
export const THINKING_BUDGET = 8192;
export const MAX_TOKENS = OUTPUT_BUDGET + THINKING_BUDGET;

let _client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!_client) {
		const opts: ClientOptions = { apiKey: config.ANTHROPIC_API_KEY };
		if (config.ANTHROPIC_BASE_URL) {
			opts.baseURL = config.ANTHROPIC_BASE_URL;
		}
		if (!NATIVE) {
			opts.defaultHeaders = { "api-key": config.ANTHROPIC_API_KEY };
		}
		_client = new Anthropic(opts);
	}
	return _client;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunChatTurnOptions {
	systemPrompt: string;
	messages: Anthropic.MessageParam[];
	tools?: Tool[];
	toolBudget?: number;
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

function countMessageChars(
	content: Anthropic.MessageParam["content"],
): number {
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
// Tool helpers (shared with agent path)
// ---------------------------------------------------------------------------

function toolCallQuery(input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const obj = input as Record<string, unknown>;
	if (typeof obj.query === "string") return obj.query;
	if (typeof obj.filename === "string") return obj.filename;
	if (typeof obj.content === "string") {
		const trimmed = obj.content.trim();
		if (!trimmed) return undefined;
		const preview = trimmed.slice(0, 60);
		return preview.length < trimmed.length ? `${preview}…` : preview;
	}
	return undefined;
}

function toolResultCount(
	toolName: string,
	content: string,
): number | undefined {
	if (toolName === "create_file") return undefined;
	return countSearchResults(content);
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
		onToken,
		onThinking,
		onToolEvent,
	} = options;

	const client = getClient();
	const safeSystem = createSafeSystemPrompt(systemPrompt);
	const sanitizedMessages = sanitizeMessages(messages);

	let result: RunChatTurnResult;

	if (tools.length === 0) {
		result = await runSingleShot(
			client,
			safeSystem,
			sanitizedMessages,
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

async function runSingleShot(
	client: Anthropic,
	system: string,
	messages: Anthropic.MessageParam[],
	onToken: (token: string) => void,
	onThinking?: (text: string) => void,
): Promise<RunChatTurnResult> {
	const stream = client.messages.stream({
		model: MODEL,
		max_tokens: MAX_TOKENS,
		thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
		system,
		messages,
	});

	let output = "";
	let thinking = "";

	for await (const event of stream) {
		if (
			event.type === "content_block_delta" &&
			event.delta.type === "text_delta"
		) {
			const text = event.delta.text;
			output += text;
			onToken(text);
		}
		if (
			event.type === "content_block_delta" &&
			event.delta.type === "thinking_delta"
		) {
			onThinking?.(event.delta.thinking);
		}
	}

	const finalMessage = await stream.finalMessage();

	for (const block of finalMessage.content) {
		if (block.type === "thinking") {
			thinking = block.thinking;
		}
	}

	return { output, thinking: thinking || undefined };
}

async function runWithTools(
	client: Anthropic,
	system: string,
	messages: Anthropic.MessageParam[],
	tools: Tool[],
	toolBudget: number,
	onToken: (token: string) => void,
	onToolEvent?: (e: ToolEvent) => void,
	onThinking?: (text: string) => void,
): Promise<RunChatTurnResult> {
	const toolsByName = new Map(tools.map((t) => [t.name, t]));
	const conversationMessages: Anthropic.MessageParam[] = [...messages];
	let remainingBudget = toolBudget;
	let thinking: string | undefined;
	let lastTurnText = "";
	const maxIterations = toolBudget * 5 + 10;

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const stream = client.messages.stream({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
			system,
			messages: conversationMessages,
			tools: toAnthropicToolDefs(tools),
		});

		let turnText = "";
		lastTurnText = "";

		for await (const event of stream) {
			if (
				event.type === "content_block_delta" &&
				event.delta.type === "text_delta"
			) {
				turnText += event.delta.text;
				onToken(event.delta.text);
			}
			if (
				event.type === "content_block_delta" &&
				event.delta.type === "thinking_delta"
			) {
				onThinking?.(event.delta.thinking);
			}
		}

		const finalMessage = await stream.finalMessage();
		lastTurnText = turnText;

		for (const block of finalMessage.content) {
			if (block.type === "thinking") {
				thinking = block.thinking;
			}
		}

		if (finalMessage.stop_reason === "tool_use") {
			if (turnText && onToolEvent) {
				onToolEvent({ phase: "reasoning", text: turnText });
			}

			conversationMessages.push({
				role: "assistant",
				content: finalMessage.content,
			});

			const toolResults: Anthropic.ToolResultBlockParam[] = [];

			for (const block of finalMessage.content) {
				if (block.type !== "tool_use") continue;

				const query =
					typeof block.input === "object" && block.input !== null
						? toolCallQuery(block.input)
						: undefined;

				if (remainingBudget > 0) {
					remainingBudget--;
					const tool = toolsByName.get(block.name);

					onToolEvent?.({
						phase: "started",
						toolName: block.name,
						query,
					});

					if (!tool) {
						const content = `Unknown tool: ${block.name}`;
						onToolEvent?.({
							phase: "failed",
							toolName: block.name,
							query,
							errorCode: "UNKNOWN_TOOL",
						});
						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content,
							is_error: true,
						});
						continue;
					}

					const result = await tool.execute(
						block.input as Record<string, unknown>,
					);

					if (result.ok) {
						const resultCount = toolResultCount(block.name, result.content);
						onToolEvent?.({
							phase: "result",
							toolName: block.name,
							query,
							resultCount,
						});
						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content: result.content,
						});
					} else {
						onToolEvent?.({
							phase: "failed",
							toolName: block.name,
							query,
							errorCode: result.errorCode,
						});
						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content: result.content,
							is_error: true,
						});
					}
				} else {
					onToolEvent?.({
						phase: "failed",
						toolName: block.name,
						query,
						errorCode: "BUDGET_EXCEEDED",
					});
					toolResults.push({
						type: "tool_result",
						tool_use_id: block.id,
						content: "search limit reached",
						is_error: true,
					});
				}
			}

			conversationMessages.push({ role: "user", content: toolResults });
			continue;
		}

		return { output: turnText, thinking };
	}

	return {
		output:
			lastTurnText ||
			"The agent could not complete this step within the tool loop limit.",
		thinking,
	};
}
