import { db } from "../db/kysely.js";
import { validateDueDate } from "../validators/input-length.js";
import { lookupMembership } from "./helpers.js";

async function lookupProject(
	workspaceId: number,
	projectId: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("tracker_projects")
		.select("id")
		.where("id", "=", projectId)
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}

async function lookupPhase(
	workspaceId: number,
	phaseId: number,
): Promise<{ id: number; project_id: number } | undefined> {
	return db
		.selectFrom("tracker_phases as tp")
		.innerJoin("tracker_projects as tpr", "tpr.id", "tp.project_id")
		.select(["tp.id as id", "tp.project_id as project_id"])
		.where("tp.id", "=", phaseId)
		.where("tp.deleted_at", "is", null)
		.where("tpr.workspace_id", "=", workspaceId)
		.where("tpr.deleted_at", "is", null)
		.executeTakeFirst();
}

export async function parseLabelIds(
	body: Record<string, unknown>,
	workspaceId: number,
): Promise<number[] | { error: string }> {
	const raw = body.labelIds;
	if (!Array.isArray(raw)) {
		return { error: "labelIds must be an array of integers" };
	}
	const ids: number[] = [];
	for (const id of raw) {
		if (!Number.isInteger(id)) {
			return { error: "labelIds must be an array of integers" };
		}
		ids.push(id as number);
	}
	for (const labelId of [...new Set(ids)]) {
		const row = await db
			.selectFrom("tracker_vocabularies")
			.select("id")
			.where("id", "=", labelId)
			.where("workspace_id", "=", workspaceId)
			.where("kind", "=", "label")
			.executeTakeFirst();
		if (!row) {
			return { error: "label must belong to this workspace" };
		}
	}
	return ids;
}

export async function parseAssigneeIds(
	body: Record<string, unknown>,
	workspaceId: number,
): Promise<number[] | { error: string }> {
	const raw = body.assigneeIds;
	if (!Array.isArray(raw)) {
		return { error: "assigneeIds must be an array of integers" };
	}
	const ids: number[] = [];
	for (const id of raw) {
		if (!Number.isInteger(id)) {
			return { error: "assigneeIds must be an array of integers" };
		}
		ids.push(id as number);
	}
	for (const userId of [...new Set(ids)]) {
		const role = await lookupMembership(userId, workspaceId);
		if (!role) {
			return { error: "assignee must be a member of this workspace" };
		}
	}
	return ids;
}

/**
 * Parse projectId / phaseId from a PATCH body.
 *
 * Callers must invoke only when `'projectId' in body || 'phaseId' in body`.
 * A body with neither key is rejected.
 */
export async function parseProjectPhase(
	body: Record<string, unknown>,
	workspaceId: number,
): Promise<
	{ projectId?: number | null; phaseId?: number | null } | { error: string }
> {
	const hasProjectId = "projectId" in body;
	const hasPhaseId = "phaseId" in body;
	const rawProjectId = body.projectId;
	const rawPhaseId = body.phaseId;

	if (!hasProjectId && !hasPhaseId) {
		return { error: "projectId and phaseId must be integers or null" };
	}

	if (
		hasProjectId &&
		rawProjectId === null &&
		(!hasPhaseId || rawPhaseId === null || rawPhaseId === undefined)
	) {
		return { projectId: null, phaseId: null };
	}

	if (
		hasProjectId &&
		rawProjectId === null &&
		hasPhaseId &&
		rawPhaseId !== null &&
		rawPhaseId !== undefined
	) {
		return { error: "phase cannot be set without a project" };
	}

	if (hasPhaseId && rawPhaseId === null && !hasProjectId) {
		return { phaseId: null };
	}

	if (
		hasPhaseId &&
		typeof rawPhaseId === "number" &&
		Number.isInteger(rawPhaseId)
	) {
		const phase = await lookupPhase(workspaceId, rawPhaseId);
		if (!phase) {
			return { error: "phase must belong to this workspace" };
		}

		if (
			hasProjectId &&
			typeof rawProjectId === "number" &&
			Number.isInteger(rawProjectId)
		) {
			if (phase.project_id !== rawProjectId) {
				return { error: "phase must belong to the selected project" };
			}
			const project = await lookupProject(workspaceId, rawProjectId);
			if (!project) {
				return { error: "project must belong to this workspace" };
			}
			return { projectId: rawProjectId, phaseId: rawPhaseId };
		}

		if (!hasProjectId || rawProjectId === undefined) {
			const project = await lookupProject(workspaceId, phase.project_id);
			if (!project) {
				return { error: "project must belong to this workspace" };
			}
			return { projectId: phase.project_id, phaseId: rawPhaseId };
		}
	}

	if (
		hasProjectId &&
		typeof rawProjectId === "number" &&
		Number.isInteger(rawProjectId) &&
		(!hasPhaseId || rawPhaseId === null || rawPhaseId === undefined)
	) {
		const project = await lookupProject(workspaceId, rawProjectId);
		if (!project) {
			return { error: "project must belong to this workspace" };
		}
		return { projectId: rawProjectId, phaseId: null };
	}

	return { error: "projectId and phaseId must be integers or null" };
}

function parseOptionalDate(
	value: unknown,
	field: "startDate" | "endDate",
): string | null | { error: string } {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "string") {
		return { error: `${field} must be a YYYY-MM-DD string or null` };
	}
	const validated = validateDueDate(value);
	if (!validated.valid) {
		const message = validated.error ?? "invalid date";
		return {
			error: message.startsWith("due date")
				? message.replace("due date", field)
				: `${field}: ${message}`,
		};
	}
	return validated.trimmed!;
}

export function parseDateRange(
	body: Record<string, unknown>,
): { startDate: string | null; endDate: string | null } | { error: string } {
	const hasStart = "startDate" in body;
	const hasEnd = "endDate" in body;

	let startDate: string | null = null;
	let endDate: string | null = null;

	if (hasStart) {
		const parsed = parseOptionalDate(body.startDate, "startDate");
		if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
			return parsed;
		}
		startDate = parsed;
	}

	if (hasEnd) {
		const parsed = parseOptionalDate(body.endDate, "endDate");
		if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
			return parsed;
		}
		endDate = parsed;
	}

	if (startDate !== null && endDate !== null && endDate < startDate) {
		return { error: "end date must not precede start date" };
	}

	return { startDate, endDate };
}
