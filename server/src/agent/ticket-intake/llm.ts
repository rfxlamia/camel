import type Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config.js";
import { getClient } from "../llm.js";
import { sanitizeUserInput } from "../prompt-sanitizer.js";
import type { TicketExtraction, TicketType } from "./completeness.js";

const MODEL = config.ANTHROPIC_MODEL;

const VALID_TYPES = new Set<TicketType>(["Bug", "Feature", "Improvement"]);

const EXTRACT_SYSTEM_PROMPT = `CRITICAL: Respond with ONLY a raw JSON object {"title":"<string|null>","description":"<string|null>","expected":"<string|null>","actual":"<string|null>","repro":"<string|null>","type":"Bug"|"Feature"|"Improvement"|null}. No preamble, no markdown, no code fences.

<role>
You extract structured ticket fields from a user's message for a Linear issue intake chat.
</role>

<field_definitions>
- title: concise issue title (max ~80 chars)
- description: full problem or request description
- expected: what the user expected to happen (bugs only)
- actual: what actually happened (bugs only)
- repro: steps to reproduce (bugs only, when mentioned)
- type: classify as Bug (broken behavior), Feature (new capability), or Improvement (enhancement to existing behavior); null if unclear
</field_definitions>

<rules>
1. Extract only what the user explicitly stated — do not invent details.
2. Use null for fields not mentioned or not applicable.
3. For bugs, populate expected/actual/repro when the user provides them.
4. Respond in the same language as the user when filling string fields.
</rules>

REMINDER: Your entire response must be valid JSON only — {"title":...,"description":...,"expected":...,"actual":...,"repro":...,"type":...}. No other text.`;

function extractText(response: Anthropic.Message): string {
	return response.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function normalizeExtraction(
	parsed: Partial<TicketExtraction>,
): TicketExtraction {
	const type =
		parsed.type && VALID_TYPES.has(parsed.type) ? parsed.type : null;
	return {
		title: parsed.title ?? null,
		description: parsed.description ?? null,
		expected: parsed.expected ?? null,
		actual: parsed.actual ?? null,
		repro: parsed.repro ?? null,
		type,
	};
}

function parseExtractionText(text: string): TicketExtraction {
	const empty: TicketExtraction = {
		title: null,
		description: null,
		expected: null,
		actual: null,
		repro: null,
		type: null,
	};

	try {
		return normalizeExtraction(JSON.parse(text) as Partial<TicketExtraction>);
	} catch {
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			try {
				return normalizeExtraction(
					JSON.parse(jsonMatch[1].trim()) as Partial<TicketExtraction>,
				);
			} catch {
				// Fall through
			}
		}

		const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
		if (jsonObjectMatch) {
			try {
				return normalizeExtraction(
					JSON.parse(jsonObjectMatch[0]) as Partial<TicketExtraction>,
				);
			} catch {
				// Fall through
			}
		}

		const titleMatch = text.match(/"title"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|null)/);
		const descriptionMatch = text.match(
			/"description"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|null)/,
		);
		const expectedMatch = text.match(
			/"expected"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|null)/,
		);
		const actualMatch = text.match(
			/"actual"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|null)/,
		);
		const reproMatch = text.match(
			/"repro"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|null)/,
		);
		const typeMatch = text.match(
			/"type"\s*:\s*"(Bug|Feature|Improvement)"|null/,
		);

		if (
			titleMatch ||
			descriptionMatch ||
			expectedMatch ||
			actualMatch ||
			reproMatch ||
			typeMatch
		) {
			return normalizeExtraction({
				title: titleMatch?.[1]?.replace(/\\"/g, '"') ?? null,
				description:
					descriptionMatch?.[1]?.replace(/\\"/g, '"') ?? null,
				expected: expectedMatch?.[1]?.replace(/\\"/g, '"') ?? null,
				actual: actualMatch?.[1]?.replace(/\\"/g, '"') ?? null,
				repro: reproMatch?.[1]?.replace(/\\"/g, '"') ?? null,
				type: typeMatch?.[1] as TicketType | undefined,
			});
		}

		console.error("extractTicketFields: failed to parse LLM response:", text);
		return empty;
	}
}

export async function extractTicketFields(
	latestMessage: string,
): Promise<TicketExtraction> {
	const client = getClient();
	const sanitizedMessage = sanitizeUserInput(latestMessage);

	const response = await client.messages.create({
		model: MODEL,
		max_tokens: 2048,
		temperature: 0,
		system: EXTRACT_SYSTEM_PROMPT,
		messages: [{ role: "user", content: sanitizedMessage }],
	});

	return parseExtractionText(extractText(response));
}
