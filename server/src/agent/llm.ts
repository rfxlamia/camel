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

import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { config } from "../config.js";
import {
	detectPromptInjection,
	sanitizeUserInput,
	sanitizeLLMOutput,
	createSafeSystemPrompt,
	escapeXml,
} from "./prompt-sanitizer.js";
import { renderSystemPrompt } from "./templates.js";
import { toAnthropicToolDefs } from "./tools/registry.js";
import { countSearchResults } from "./tools/trace.js";
import type { Tool, ToolEvent } from "./tools/types.js";

// ---------------------------------------------------------------------------
// Client singleton — lazy-initialized on first call
// ---------------------------------------------------------------------------

const NATIVE = config.ANTHROPIC_BASE_URL ? false : true;
const MODEL = config.ANTHROPIC_MODEL;

// Token budgets for extended thinking (per live-thinking.md + commit f24f292).
// OUTPUT_BUDGET preserved as headroom for report text; native Anthropic counts
// thinking inside max_tokens, so we add THINKING_BUDGET to MAX_TOKENS.
// Always send enabled+budget (MiMo accepts, native requires); never set
// temperature when thinking is on. Design: enabled for ALL columns (ignore
// _reasoning flag).
export const OUTPUT_BUDGET = 16384;
export const THINKING_BUDGET = 8192;
export const MAX_TOKENS = OUTPUT_BUDGET + THINKING_BUDGET; // 24576

