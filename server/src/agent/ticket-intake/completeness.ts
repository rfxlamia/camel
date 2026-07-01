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

	let question: string | undefined;
	if (
		fields.type === "Bug" &&
		(missingFields.includes("expected") || missingFields.includes("actual"))
	) {
		question =
			"What did you expect to happen, and what actually happened instead?";
	}

	return { ready: false, missingFields, question };
}
