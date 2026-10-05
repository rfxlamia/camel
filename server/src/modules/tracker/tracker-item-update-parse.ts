import {
	parseAssigneeIds,
	parseDateRange,
	parseLabelIds,
	parseProjectPhase,
} from "../../lib/tracker-item-parsers.js";
import { parseWith } from "../../validators/http.js";
import { intOrNullField } from "../../validators/schemas.js";
import { statusIdField, titleField } from "./tracker-schemas.js";

const priorityIdField = intOrNullField("priorityId must be an integer or null");

export type ParsedTrackerUpdate = {
	setFields: Record<string, unknown>;
	hasProjectPhase: boolean;
	projectPhase:
		| { projectId?: number | null; phaseId?: number | null }
		| undefined;
	hasAssigneeIds: boolean;
	assigneeIds: number[] | undefined;
	hasLabelIds: boolean;
	labelIds: number[] | undefined;
};

/**
 * Validate a general `PATCH /tracker/items/:key` body. Checks run in a fixed
 * order (title, status, priority, project/phase, dates, assignees, labels,
 * "nothing to update") and the first failure wins; `{ error }` maps to HTTP 400.
 */
export async function parseTrackerUpdateBody(
	body: Record<string, unknown>,
	workspaceId: number,
): Promise<ParsedTrackerUpdate | { error: string }> {
	const setFields: Record<string, unknown> = {};
	if (typeof body.title === "string") {
		const title = parseWith(titleField, body.title);
		if (!title.ok) return { error: title.body.error };
		setFields.title = title.data;
	}
	if (typeof body.description === "string") {
		setFields.description = body.description;
	}
	if (body.statusId !== undefined) {
		const statusId = parseWith(statusIdField, body.statusId);
		if (!statusId.ok) return { error: statusId.body.error };
		setFields.status_id = statusId.data;
	}
	if (body.priorityId !== undefined) {
		const priorityId = parseWith(priorityIdField, body.priorityId);
		if (!priorityId.ok) return { error: priorityId.body.error };
		setFields.priority_id = priorityId.data;
	}

	const hasProjectPhase = "projectId" in body || "phaseId" in body;
	let projectPhase: ParsedTrackerUpdate["projectPhase"];
	if (hasProjectPhase) {
		const parsedPhase = await parseProjectPhase(body, workspaceId);
		if ("error" in parsedPhase) return { error: parsedPhase.error };
		projectPhase = parsedPhase;
		if (parsedPhase.projectId !== undefined) {
			setFields.project_id = parsedPhase.projectId;
		}
		if (parsedPhase.phaseId !== undefined) {
			setFields.phase_id = parsedPhase.phaseId;
		}
	}

	if ("startDate" in body || "endDate" in body) {
		const parsedDates = parseDateRange(body);
		if ("error" in parsedDates) return { error: parsedDates.error };
		if ("startDate" in body) setFields.start_date = parsedDates.startDate;
		if ("endDate" in body) setFields.end_date = parsedDates.endDate;
	}

	const hasAssigneeIds = body.assigneeIds !== undefined;
	let assigneeIds: number[] | undefined;
	if (hasAssigneeIds) {
		const parsedAssignees = await parseAssigneeIds(body, workspaceId);
		if ("error" in parsedAssignees) return { error: parsedAssignees.error };
		assigneeIds = parsedAssignees;
	}

	const hasLabelIds = body.labelIds !== undefined;
	let labelIds: number[] | undefined;
	if (hasLabelIds) {
		const parsedLabels = await parseLabelIds(body, workspaceId);
		if ("error" in parsedLabels) return { error: parsedLabels.error };
		labelIds = parsedLabels;
	}

	if (Object.keys(setFields).length === 0 && !hasAssigneeIds && !hasLabelIds) {
		return { error: "no updatable fields provided" };
	}

	return {
		setFields,
		hasProjectPhase,
		projectPhase,
		hasAssigneeIds,
		assigneeIds,
		hasLabelIds,
		labelIds,
	};
}
