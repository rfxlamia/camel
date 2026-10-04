import type Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../lib/logger.js";
import { FOLLOW_UP_SYSTEM_PROMPT } from "./follow-up-prompt.js";
import { extractText, getClient, MODEL } from "./llm-client.js";
import {
	detectPromptInjection,
	escapeXml,
	sanitizeLLMOutput,
	sanitizeUserInput,
} from "./prompt-sanitizer.js";

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

function buildFollowUpUserMessage(
	originalIntent: string,
	artifactContent: string | null,
	conversationHistory: Array<{ role: string; content: string }>,
	userMessage: string,
): string {
	const historyText =
		conversationHistory.length > 0
			? conversationHistory
					.map((m) => {
						const safeRole =
							m.role === "user" || m.role === "assistant" || m.role === "system"
								? m.role
								: "user";
						return `<${safeRole}>${escapeXml(m.content)}</${safeRole}>`;
					})
					.join("\n")
			: "(no prior messages)";

	// userMessage is pre-sanitized by sanitizeUserInput() in the caller — do NOT re-escape
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
		logger.warn(
			{ messageLength: userMessage.length },
			"classifyFollowUpIntentOnce: prompt injection detected",
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

	logger.error(
		{ text },
		"classifyFollowUpIntentOnce: failed to parse LLM response",
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
			logger.warn(
				{ attempt, attemptsLeft: FOLLOW_UP_MAX_ATTEMPTS - attempt },
				"classifyFollowUpIntent: parse failed, retrying",
			);
		}
	}

	logger.error(
		{ attempts: FOLLOW_UP_MAX_ATTEMPTS, messageLength: userMessage.length },
		"classifyFollowUpIntent: all attempts failed",
	);
	return {
		intent: "OFF_TOPIC",
		response: "Your message could not be processed. Please try again.",
		confidence: 0,
	};
}