let _client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!_client) {
		const opts: ClientOptions = {
			apiKey: config.ANTHROPIC_API_KEY,
		};
		// Support custom base URL for MiMo-compatible endpoints
		if (config.ANTHROPIC_BASE_URL) {
			opts.baseURL = config.ANTHROPIC_BASE_URL;
		}
		// Dual headers for MiMo compatibility: some endpoints expect `api-key`
		// instead of the default `x-api-key` Authorization header.
		if (!NATIVE) {
			opts.defaultHeaders = {
				"api-key": config.ANTHROPIC_API_KEY,
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
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
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
- "status-report": Status Report — for progress updates, "are we on track?" assessments, sprint or weekly status summaries, and team/project health reports based on current work. This includes requests in Indonesian (laporan status, laporan progress), Spanish, French, or any other language.

CRITICAL RULES:
1. Respond with ONLY a raw JSON object. No preamble, no explanation text, no markdown, no code fences.
2. Your entire response must be valid JSON that can be parsed directly.
3. If the intent is research-related in ANY language, use "research-report".
4. If the intent is a status or progress report in ANY language, use "status-report".

{"templateId": "research-report" | "status-report" | null, "explanation": "<one sentence in English>"}`;

// Internal single-attempt classifier — extracted so retry wrapper can call it cleanly
async function classifyIntentOnce(
	client: Anthropic,
	intent: string,
): Promise<ClassifyResult> {
	// Security: Check for prompt injection attempts
	if (detectPromptInjection(intent)) {
		console.warn(
			"classifyIntentOnce: prompt injection detected, intent length:",
			intent.length,
		);
		return {
			templateId: null,
			explanation:
				"Your request contains patterns that look like prompt injection. Please rephrase your research question.",
		};
	}

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
		`classifyIntent: all ${CLASSIFY_MAX_ATTEMPTS} attempts failed for intent length: ${intent.length}`,
	);
	return {
		templateId: null,
		explanation:
			"Intent could not be classified. Please try a research-related request.",
	};
}

// ---------------------------------------------------------------------------
// classifyFollowUpIntent — route follow-up messages with scope guard
// ---------------------------------------------------------------------------

export type FollowUpIntent = "ASK" | "REFINE" | "NEW_DIRECTION" | "OFF_TOPIC";

export interface FollowUpResult {
	intent: FollowUpIntent;
	response: string;
	confidence: number;
}

export interface ConversationMessage {
	role: "user" | "assistant";
	content: string;
}

const VALID_FOLLOW_UP_INTENTS = new Set<FollowUpIntent>([
	"ASK",
	"REFINE",
	"NEW_DIRECTION",
	"OFF_TOPIC",
]);

// Sandwich prompt: JSON-only constraint in FIRST line, repeated near END
const FOLLOW_UP_SYSTEM_PROMPT = `CRITICAL: Respond with ONLY a raw JSON object {"intent":"ASK"|"REFINE"|"NEW_DIRECTION"|"OFF_TOPIC","response":"<text>","confidence":0.0-1.0}. No preamble, no markdown, no code fences.

<role>
You are a follow-up message handler for an agent board that has completed its
research pipeline. You receive the user's new message along with full context
(original intent, final artifact, conversation history).
</role>

<intent_classification>
Classify the user's message into EXACTLY ONE of these types:

1. ASK — User wants to understand, question, or get clarification about the
   board's existing outputs. No modification requested.
   Examples: "Explain the research section", "What did the analysis find?",
   "Why was this recommendation made?"

2. REFINE — User wants to modify, improve, or iterate on the existing
   artifact or specific column outputs. The scope stays within the
   original intent.
   Examples: "Add more data about 2025 trends", "Make the executive
   summary shorter", "The competitor analysis needs more depth"

3. NEW_DIRECTION — User wants to pivot to a DIFFERENT topic that is outside
   the current board's scope. This is NOT a refinement — it's a fundamentally
   different research question.
   Examples: "Now analyze the competitor landscape for product Y",
   "Switch to researching market trends in Southeast Asia",
   "Actually, I want to study supply chain instead"

4. OFF_TOPIC — User's message has NO relation to research, analysis, or the
   board's domain. Nonsense, unrelated tasks, or requests that cannot be
   fulfilled by an agent board.
   Examples: "Write me a Python script", "What's the weather today?",
   "Help me move to a new apartment"
</intent_classification>

<scope_guard_rules>
CRITICAL RULES:
- When in doubt between ASK and REFINE → classify as ASK (safer, cheaper)
- When in doubt between REFINE and NEW_DIRECTION → classify as REFINE
  (keep scope narrow; user will clarify if they meant new topic)
- OFF_TOPIC is only for clearly unrelated requests. If there's ANY plausible
  connection to the board's domain, do NOT classify as OFF_TOPIC.
- For NEW_DIRECTION: respond with a natural language message that informs the
  user the board will be regenerated. Do NOT attempt to answer the new topic.
- For OFF_TOPIC: respond politely, explain you can only help with the board's
  topic, and suggest creating a new board.
</scope_guard_rules>

<response_guidelines>
- Keep responses concise (2-4 sentences max)
- Be helpful and direct
- For ASK: answer the question using the board's outputs as context
- For REFINE: acknowledge the request and explain what will be improved
- For NEW_DIRECTION: confirm the new topic and state that the board will
  be regenerated
- For OFF_TOPIC: politely decline and redirect
</response_guidelines>

<examples>
<example>
  <context>Board topic: "Market research for electric vehicles in Indonesia"</context>
  <user_message>What were the key findings about consumer preferences?</user_message>
  <classification>ASK</classification>
  <response>The research identified three key consumer preferences: (1) price
  sensitivity under 300M IDR, (2) charging infrastructure availability as the
  top concern, and (3) preference for local brands with government subsidies.
  Would you like me to elaborate on any of these?</response>
</example>

<example>
  <context>Board topic: "Market research for electric vehicles in Indonesia"</context>
  <user_message>Add a section about government regulations and subsidies</user_message>
  <classification>REFINE</classification>
  <response>I'll update the research to include a dedicated section on
  government regulations and subsidies for electric vehicles in Indonesia.
  This will cover current policies, recent changes, and their impact on
  market adoption.</response>
</example>

<example>
  <context>Board topic: "Market research for electric vehicles in Indonesia"</context>
  <user_message>Now research the competitor landscape for electric scooters</user_message>
  <classification>NEW_DIRECTION</classification>
  <response>This is a different research topic from the current board (electric
  vehicles → electric scooters). I'll regenerate the board with this new focus.
  The pipeline will re-run with the updated topic.</response>
</example>

<example>
  <context>Board topic: "Market research for electric vehicles in Indonesia"</context>
  <user_message>Write me a Python script to scrape EV prices</user_message>
  <classification>OFF_TOPIC</classification>
  <response>I can help with research and analysis for your board, but writing
  code is outside my scope. If you'd like to research EV pricing data, I can
  include that in the current board — or you can create a new board for a
  different task.</response>
</example>
</examples>

REMINDER: Your entire response must be valid JSON only — {"intent":"...","response":"...","confidence":0.0-1.0}. No other text.`;

function buildFollowUpUserMessage(
	originalIntent: string,
	artifactContent: string | null,
	conversationHistory: Array<{ role: string; content: string }>,
	userMessage: string,
): string {
	const historyText =
		conversationHistory.length > 0
			? conversationHistory
					.map((m) => `<${m.role}>${escapeXml(m.content)}</${m.role}>`)
					.join("\n")
			: "(no prior messages)";

	return `<board_context>
<original_intent>${escapeXml(originalIntent)}</original_intent>
<artifact>${artifactContent != null ? escapeXml(artifactContent) : "(no artifact)"}</artifact>
<conversation_history>
${historyText}
</conversation_history>
</board_context>

<user_message>${userMessage}</user_message>`;
}

function normalizeFollowUpResult(parsed: {
	intent?: string;
	response?: string;
	confidence?: number;
}): FollowUpResult | null {
	const intent = parsed.intent;
	if (!intent || !VALID_FOLLOW_UP_INTENTS.has(intent as FollowUpIntent)) {
		return null;
	}
	const response = parsed.response ?? "";
	if (!response) return null;
	return {
		intent: intent as FollowUpIntent,
		response,
		confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
	};
}

async function classifyFollowUpIntentOnce(
	client: Anthropic,
	originalIntent: string,
	artifactContent: string | null,
	conversationHistory: Array<{ role: string; content: string }>,
	userMessage: string,
): Promise<FollowUpResult | null> {
	// Security: Check for prompt injection attempts
	if (detectPromptInjection(userMessage)) {
		console.warn(
			"classifyFollowUpIntentOnce: prompt injection detected, message length:",
			userMessage.length,
		);
		// Return a safe fallback instead of processing potentially malicious input
		return {
			intent: "OFF_TOPIC",
			response:
				"Your message contains patterns that look like prompt injection. Please rephrase your question.",
			confidence: 0,
		};
	}

	// Security: Sanitize user input before sending to LLM
	const sanitizedMessage = sanitizeUserInput(userMessage);

	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 2048,
		temperature: 0,
		system: FOLLOW_UP_SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: buildFollowUpUserMessage(
					originalIntent,
					artifactContent,
					conversationHistory,
					sanitizedMessage,
				),
			},
		],
	});

	const text = extractText(response);

	try {
		const parsed = JSON.parse(text) as FollowUpResult;
		const result = normalizeFollowUpResult(parsed);
		if (result) return result;
	} catch {
		// Strategy 2: Extract JSON from markdown code blocks
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			try {
				const parsed = JSON.parse(jsonMatch[1].trim()) as FollowUpResult;
				const result = normalizeFollowUpResult(parsed);
				if (result) return result;
			} catch {
				// Fall through
			}
		}

		// Strategy 3: Greedy JSON object match
		const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
		if (jsonObjectMatch) {
			try {
				const parsed = JSON.parse(jsonObjectMatch[0]) as FollowUpResult;
				const result = normalizeFollowUpResult(parsed);
				if (result) return result;
			} catch {
				// Fall through
			}
		}

		// Strategy 4: Field extraction
		const intentMatch = text.match(
			/"intent"\s*:\s*"(ASK|REFINE|NEW_DIRECTION|OFF_TOPIC)"/,
		);
		const responseMatch = text.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
		const confidenceMatch = text.match(/"confidence"\s*:\s*([\d.]+)/);
		if (intentMatch && responseMatch) {
			const result = normalizeFollowUpResult({
				intent: intentMatch[1],
				response: responseMatch[1].replace(/\\"/g, '"'),
				confidence: confidenceMatch
					? Number.parseFloat(confidenceMatch[1])
					: 0.5,
			});
			if (result) return result;
		}
	}

	console.error(
		"classifyFollowUpIntentOnce: failed to parse LLM response:",
		text,
	);
	return null;
}

const FOLLOW_UP_MAX_ATTEMPTS = 3;

export async function classifyFollowUpIntent(
	originalIntent: string,
	artifactContent: string | null,
	conversationHistory: Array<{ role: string; content: string }>,
	userMessage: string,
): Promise<FollowUpResult> {
	const client = getClient();

	for (let attempt = 1; attempt <= FOLLOW_UP_MAX_ATTEMPTS; attempt++) {
		const result = await classifyFollowUpIntentOnce(
			client,
			originalIntent,
			artifactContent,
			conversationHistory,
			userMessage,
		);

		if (result) {
			// Security: Sanitize the response to prevent leakage
			return {
				...result,
				response: sanitizeLLMOutput(result.response),
			};
		}

		if (attempt < FOLLOW_UP_MAX_ATTEMPTS) {
			console.warn(
				`classifyFollowUpIntent: attempt ${attempt} parse failed, retrying (${FOLLOW_UP_MAX_ATTEMPTS - attempt} left)...`,
			);
		}
	}

	console.error(
		`classifyFollowUpIntent: all ${FOLLOW_UP_MAX_ATTEMPTS} attempts failed for message length: ${userMessage.length}`,
	);
	return {
		intent: "OFF_TOPIC",
		response: "Your message could not be processed. Please try again.",
		confidence: 0,
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
// detectReportPeriod — check whether a status-report intent names a time window
// ---------------------------------------------------------------------------

export interface ReportPeriodResult {
	hasPeriod: boolean;
	question?: string;
}

const DETECT_PERIOD_SYSTEM_PROMPT = `You detect whether a status-report request specifies a time period (e.g. "last 2 weeks", "Q1 2026", "this month", "past 30 days").

CRITICAL RULES:
1. Respond with ONLY a raw JSON object. No preamble, no markdown, no code fences.
2. If a time period is present or clearly implied, respond: {"hasPeriod": true}
3. If no time period is specified, respond: {"hasPeriod": false, "question": "<one focused question asking which period the report should cover>"}`;

export async function detectReportPeriod(
	intent: string,
): Promise<ReportPeriodResult> {
	const client = getClient();

	// Security: Check for prompt injection attempts
	if (detectPromptInjection(intent)) {
		console.warn(
			"detectReportPeriod: prompt injection detected, intent length:",
			intent.length,
		);
		return {
			hasPeriod: false,
			question: "Which time period should this status report cover?",
		};
	}

	// Security: Sanitize user input before sending to LLM
	const sanitizedIntent = sanitizeUserInput(intent);

	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 512,
		temperature: 0,
		system: DETECT_PERIOD_SYSTEM_PROMPT,
		messages: [{ role: "user", content: sanitizedIntent }],
	});

	const text = extractText(response);

	try {
		const parsed = JSON.parse(text) as ReportPeriodResult;
		if (
			typeof parsed.hasPeriod === "boolean" &&
			(parsed.question === undefined || typeof parsed.question === "string")
		) {
			return parsed;
		}
	} catch {
		// fall through to default
	}

	// Conservative fallback: treat unparseable as missing period
	return {
		hasPeriod: false,
		question: "Which time period should this status report cover?",
	};
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
	// `reasoning` flag is ignored: per spec, extended thinking is enabled for
	// ALL columns (design decision). Kept for caller compat.
	_reasoning: boolean,
	onToken: (token: string) => void,
	tools: Tool[] = [],
	toolBudget = 3,
	onToolEvent?: (e: ToolEvent) => void,
	// onThinking receives live thinking_delta text on both single-shot and
	// tools paths. Optional for backward compat with existing callers.
	onThinking?: (text: string) => void,
	userContent?: string,
): Promise<ExecuteResult> {
	const client = getClient();

	// Security: Check for prompt injection attempts (LOG AND CONTINUE, don't hard-fail)
	if (detectPromptInjection(intent)) {
		console.warn(
			"executeCard: prompt injection detected in intent, length:",
			intent.length,
		);
		// Continue execution — don't turn a noisy heuristic into a denial-of-service
	}

	// Substitute {original_intent} before calling LLM
	const rendered = renderSystemPrompt(systemPrompt, {
		original_intent: intent,
	});

	// Security: Add security constraints to system prompt
	const safeSystemPrompt = createSafeSystemPrompt(rendered);

	// Build the user message with any previous outputs
	let messageContent = userContent ?? intent;
	if (previousOutputs.length > 0) {
		messageContent +=
			"\n\n<previous_outputs>\n" +
			previousOutputs.join("\n---\n") +
			"\n</previous_outputs>";
	}

	// Security: Sanitize user input
	const sanitizedContent = sanitizeUserInput(messageContent);

	let result: ExecuteResult;

	// Empty tools → legacy single-shot path (no tools param)
	if (tools.length === 0) {
		result = await executeCardSingleShot(
			client,
			safeSystemPrompt,
			sanitizedContent,
			onToken,
			onThinking,
		);
	} else {
		result = await executeCardWithTools(
			client,
			safeSystemPrompt,
			sanitizedContent,
			tools,
			toolBudget,
			onToken,
			onToolEvent,
			onThinking,
		);
	}

	// Security: Sanitize LLM output to prevent leakage
	return {
		...result,
		output: sanitizeLLMOutput(result.output),
	};
}

async function executeCardSingleShot(
	client: Anthropic,
	system: string,
	userContent: string,
	onToken: (token: string) => void,
	onThinking?: (text: string) => void,
): Promise<ExecuteResult> {
	const stream = client.messages.stream({
		model: MODEL,
		// Extended thinking enabled for every card (design: all columns).
		// MAX_TOKENS = OUTPUT_BUDGET + THINKING_BUDGET keeps output headroom
		// >=16384 so stop_reason !== max_tokens on long reports (anti-truncation).
		max_tokens: MAX_TOKENS,
		thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
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

type AnthropicMessage = Anthropic.MessageParam;

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

async function executeCardWithTools(
	client: Anthropic,
	system: string,
	userContent: string,
	tools: Tool[],
	toolBudget: number,
	onToken: (token: string) => void,
	onToolEvent?: (e: ToolEvent) => void,
	onThinking?: (text: string) => void,
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
			// Extended thinking + budgeted max for tool path too (same math as single-shot).
			max_tokens: MAX_TOKENS,
			thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
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
				onToken(event.delta.text); // live during the turn (incl. pre-tool text), not buffered to final only
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

			messages.push({
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
							query: query ?? (result.ok ? result.content : undefined),
							resultCount,
						});
						toolResults.push({
							type: "tool_result",
							tool_use_id: block.id,
							content: escapeXml(result.content),
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
							content: escapeXml(result.content),
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

		// Note: text deltas (incl final turn) are streamed live via onToken above;
		// no re-emit of full turnText here (would duplicate). Passback of assistant
		// content below is kept RAW so signed thinking blocks survive tool-loop turns.
		return { output: turnText, thinking };
	}

	return {
		output:
			lastTurnText ||
			"The agent could not complete this step within the tool loop limit.",
		thinking,
	};
}
