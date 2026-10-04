import type Anthropic from "@anthropic-ai/sdk";
import { extractText, getClient, MODEL } from "../../lib/llm/client.js";
import { detectPromptInjection } from "../../lib/llm/prompt-sanitizer.js";
import { logger } from "../../lib/logger.js";
import { TEMPLATES } from "./templates.js";

// ---------------------------------------------------------------------------
// classifyIntent — match user intent to a board template
// ---------------------------------------------------------------------------

export interface ClassifyResult {
	templateId: string | null;
	explanation: string;
}

export const UNKNOWN_TEMPLATE_EXPLANATION =
	"Intent could not be matched to a supported template. Please try a research-related request.";

/**
 * Allow-list the LLM's templateId against real templates. Unknown values
 * (e.g. "Research Report") are downgraded to null so createBoard returns 422
 * instead of creating a board with zero columns.
 */
export function normalizeClassifyResult(parsed: {
	templateId?: unknown;
	explanation?: unknown;
}): ClassifyResult {
	const explanation =
		typeof parsed.explanation === "string" ? parsed.explanation : "";
	const raw = parsed.templateId;
	if (raw === null || raw === undefined) {
		return { templateId: null, explanation };
	}
	const templateId = typeof raw === "string" ? raw.trim() : "";
	// hasOwn: plain-object lookup would accept "constructor", "toString", etc.
	if (templateId && Object.hasOwn(TEMPLATES, templateId)) {
		return { templateId, explanation };
	}
	logger.warn(
		{ templateId: raw },
		"classifyIntent: LLM returned unknown templateId",
	);
	return { templateId: null, explanation: UNKNOWN_TEMPLATE_EXPLANATION };
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
		logger.warn(
			{ intentLength: intent.length },
			"classifyIntentOnce: prompt injection detected",
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
		return normalizeClassifyResult(JSON.parse(text));
	} catch {
		// Strategy 2: Extract JSON from markdown code blocks
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			try {
				return normalizeClassifyResult(JSON.parse(jsonMatch[1].trim()));
			} catch {
				// Fall through to next strategy
			}
		}

		// Fix #3: Strategy 3 — greedy [\s\S]* agar tidak berhenti di } dalam string
		const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
		if (jsonObjectMatch) {
			try {
				return normalizeClassifyResult(JSON.parse(jsonObjectMatch[0]));
			} catch {
				// Fall through to next strategy
			}
		}

		// Strategy 4: Try to extract templateId and explanation from text
		const templateIdMatch = text.match(/"templateId"\s*:\s*(?:"([^"]+)"|null)/);
		const explanationMatch = text.match(/"explanation"\s*:\s*"([^"]+)"/);
		if (templateIdMatch || explanationMatch) {
			return normalizeClassifyResult({
				templateId: templateIdMatch?.[1] ?? null,
				explanation: explanationMatch?.[1] ?? "Intent could not be classified.",
			});
		}

		// All parsing strategies failed — return null so retry wrapper can try again
		logger.error({ text }, "classifyIntentOnce: failed to parse LLM response");
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
			logger.warn(
				{ attempt, attemptsLeft: CLASSIFY_MAX_ATTEMPTS - attempt },
				"classifyIntent: parse failed, retrying",
			);
		}
	}

	logger.error(
		{ attempts: CLASSIFY_MAX_ATTEMPTS, intentLength: intent.length },
		"classifyIntent: all attempts failed",
	);
	return {
		templateId: null,
		explanation:
			"Intent could not be classified. Please try a research-related request.",
	};
}
