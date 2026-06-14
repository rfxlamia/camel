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
// classifyIntent — match user intent to a board template
// ---------------------------------------------------------------------------

export interface ClassifyResult {
	templateId: string | null;
	explanation: string;
}

export async function classifyIntent(intent: string): Promise<ClassifyResult> {
	const client = getClient();

	const systemPrompt = `You are a board-template classifier. Given a user intent, decide which template (if any) fits.

Available templates:
- "research-report": Research & Report — for research, analysis, competitive analysis, market reports, investigation tasks.

Respond with ONLY a JSON object:
{"templateId": "research-report" | null, "explanation": "<one sentence>"}`;

	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 256,
		system: systemPrompt,
		messages: [{ role: "user", content: intent }],
	});

	const text =
		response.content[0]?.type === "text" ? response.content[0].text : "";

	try {
		const parsed = JSON.parse(text) as ClassifyResult;
		return {
			templateId: parsed.templateId ?? null,
			explanation: parsed.explanation ?? "",
		};
	} catch {
		return { templateId: null, explanation: "Failed to parse LLM response." };
	}
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
		max_tokens: 512,
		system:
			"You explain kanban board plans in 2-3 concise sentences for a non-technical user.",
		messages: [
			{
				role: "user",
				content: `User intent: "${intent}"\n\nBoard columns: ${columnList}\n\nExplain what this board will do and why these steps are needed.`,
			},
		],
	});

	return response.content[0]?.type === "text" ? response.content[0].text : "";
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
		max_tokens: 256,
		system:
			"You are helping a user refine their request. Ask ONE focused clarification question.",
		messages: [
			{
				role: "user",
				content: `Original intent: "${intent}"\nUser feedback: "${feedback}"\n\nAsk one clarification question to help refine the request.`,
			},
		],
	});

	return response.content[0]?.type === "text" ? response.content[0].text : "";
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

	// Stream the response
	const stream = client.messages.stream({
		model: MODEL,
		max_tokens: 4096,
		system: rendered,
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

	// Extract thinking block if present (Claude extended thinking)
	for (const block of finalMessage.content) {
		if (block.type === "thinking") {
			thinking = block.thinking;
		}
	}

	return { output, thinking: thinking || undefined };
}
