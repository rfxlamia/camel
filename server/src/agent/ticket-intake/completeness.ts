export type TicketType = "Bug" | "Feature" | "Improvement";

export interface TicketExtraction {
	title: string | null;
	description: string | null;
	expected: string | null;
	actual: string | null;
	repro: string | null;
	type: TicketType | null;
}

export interface CompletenessResult {
	ready: boolean;
	missingFields: string[];
	question?: string;
}

function isPresent(value: string | null | undefined): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

export function inferTypeFromClassifierAnswer(
	text: string,
): TicketType | null {
	const normalized = text.trim().toLowerCase();
	if (/\bbug(s)?\b/.test(normalized)) return "Bug";
	if (/\bfeature(s)?\b/.test(normalized)) return "Feature";
	if (/\bimprovement(s)?\b/.test(normalized)) return "Improvement";
	return null;
}

function questionForMissingFields(
	fields: TicketExtraction,
	missingFields: string[],
): string {
	if (
		fields.type === "Bug" &&
		(missingFields.includes("expected") || missingFields.includes("actual"))
	) {
		return "What did you expect to happen, and what actually happened instead?";
	}
	if (missingFields.includes("title") && missingFields.includes("description")) {
		return "Could you give this issue a short title and describe what happened?";
	}
	if (missingFields.includes("title")) {
		return "What would be a short title for this issue?";
	}
	if (missingFields.includes("description")) {
		return "Could you describe the issue in a bit more detail?";
	}
	return "Could you share a bit more detail so we can draft the ticket?";
}

export function checkCompleteness(fields: TicketExtraction): CompletenessResult {
	const missingFields: string[] = [];

	if (!isPresent(fields.title)) missingFields.push("title");
	if (!isPresent(fields.description)) missingFields.push("description");

	if (fields.type === "Bug") {
		if (!isPresent(fields.expected)) missingFields.push("expected");
		if (!isPresent(fields.actual)) missingFields.push("actual");
	}

	if (missingFields.length === 0) {
		return { ready: true, missingFields: [] };
	}

	return {
		ready: false,
		missingFields,
		question: questionForMissingFields(fields, missingFields),
	};
}
