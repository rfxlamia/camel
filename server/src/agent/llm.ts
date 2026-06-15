/**
 * LLM layer for Agentic Kanban — thin wrappers around the Anthropic SDK.
 *
 * All functions are pure async with no DB dependencies, making them
 * fully unit-testable via mocked Anthropic client.
 *
 * Architecture:
 *   - API key: `process.env.ANTHROPIC_API_KEY` (never hardcoded)
 *   - Base URL: `process.env.ANTHROPIC_BASE_URL` (optional, for MiMo etc.)
 *   - Model: `process.env.ANTHROPIC_MODEL` (optional override)
 *   - NATIVE flag: true when using real Anthropic API (enables thinking/cache_control)
 *                  false when using compatible endpoint like MiMo
 */

import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { renderSystemPrompt } from "./templates.js";
import { toAnthropicToolDefs } from "./tools/registry.js";
import { countSearchResults } from "./tools/trace.js";
import type { Tool, ToolEvent } from "./tools/types.js";

// ---------------------------------------------------------------------------
// Client singleton — lazy-initialized on first call
// ---------------------------------------------------------------------------

const NATIVE = process.env.ANTHROPIC_BASE_URL ? false : true;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!_client) {
		const opts: ClientOptions = {
			apiKey: process.env.ANTHROPIC_API_KEY,
		};
		// Support custom base URL for MiMo-compatible endpoints
		if (process.env.ANTHROPIC_BASE_URL) {
			opts.baseURL = process.env.ANTHROPIC_BASE_URL;
		}
		// Dual headers for MiMo compatibility: some endpoints expect `api-key`
		// instead of the default `x-api-key` Authorization header.
		if (!NATIVE) {
			opts.defaultHeaders = {
				"api-key": process.env.ANTHROPIC_API_KEY ?? "",
			};
		}
		_client = new Anthropic(opts);
	}
	return _client;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

// Reasoning models (e.g. MiMo) interleave `thinking` blocks with `text`, and
// the text block is not always at index 0. Concatenate every text block so we
// never lose the answer to a thinking block sitting in front of it.
function extractText(response: Anthropic.Message): string {
	return response.content
		.filter(
			(block): block is Anthropic.TextBlock => block.type === "text",
		)
		.map((block) => block.text)
		.join("");
}

// ---------------------------------------------------------------------------
// classifyIntent — match user intent to a board template
// ---------------------------------------------------------------------------

export interface ClassifyResult {
	templateId: string | null;
	explanation: string;
}

// Fix #4: System prompt diperkuat — JSON-only strict, multilingual-aware
const CLASSIFY_SYSTEM_PROMPT = `You are a board-template classifier. Given a user intent (in ANY language), decide which template fits.

Available templates:
- "research-report": Research & Report — for research, analysis, investigation, competitive analysis, market reports, or any fact-finding task. This includes requests in Indonesian (riset, analisis, investigasi), Spanish, French, or any other language.

CRITICAL RULES:
1. Respond with ONLY a raw JSON object. No preamble, no explanation text, no markdown, no code fences.
2. Your entire response must be valid JSON that can be parsed directly.
3. If the intent is research-related in ANY language, use "research-report".

{"templateId": "research-report" | null, "explanation": "<one sentence in English>"}`;

// Internal single-attempt classifier — extracted so retry wrapper can call it cleanly
async function classifyIntentOnce(
	client: Anthropic,
	intent: string,
): Promise<ClassifyResult> {
	// Fix #1: temperature: 0 — classification is deterministic, variance is unwanted
	// Budget: reasoning models spend tokens on a thinking block before the JSON.
	// 256 truncated the answer (stop_reason=max_tokens) → unparseable → 422.
	// max_tokens is a cap, not a target: we only pay for tokens generated.
	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 2048,
		temperature: 0,
		system: CLASSIFY_SYSTEM_PROMPT,
		messages: [{ role: "user", content: intent }],
	});

	const text = extractText(response);

	// Try multiple parsing strategies
	try {
		// Strategy 1: Direct JSON parse
		const parsed = JSON.parse(text) as ClassifyResult;
		return {
			templateId: parsed.templateId ?? null,
			explanation: parsed.explanation ?? "",
		};
	} catch {
		// Strategy 2: Extract JSON from markdown code blocks
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[1].trim()) as ClassifyResult;
				return {
					templateId: parsed.templateId ?? null,
					explanation: parsed.explanation ?? "",
				};
			} catch {
				// Fall through to next strategy
			}
		}

		// Fix #3: Strategy 3 — greedy [\s\S]* agar tidak berhenti di } dalam string
		const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
		if (jsonObjectMatch) {
			try {
				const parsed = JSON.parse(jsonObjectMatch[0]) as ClassifyResult;
				return {
					templateId: parsed.templateId ?? null,
					explanation: parsed.explanation ?? "",
				};
			} catch {
				// Fall through to next strategy
			}
		}

		// Strategy 4: Try to extract templateId and explanation from text
		const templateIdMatch = text.match(/"templateId"\s*:\s*(?:"([^"]+)"|null)/);
		const explanationMatch = text.match(/"explanation"\s*:\s*"([^"]+)"/);
		if (templateIdMatch || explanationMatch) {
			return {
				templateId: templateIdMatch?.[1] ?? null,
				explanation: explanationMatch?.[1] ?? "Intent could not be classified.",
			};
		}

		// All parsing strategies failed — return null so retry wrapper can try again
		console.error("classifyIntentOnce: failed to parse LLM response:", text);
		return { templateId: null, explanation: "" };
	}
}

// Fix #2: Retry wrapper — up to 3 attempts before surfacing failure to client
const CLASSIFY_MAX_ATTEMPTS = 3;

