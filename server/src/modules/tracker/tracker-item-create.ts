import type { Request, Response } from "express";
import { sql } from "kysely";
import type { AuthUser } from "../../auth.js";
import { allocateWorkItemKey } from "../../core/allocate-work-item-key.js";
import { formatKey } from "../../core/tracker-key.js";
import { type DBExecutor, db } from "../../db/kysely.js";
import { logger } from "../../lib/logger.js";
import { syncTrackerItemAssignees } from "../../lib/tracker-assignees.js";
import { recordTrackerItemActivity } from "../../lib/tracker-item-activity.js";
import { parseDateRange } from "../../lib/tracker-item-parsers.js";
import {
	type NormalizedTaskCreateMetadata,
	type TaskCreateFieldErrors,
	validateTaskCreateMetadata,
} from "../../lib/work-item-create-metadata.js";
import { legacyTrackerItemResponse } from "../../lib/work-item-response.js";
import { lockTaskCreateReferences } from "../../lib/workspace-mutation-lock.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import {
	backlogStatusId,
	endOfBucketPosition,
	statusCategory,
	syncLabels,
	workspacePrefix,
} from "./tracker-item-create-queries.js";
import { resolveWorkItemByKey } from "./tracker-item-route-helpers.js";
import { titleField } from "./tracker-schemas.js";

function lockReferences(body: Record<string, unknown>, actorId: number) {
	const integerIds = (value: unknown): number[] =>
		Array.isArray(value)
			? value.filter((id): id is number => Number.isInteger(id))
			: [];
	return {
		actorId,
		assigneeIds: integerIds(body.assigneeIds),
		vocabularyIds: [
			body.statusId,
			body.priorityId,
			...integerIds(body.labelIds),
		].filter((id): id is number => Number.isInteger(id)),
		statusId: Number.isInteger(body.statusId)
			? (body.statusId as number)
			: undefined,
		priorityId: Number.isInteger(body.priorityId)
			? (body.priorityId as number)
			: undefined,
		projectId: Number.isInteger(body.projectId)
			? (body.projectId as number)
			: undefined,
		phaseId: Number.isInteger(body.phaseId)
			? (body.phaseId as number)
			: undefined,
	};
}

function mergeDateErrors(
	fieldErrors: TaskCreateFieldErrors & Record<string, string>,
	parsed: ReturnType<typeof parseDateRange>,
	body: Record<string, unknown>,
): void {
	if (!("error" in parsed)) return;
	const dateErrors = parsed.fieldErrors ?? {};
	for (const field of ["startDate", "endDate"] as const) {
		if (field in body) {
			fieldErrors[field] = dateErrors[field] ?? parsed.error;
		}
	}
}

function parsedDateValue(
	result: ReturnType<typeof parseDateRange>,
	field: "startDate" | "endDate",
): string | null {
	return "error" in result ? null : result[field];
}

type CreateInput = {
	workspaceId: number;
	actor: AuthUser;
	body: Record<string, unknown>;
	title: string;
	description: string;
	prefix: string;
	dates: ReturnType<typeof parseDateRange>;
};

type CreatedResult = {
	kind: "created";
	id: number;
	item: Record<string, unknown>;
};

type InvalidResult = {
	kind: "invalid";
	fieldErrors: TaskCreateFieldErrors & Record<string, string>;
};

async function validateCreate(
	trx: DBExecutor,
	input: CreateInput,
): Promise<NormalizedTaskCreateMetadata | InvalidResult> {
	await lockTaskCreateReferences(
		trx,
		input.workspaceId,
		lockReferences(input.body, input.actor.id),
	);
	const validation = await validateTaskCreateMetadata(
		trx,
		input.workspaceId,
		input.body,
	);
	const fieldErrors = {
		...validation.fieldErrors,
	} as TaskCreateFieldErrors & Record<string, string>;
	mergeDateErrors(fieldErrors, input.dates, input.body);
	if (Object.keys(fieldErrors).length > 0) {
		return { kind: "invalid", fieldErrors };
	}
	return validation.metadata;
}

