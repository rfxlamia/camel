import { type DBExecutor, db } from "../db/kysely.js";
import { validateDueDate } from "../validators/input-length.js";

async function lookupProject(
	workspaceId: number,
	projectId: number,
	dbExec: DBExecutor = db,
): Promise<{ id: number } | undefined> {
	return dbExec
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
	dbExec: DBExecutor = db,
): Promise<{ id: number; project_id: number } | undefined> {
	return dbExec
		.selectFrom("tracker_phases as tp")
		.innerJoin("tracker_projects as tpr", "tpr.id", "tp.project_id")
		.select(["tp.id as id", "tp.project_id as project_id"])
		.where("tp.id", "=", phaseId)
		.where("tp.deleted_at", "is", null)
		.where("tpr.workspace_id", "=", workspaceId)
		.where("tpr.deleted_at", "is", null)
		.executeTakeFirst();
}

export async function parsePriorityId(
	body: Record<string, unknown>,
	workspaceId: number,
	dbExec: DBExecutor = db,
): Promise<number | null | { error: string }> {
	if (!("priorityId" in body)) {
		return { error: "priorityId must be an integer or null" };
	}
	const raw = body.priorityId;
	if (raw === null) {
		return null;
	}
	if (!Number.isInteger(raw)) {
		return { error: "priorityId must be an integer or null" };
	}
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("id", "=", raw as number)
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "priority")
		.executeTakeFirst();
	if (!row) {
		return { error: "priority must belong to this workspace" };
	}
	return raw as number;
}

