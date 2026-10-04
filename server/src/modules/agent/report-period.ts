import { extractText, getClient, MODEL } from "../../lib/llm/client.js";
import {
	detectPromptInjection,
	sanitizeLLMOutput,
	sanitizeUserInput,
} from "../../lib/llm/prompt-sanitizer.js";
import { logger } from "../../lib/logger.js";

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
		logger.warn(
			{ intentLength: intent.length },
			"detectReportPeriod: prompt injection detected",
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
	// Security: Check for prompt injection attempts
	if (detectPromptInjection(intent)) {
		logger.warn(
			{ intentLength: intent.length },
			"generateClarificationQuestion: prompt injection detected in intent",
		);
		return "I could not process your request. Could you rephrase your question?";
	}
	if (detectPromptInjection(feedback)) {
		logger.warn(
			{ feedbackLength: feedback.length },
			"generateClarificationQuestion: prompt injection detected in feedback",
		);
		return "I could not process your request. Could you rephrase your question?";
	}

	// Security: Sanitize user input before sending to LLM
	const safeIntent = sanitizeUserInput(intent);
	const safeFeedback = sanitizeUserInput(feedback);

	const client = getClient();

	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 2048,
		system:
			"You are helping a user refine their request. Ask ONE focused clarification question.",
		messages: [
			{
				role: "user",
				content: `Original intent: "${safeIntent}"\nUser feedback: "${safeFeedback}"\n\nAsk one clarification question to help refine the request.`,
			},
		],
	});

	return sanitizeLLMOutput(extractText(response));
}