async function insertTrackerItem(
	trx: DBExecutor,
	input: CreateInput,
	metadata: NormalizedTaskCreateMetadata,
): Promise<{ id: number; keyNumber: number }> {
	const statusId =
		metadata.statusId ?? (await backlogStatusId(trx, input.workspaceId));
	const projectId = metadata.projectId ?? null;
	const phaseId = metadata.phaseId ?? null;
	const position = await endOfBucketPosition(
		trx,
		input.workspaceId,
		projectId,
		phaseId,
	);
	const category = await statusCategory(trx, input.workspaceId, statusId);
	const { keyNumber } = await allocateWorkItemKey(trx, {
		workspaceId: input.workspaceId,
	});
	const values: Record<string, unknown> = {
		workspace_id: input.workspaceId,
		key_number: keyNumber,
		title: input.title,
		description: input.description,
		status_id: statusId,
		priority_id: metadata.priorityId ?? null,
		project_id: projectId,
		phase_id: phaseId,
		// Board position is a never-read placeholder for column-less rows.
		position: 0,
		plan_position: position,
		updated_at: sql`now()`,
	};
	if ("startDate" in input.body && !("error" in input.dates)) {
		values.start_date = parsedDateValue(input.dates, "startDate");
	}
	if ("endDate" in input.body && !("error" in input.dates)) {
		values.end_date = parsedDateValue(input.dates, "endDate");
	}
	if (category === "completed") values.completed_at = sql`now()`;
	const inserted = await trx
		.insertInto("cards")
		.values(values as never)
		.returning("id")
		.executeTakeFirstOrThrow();
	return { id: inserted.id, keyNumber };
}

async function hydrateCreatedItem(
	trx: DBExecutor,
	input: CreateInput,
	metadata: NormalizedTaskCreateMetadata,
	created: { id: number; keyNumber: number },
): Promise<Record<string, unknown>> {
	if ((metadata.assigneeIds ?? []).length > 0) {
		await syncTrackerItemAssignees(trx, created.id, metadata.assigneeIds!);
	}
	if ((metadata.labelIds ?? []).length > 0) {
		await syncLabels(trx, created.id, metadata.labelIds!);
	}
	await recordTrackerItemActivity(
		trx,
		input.actor,
		input.workspaceId,
		"tracker_item_created",
		{
			cardId: created.id,
			payload: {
				title: input.title,
				key: formatKey(input.prefix, created.keyNumber),
			},
		},
	);
	const item = await resolveWorkItemByKey(
		trx,
		input.workspaceId,
		created.keyNumber,
		input.prefix,
	);
	if (!item) throw new Error("create failed");
	if ("startDate" in input.body) {
		item.startDate = parsedDateValue(input.dates, "startDate");
	}
	if ("endDate" in input.body) {
		item.endDate = parsedDateValue(input.dates, "endDate");
	}
	return item as Record<string, unknown>;
}

async function createInTransaction(
	input: CreateInput,
): Promise<CreatedResult | InvalidResult> {
	return db.transaction().execute(async (trx) => {
		const metadata = await validateCreate(trx, input);
		if ("kind" in metadata) return metadata;
		const created = await insertTrackerItem(trx, input, metadata);
		const item = await hydrateCreatedItem(trx, input, metadata, created);
		return { kind: "created", id: created.id, item };
	});
}

export async function createTrackerItemHandler(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const body = (req.body ?? {}) as Record<string, unknown>;
	const parsedTitle = parseWith(titleField, body.title);
	if (!parsedTitle.ok) return sendValidationError(res, parsedTitle.body);
	const title = parsedTitle.data;
	const prefix = await workspacePrefix(db, workspaceId);
	if (!prefix) return res.status(404).json({ error: "Not found" });
	const dates =
		"startDate" in body || "endDate" in body
			? parseDateRange(body)
			: { startDate: null, endDate: null };
	const input: CreateInput = {
		workspaceId,
		actor,
		body,
		title,
		description: typeof body.description === "string" ? body.description : "",
		prefix,
		dates,
	};
	const result = await createInTransaction(input);
	if (result.kind === "invalid") {
		return sendValidationError(res, {
			error: "Some task fields are invalid",
			fieldErrors: result.fieldErrors,
		});
	}
	try {
		await publishEvent(workspaceId, {
			type: "tracker.created",
			actor,
			trackerItemId: result.id,
		});
	} catch (error) {
		logger.error({ err: error }, "Failed to publish tracker.created event");
	}
	return res
		.status(201)
		.json(
			legacyTrackerItemResponse(
				result.item,
				Boolean(req.canonicalWorkItemsRoute),
			),
		);
}
