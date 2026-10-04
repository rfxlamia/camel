import {
	parseAssigneeIds,
	parseLabelIds,
	parsePriorityId,
} from "../../lib/tracker-item-parsers.js";
import {
	validateCardDescription,
	validateCardTitle,
	validateDueDate,
} from "../../validators/input-length.js";

export type CardSetFields = {
	title?: string;
	description?: string;
	due_date?: string | null;
	priority_id?: number | null;
	project_id?: number | null;
	phase_id?: number | null;
};

/** Which keys the PATCH body carried. Presence (not null) decides whether a
 * field is touched: an explicit null clears a nullable column, an absent key
 * leaves it untouched. */
export type CardUpdateFlags = {
	hasTitle: boolean;
	hasDescription: boolean;
	hasAssigneeIds: boolean;
	hasDueDate: boolean;
	hasPriorityId: boolean;
	hasLabelIds: boolean;
	hasProjectPhase: boolean;
	hasSets: boolean;
};

export type ParsedCardUpdate = {
	version: number | undefined;
	setFields: CardSetFields;
	flags: CardUpdateFlags;
	assigneeIds: number[] | undefined;
	labelIds: number[] | undefined;
};

/** Validate a `PATCH /cards/:id` body; `{ error }` maps to HTTP 400. */
export async function parseCardUpdateBody(
	body: Record<string, unknown>,
	workspaceId: number,
): Promise<ParsedCardUpdate | { error: string }> {
	const { title, description, version } = body;
	if ("statusId" in body) {
		return { error: "statusId is not accepted for card updates" };
	}
	if (version !== undefined && !Number.isInteger(version)) {
		return { error: "version must be an integer" };
	}

	const flags: CardUpdateFlags = {
		hasTitle: "title" in body,
		hasDescription: "description" in body,
		hasAssigneeIds: "assigneeIds" in body,
		hasDueDate: "dueDate" in body,
		hasPriorityId: "priorityId" in body,
		hasLabelIds: "labelIds" in body,
		hasProjectPhase: "projectId" in body || "phaseId" in body,
		hasSets: false,
	};

	const setFields: CardSetFields = {};

	if (flags.hasTitle) {
		const v = validateCardTitle(title as string);
		if (!v.valid) return { error: v.error as string };
		setFields.title = v.trimmed as string;
	}
	if (flags.hasDescription) {
		const v = validateCardDescription(description as string);
		if (!v.valid) return { error: v.error as string };
		setFields.description = v.trimmed as string;
	}
	if (flags.hasDueDate) {
		const dueDate = body.dueDate;
		if (dueDate === null) {
			setFields.due_date = null;
		} else {
			const v = validateDueDate(dueDate as string);
			if (!v.valid) return { error: v.error as string };
			setFields.due_date = v.trimmed as string;
		}
	}

	let assigneeIds: number[] | undefined;
	if (flags.hasAssigneeIds) {
		const parsed = await parseAssigneeIds(body, workspaceId);
		if ("error" in parsed) return { error: parsed.error };
		assigneeIds = parsed;
	}

	if (flags.hasPriorityId) {
		const parsed = await parsePriorityId(body, workspaceId);
		if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
			return { error: parsed.error };
		}
		setFields.priority_id = parsed;
	}

	let labelIds: number[] | undefined;
	if (flags.hasLabelIds) {
		const parsed = await parseLabelIds(body, workspaceId);
		if ("error" in parsed) return { error: parsed.error };
		labelIds = parsed;
	}

	flags.hasSets = Object.keys(setFields).length > 0 || flags.hasProjectPhase;
	if (!flags.hasSets && !flags.hasAssigneeIds && !flags.hasLabelIds) {
		return { error: "no updatable fields provided" };
	}

	return {
		version: version as number | undefined,
		setFields,
		flags,
		assigneeIds,
		labelIds,
	};
}