export async function parseLabelIds(
	body: Record<string, unknown>,
	workspaceId: number,
	dbExec: DBExecutor = db,
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
		const row = await dbExec
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
	dbExec: DBExecutor = db,
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
		const member = await dbExec
			.selectFrom("workspace_members")
			.select("role")
			.where("workspace_id", "=", workspaceId)
			.where("user_id", "=", userId)
			.executeTakeFirst();
		const role = member?.role;
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
type ProjectPhaseResult =
	| { projectId?: number | null; phaseId?: number | null }
	| { error: string };

async function parseExplicitPhase(
	body: Record<string, unknown>,
	workspaceId: number,
	dbExec: DBExecutor,
	hasProjectId: boolean,
	hasPhaseId: boolean,
): Promise<ProjectPhaseResult | undefined> {
	const rawPhaseId = body.phaseId;
	if (
		!hasPhaseId ||
		typeof rawPhaseId !== "number" ||
		!Number.isInteger(rawPhaseId)
	) {
		return undefined;
	}

	const phase = await lookupPhase(workspaceId, rawPhaseId, dbExec);
	if (!phase) return { error: "phase must belong to this workspace" };

	const rawProjectId = body.projectId;
	if (
		hasProjectId &&
		typeof rawProjectId === "number" &&
		Number.isInteger(rawProjectId)
	) {
		if (phase.project_id !== rawProjectId) {
			return { error: "phase must belong to the selected project" };
		}
		const project = await lookupProject(workspaceId, rawProjectId, dbExec);
		return project
			? { projectId: rawProjectId, phaseId: rawPhaseId }
			: { error: "project must belong to this workspace" };
	}

	if (!hasProjectId || rawProjectId === undefined) {
		const project = await lookupProject(workspaceId, phase.project_id, dbExec);
		return project
			? { projectId: phase.project_id, phaseId: rawPhaseId }
			: { error: "project must belong to this workspace" };
	}
	return undefined;
}

async function parseProjectOnly(
	body: Record<string, unknown>,
	workspaceId: number,
	dbExec: DBExecutor,
	hasProjectId: boolean,
	hasPhaseId: boolean,
): Promise<ProjectPhaseResult | undefined> {
	const rawProjectId = body.projectId;
	if (
		!hasProjectId ||
		typeof rawProjectId !== "number" ||
		!Number.isInteger(rawProjectId) ||
		(hasPhaseId && body.phaseId !== null && body.phaseId !== undefined)
	) {
		return undefined;
	}
	const project = await lookupProject(workspaceId, rawProjectId, dbExec);
	return project
		? { projectId: rawProjectId, phaseId: null }
		: { error: "project must belong to this workspace" };
}

function parseProjectPhaseBase(
	body: Record<string, unknown>,
	hasProjectId: boolean,
	hasPhaseId: boolean,
): ProjectPhaseResult | undefined {
	const rawProjectId = body.projectId;
	const rawPhaseId = body.phaseId;
	if (!hasProjectId && !hasPhaseId) {
		return { error: "projectId and phaseId must be integers or null" };
	}
	if (hasProjectId && rawProjectId === null) {
		return !hasPhaseId || rawPhaseId === null || rawPhaseId === undefined
			? { projectId: null, phaseId: null }
			: { error: "phase cannot be set without a project" };
	}
	if (hasPhaseId && rawPhaseId === null && !hasProjectId) {
		return { phaseId: null };
	}
	return undefined;
}

export async function parseProjectPhase(
	body: Record<string, unknown>,
	workspaceId: number,
	dbExec: DBExecutor = db,
): Promise<ProjectPhaseResult> {
	const hasProjectId = "projectId" in body;
	const hasPhaseId = "phaseId" in body;
	const base = parseProjectPhaseBase(body, hasProjectId, hasPhaseId);
	if (base !== undefined) return base;
	return (
		(await parseExplicitPhase(
			body,
			workspaceId,
			dbExec,
			hasProjectId,
			hasPhaseId,
		)) ??
		(await parseProjectOnly(
			body,
			workspaceId,
			dbExec,
			hasProjectId,
			hasPhaseId,
		)) ?? { error: "projectId and phaseId must be integers or null" }
	);
}

/**
 * Parse projectId / phaseId for card PATCH using the board effective-project contract.
 *
 * When only phaseId is sent, the card's current project_id is the effective project:
 * phase-only updates are rejected if the card has no project, and the phase must
 * belong to that effective project (not derived from the phase row).
 */
export async function parseCardProjectPhase(
	body: Record<string, unknown>,
	workspaceId: number,
	cardProjectId: number | null,
	dbExec: DBExecutor = db,
): Promise<
	{ projectId?: number | null; phaseId?: number | null } | { error: string }
> {
	const hasProjectId = "projectId" in body;
	const hasPhaseId = "phaseId" in body;

	if (!hasProjectId && !hasPhaseId) {
		return { error: "projectId and phaseId must be integers or null" };
	}

	if (
		!hasProjectId &&
		hasPhaseId &&
		body.phaseId !== null &&
		body.phaseId !== undefined
	) {
		if (cardProjectId === null) {
			return { error: "phase cannot be set without a project" };
		}
		if (!Number.isInteger(body.phaseId)) {
			return { error: "projectId and phaseId must be integers or null" };
		}
		const phase = await lookupPhase(
			workspaceId,
			body.phaseId as number,
			dbExec,
		);
		if (!phase) {
			return { error: "phase must belong to this workspace" };
		}
		if (phase.project_id !== cardProjectId) {
			return { error: "phase must belong to the selected project" };
		}
		return { phaseId: body.phaseId as number };
	}

	return parseProjectPhase(body, workspaceId, dbExec);
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

export type DateRangeFieldErrors = Partial<
	Record<"startDate" | "endDate", string>
>;

export type DateRangeParseResult =
	| { startDate: string | null; endDate: string | null }
	| { error: string; fieldErrors?: DateRangeFieldErrors };

function dateError(
	error: string,
	fieldErrors: DateRangeFieldErrors,
): DateRangeParseResult {
	return { error, fieldErrors };
}

export function parseDateRange(
	body: Record<string, unknown>,
): DateRangeParseResult {
	const hasStart = "startDate" in body;
	const hasEnd = "endDate" in body;

	let startDate: string | null = null;
	let endDate: string | null = null;
	const fieldErrors: DateRangeFieldErrors = {};

	if (hasStart) {
		const parsed = parseOptionalDate(body.startDate, "startDate");
		if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
			fieldErrors.startDate = parsed.error;
		} else {
			startDate = parsed;
		}
	}

	if (hasEnd) {
		const parsed = parseOptionalDate(body.endDate, "endDate");
		if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
			fieldErrors.endDate = parsed.error;
		} else {
			endDate = parsed;
		}
	}

	if (Object.keys(fieldErrors).length > 0) {
		return dateError(Object.values(fieldErrors)[0] as string, fieldErrors);
	}

	if (startDate !== null && endDate !== null && endDate < startDate) {
		const error = "end date must not precede start date";
		return dateError(error, { startDate: error, endDate: error });
	}

	return { startDate, endDate };
}