export async function classifyIntent(intent: string): Promise<ClassifyResult> {
	const client = getClient();

	for (let attempt = 1; attempt <= CLASSIFY_MAX_ATTEMPTS; attempt++) {
		const result = await classifyIntentOnce(client, intent);

		// Parsing succeeded AND LLM returned a valid templateId → done
		if (result.templateId !== null) return result;

		// LLM returned null with a real explanation → it genuinely doesn't match any template
		// Don't retry in this case — it's a semantic decision, not a parse failure
		if (result.explanation) return result;

		// Parse failure (explanation is empty) — retry if attempts remain
		if (attempt < CLASSIFY_MAX_ATTEMPTS) {
			console.warn(
				`classifyIntent: attempt ${attempt} parse failed, retrying (${CLASSIFY_MAX_ATTEMPTS - attempt} left)...`,
			);
		}
	}

	console.error(
		`classifyIntent: all ${CLASSIFY_MAX_ATTEMPTS} attempts failed for intent: "${intent}"`,
	);
	return {
		templateId: null,
		explanation:
			"Intent could not be classified. Please try a research-related request.",
	};
}

// ---------------------------------------------------------------------------
// generateExplanation — produce a human-readable explanation of the plan
// ---------------------------------------------------------------------------

export async function generateExplanation(
	board: { columns: Array<{ name: string }> },
	intent: string,
): Promise<string> {
	const client = getClient();

	const columnList = board.columns.map((c) => c.name).join(" → ");

	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 2048,
		system:
			"You explain kanban board plans in 2-3 concise sentences for a non-technical user.",
		messages: [
			{
				role: "user",
				content: `User intent: "${intent}"\n\nBoard columns: ${columnList}\n\nExplain what this board will do and why these steps are needed.`,
			},
		],
	});

	return extractText(response);
}

// ---------------------------------------------------------------------------
// generateClarificationQuestion — ask user to refine ambiguous intent
// ---------------------------------------------------------------------------

export async function generateClarificationQuestion(
	intent: string,
	_board: unknown,
	feedback: string,
): Promise<string> {
	const client = getClient();

	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 2048,
		system:
			"You are helping a user refine their request. Ask ONE focused clarification question.",
		messages: [
			{
				role: "user",
				content: `Original intent: "${intent}"\nUser feedback: "${feedback}"\n\nAsk one clarification question to help refine the request.`,
			},
		],
	});

	return extractText(response);
}

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
	// `reasoning` is intentionally unused in Phase 1: extended-thinking /
	// cache_control gating is deferred to a later phase. Kept in the signature
	// so callers can pass it without a future breaking change.
	_reasoning: boolean,
	onToken: (token: string) => void,
	tools: Tool[] = [],
	toolBudget = 3,
	onToolEvent?: (e: ToolEvent) => void,
): Promise<ExecuteResult> {
	const client = getClient();

	// Substitute {original_intent} before calling LLM
	const rendered = renderSystemPrompt(systemPrompt, {
		original_intent: intent,
	});

	// Build the user message with any previous outputs
	let userContent = intent;
	if (previousOutputs.length > 0) {
		userContent +=
			"\n\n<previous_outputs>\n" +
			previousOutputs.join("\n---\n") +
			"\n</previous_outputs>";
	}

	// Empty tools → legacy single-shot path (no tools param)
	if (tools.length === 0) {
		return executeCardSingleShot(client, rendered, userContent, onToken);
	}

	return executeCardWithTools(
		client,
		rendered,
		userContent,
		tools,
		toolBudget,
		onToken,
		onToolEvent,
	);
}

async function executeCardSingleShot(
	client: Anthropic,
	system: string,
	userContent: string,
	onToken: (token: string) => void,
): Promise<ExecuteResult> {
	const stream = client.messages.stream({
		model: MODEL,
		max_tokens: 4096,
		system,
		messages: [{ role: "user", content: userContent }],
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
	}

	const finalMessage = await stream.finalMessage();

	for (const block of finalMessage.content) {
		if (block.type === "thinking") {
			thinking = block.thinking;
		}
	}

	return { output, thinking: thinking || undefined };
}

type AnthropicMessage = Anthropic.MessageParam;

async function executeCardWithTools(
	client: Anthropic,
	system: string,
	userContent: string,
	tools: Tool[],
	toolBudget: number,
	onToken: (token: string) => void,
	onToolEvent?: (e: ToolEvent) => void,
): Promise<ExecuteResult> {
	const toolsByName = new Map(tools.map((t) => [t.name, t]));
	const messages: AnthropicMessage[] = [{ role: "user", content: userContent }];
	let remainingBudget = toolBudget;
	let thinking: string | undefined;
	let lastTurnText = "";
	// Executions + budget refusals + final text turn(s); generous cap avoids
	// empty-output pipeline failure when the model retries past budget.
	const maxIterations = toolBudget * 5 + 10;

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const stream = client.messages.stream({
			model: MODEL,
			max_tokens: 4096,
			system,
			messages,
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

			messages.push({
				role: "assistant",
				content: finalMessage.content,
			});

			const toolResults: Anthropic.ToolResultBlockParam[] = [];

			for (const block of finalMessage.content) {
				if (block.type !== "tool_use") continue;

				const query =
					typeof block.input === "object" &&
					block.input !== null &&
					"query" in block.input
						? String((block.input as { query: unknown }).query)
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
						const resultCount = countSearchResults(result.content);
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

			messages.push({ role: "user", content: toolResults });
			continue;
		}

		// Final turn — stream buffered text via onToken
		if (turnText) {
			onToken(turnText);
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
