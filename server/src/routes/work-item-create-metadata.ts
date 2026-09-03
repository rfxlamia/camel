import type { DBExecutor } from "../db/kysely.js";
import {
	parseAssigneeIds,
	parseLabelIds,
	parsePriorityId,
	parseProjectPhase,
} from "./tracker-item-parsers.js";

export type TaskCreateField =
	| "statusId"
	| "assigneeIds"
	| "priorityId"
	| "labelIds"
	| "projectId"
	| "phaseId";

export type TaskCreateFieldErrors = Partial<Record<TaskCreateField, string>>;

export type TaskCreateMetadataInput = Record<string, unknown>;

export type NormalizedTaskCreateMetadata = {
	statusId?: number;
	priorityId?: number | null;
	labelIds?: number[];
	assigneeIds?: number[];
	projectId?: number | null;
	phaseId?: number | null;
};

export type TaskCreateMetadataValidation = {
	valid: boolean;
	error?: string;
	fieldErrors: TaskCreateFieldErrors;
	metadata: NormalizedTaskCreateMetadata;
	/** Always false: this helper only reads and locks references. */
	mutationPerformed: false;
};

function isExecutor(value: unknown): value is DBExecutor {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { selectFrom?: unknown }).selectFrom === "function"
	);
}

function addError(
	fieldErrors: TaskCreateFieldErrors,
	field: TaskCreateField,
	error: string,
): void {
	if (fieldErrors[field] === undefined) fieldErrors[field] = error;
}

function addProjectPhaseError(
	fieldErrors: TaskCreateFieldErrors,
	error: string,
): void {
	if (error.startsWith("phase")) {
		if (error === "phase must belong to the selected project") {
			addError(fieldErrors, "projectId", error);
		}
		addError(fieldErrors, "phaseId", error);
		return;
	}
	if (error.startsWith("project")) {
		addError(fieldErrors, "projectId", error);
		return;
	}
	addError(fieldErrors, "projectId", error);
	addError(fieldErrors, "phaseId", error);
}

async function applyStatusMetadata(
	body: TaskCreateMetadataInput,
	workspaceId: number,
	dbExec: DBExecutor,
	fieldErrors: TaskCreateFieldErrors,
	metadata: NormalizedTaskCreateMetadata,
): Promise<void> {
	if (!("statusId" in body)) return;
	const value = body.statusId;
	if (!Number.isInteger(value)) {
		addError(fieldErrors, "statusId", "statusId must be an integer");
		return;
	}
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("id", "=", value as number)
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.executeTakeFirst();
	if (!row) {
		addError(fieldErrors, "statusId", "status must belong to this workspace");
	} else {
		metadata.statusId = value as number;
	}
}

async function applyPriorityMetadata(
	body: TaskCreateMetadataInput,
	workspaceId: number,
	dbExec: DBExecutor,
	fieldErrors: TaskCreateFieldErrors,
	metadata: NormalizedTaskCreateMetadata,
): Promise<void> {
	if (!("priorityId" in body)) return;
	const parsed = await parsePriorityId(body, workspaceId, dbExec);
	if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
		addError(fieldErrors, "priorityId", parsed.error);
	} else {
		metadata.priorityId = parsed;
	}
}

async function applyLabelMetadata(
	body: TaskCreateMetadataInput,
	workspaceId: number,
	dbExec: DBExecutor,
	fieldErrors: TaskCreateFieldErrors,
	metadata: NormalizedTaskCreateMetadata,
): Promise<void> {
	if (!("labelIds" in body)) return;
	const parsed = await parseLabelIds(body, workspaceId, dbExec);
	if ("error" in parsed) {
		addError(fieldErrors, "labelIds", parsed.error);
	} else {
		metadata.labelIds = parsed;
	}
}

async function applyAssigneeMetadata(
	body: TaskCreateMetadataInput,
	workspaceId: number,
	dbExec: DBExecutor,
	fieldErrors: TaskCreateFieldErrors,
	metadata: NormalizedTaskCreateMetadata,
): Promise<void> {
	if (!("assigneeIds" in body)) return;
	const parsed = await parseAssigneeIds(body, workspaceId, dbExec);
	if ("error" in parsed) {
		addError(fieldErrors, "assigneeIds", parsed.error);
	} else {
		metadata.assigneeIds = parsed;
	}
}

async function applyProjectPhaseMetadata(
	body: TaskCreateMetadataInput,
	workspaceId: number,
	dbExec: DBExecutor,
	fieldErrors: TaskCreateFieldErrors,
	metadata: NormalizedTaskCreateMetadata,
): Promise<void> {
	if (!("projectId" in body || "phaseId" in body)) return;
	const parsed = await parseProjectPhase(body, workspaceId, dbExec);
	if ("error" in parsed) {
		addProjectPhaseError(fieldErrors, parsed.error);
	} else {
		if (parsed.projectId !== undefined) metadata.projectId = parsed.projectId;
		if (parsed.phaseId !== undefined) metadata.phaseId = parsed.phaseId;
	}
}

/**
 * Validate task metadata using the executor supplied by the caller.
 *
 * The overload accepting `(body, workspaceId, dbExec)` is retained for small
 * adapters that naturally put request data first; all database work still uses
 * the supplied executor.
 */
export function validateTaskCreateMetadata(
	dbExec: DBExecutor,
	workspaceId: number,
	body: TaskCreateMetadataInput,
): Promise<TaskCreateMetadataValidation>;
export function validateTaskCreateMetadata(
	body: TaskCreateMetadataInput,
	workspaceId: number,
	dbExec: DBExecutor,
): Promise<TaskCreateMetadataValidation>;
export async function validateTaskCreateMetadata(
	first: DBExecutor | TaskCreateMetadataInput,
	workspaceId: number,
	third: DBExecutor | TaskCreateMetadataInput,
): Promise<TaskCreateMetadataValidation> {
	const dbExec = isExecutor(first) ? first : (third as DBExecutor);
	const body = isExecutor(first)
		? (third as TaskCreateMetadataInput)
		: (first as TaskCreateMetadataInput);
	const fieldErrors: TaskCreateFieldErrors = {};
	const metadata: NormalizedTaskCreateMetadata = {};

	await applyStatusMetadata(body, workspaceId, dbExec, fieldErrors, metadata);
	await applyPriorityMetadata(body, workspaceId, dbExec, fieldErrors, metadata);
	await applyLabelMetadata(body, workspaceId, dbExec, fieldErrors, metadata);
	await applyAssigneeMetadata(body, workspaceId, dbExec, fieldErrors, metadata);
	await applyProjectPhaseMetadata(
		body,
		workspaceId,
		dbExec,
		fieldErrors,
		metadata,
	);

	const valid = Object.keys(fieldErrors).length === 0;
	return {
		valid,
		...(valid ? {} : { error: "Some task fields are invalid" }),
		fieldErrors,
		metadata,
		mutationPerformed: false,
	};
}
