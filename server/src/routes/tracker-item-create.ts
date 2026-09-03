import type { Request, Response } from "express";
import type { AuthUser } from "../auth.js";
import { sql } from "kysely";
import { derivePrefix, formatKey } from "../core/tracker-key.js";
import { positionBetween } from "../core/position.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { publishEvent } from "../realtime.js";
import { lockTaskCreateReferences } from "./workspace-mutation-lock.js";
import {
	validateTaskCreateMetadata,
	type NormalizedTaskCreateMetadata,
	type TaskCreateFieldErrors,
} from "./work-item-create-metadata.js";
import { parseDateRange } from "./tracker-item-parsers.js";
import { syncTrackerItemAssignees } from "./tracker-assignees.js";
import { recordTrackerActivity } from "./tracker-activity.js";
import {
	findTrackerItemByKeyNumber,
	hydrateTrackerWorkItems,
} from "./work-item-response.js";

async function workspacePrefix(
	dbExec: DBExecutor,
	workspaceId: number,
): Promise<string | null> {
	const row = await dbExec
		.selectFrom("workspaces")
		.select("name")
		.where("id", "=", workspaceId)
		.executeTakeFirst();
	return row ? derivePrefix(row.name) : null;
}

async function backlogStatusId(
	dbExec: DBExecutor,
	workspaceId: number,
): Promise<number> {
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("id")
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.where(sql`lower(name)`, "=", "backlog")
		.executeTakeFirst();
	if (!row) throw new Error("Backlog status not found for workspace");
	return row.id;
}

async function statusCategory(
	dbExec: DBExecutor,
	workspaceId: number,
	statusId: number,
): Promise<string | null> {
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("category")
		.where("id", "=", statusId)
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.executeTakeFirst();
	return row?.category ?? null;
}

async function endOfBucketPosition(
	dbExec: DBExecutor,
	workspaceId: number,
	projectId: number | null,
	phaseId: number | null,
): Promise<number> {
	let query = dbExec
		.selectFrom("tracker_items")
		.select(sql<number | null>`max(position)`.as("max_position"))
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null);
	query =
		projectId === null
			? query.where("project_id", "is", null)
			: query.where("project_id", "=", projectId);
	query =
		phaseId === null
			? query.where("phase_id", "is", null)
			: query.where("phase_id", "=", phaseId);
	const row = await query.executeTakeFirst();
	return positionBetween(row?.max_position ?? null, null);
}

async function syncLabels(
	dbExec: DBExecutor,
	trackerItemId: number,
	labelIds: number[],
): Promise<void> {
	for (const vocabularyId of [...new Set(labelIds)]) {
		await dbExec
			.insertInto("tracker_item_labels")
			.values({ tracker_item_id: trackerItemId, vocabulary_id: vocabularyId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
}

function lockReferences(body: Record<string, unknown>, actorId: number) {
	const integerIds = (value: unknown): number[] =>
		Array.isArray(value)
			? value.filter((id): id is number => Number.isInteger(id))
			: [];
	return {
		actorId,
		assigneeIds: integerIds(body.assigneeIds),
		vocabularyIds: [body.statusId, body.priorityId, ...integerIds(body.labelIds)].filter(
			(id): id is number => Number.isInteger(id),
		),
		statusId: Number.isInteger(body.statusId) ? (body.statusId as number) : undefined,
		priorityId: Number.isInteger(body.priorityId)
			? (body.priorityId as number)
			: undefined,
		projectId: Number.isInteger(body.projectId) ? (body.projectId as number) : undefined,
		phaseId: Number.isInteger(body.phaseId) ? (body.phaseId as number) : undefined,
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

function legacyResponse(item: Record<string, unknown>, canonical: boolean) {
	if (canonical) return item;
	const { source: _source, ...legacy } = item;
	return legacy;
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
	const counter = await trx
		.updateTable("workspaces")
		.set({ tracker_key_counter: sql`tracker_key_counter + 1` })
		.where("id", "=", input.workspaceId)
		.returning("tracker_key_counter")
		.executeTakeFirstOrThrow();
	const values: Record<string, unknown> = {
		workspace_id: input.workspaceId,
		key_number: counter.tracker_key_counter,
		title: input.title,
		description: input.description,
		status_id: statusId,
		priority_id: metadata.priorityId ?? null,
		project_id: projectId,
		phase_id: phaseId,
		position,
	};
	if ("startDate" in input.body && !("error" in input.dates)) {
		values.start_date = parsedDateValue(input.dates, "startDate");
	}
	if ("endDate" in input.body && !("error" in input.dates)) {
		values.end_date = parsedDateValue(input.dates, "endDate");
	}
	if (category === "completed") values.completed_at = sql`now()`;
	const inserted = await trx
		.insertInto("tracker_items")
		.values(values as never)
		.returning("id")
		.executeTakeFirstOrThrow();
	return { id: inserted.id, keyNumber: counter.tracker_key_counter };
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
	await recordTrackerActivity(trx, input.actor, input.workspaceId, "tracker_item_created", {
		trackerItemId: created.id,
		payload: {
			title: input.title,
			key: formatKey(input.prefix, created.keyNumber),
		},
	});
	const row = await findTrackerItemByKeyNumber(
		trx,
		input.workspaceId,
		created.keyNumber,
	);
	if (!row) throw new Error("create failed");
	const [item] = await hydrateTrackerWorkItems(trx, [row], input.prefix);
	if ("startDate" in input.body) {
		item.startDate = parsedDateValue(input.dates, "startDate");
	}
	if ("endDate" in input.body) {
		item.endDate = parsedDateValue(input.dates, "endDate");
	}
	return item as Record<string, unknown>;
}

async function createInTransaction(input: CreateInput): Promise<CreatedResult | InvalidResult> {
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
	const title = typeof body.title === "string" ? body.title.trim() : "";
	if (!title) return res.status(400).json({ error: "title is required" });
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
		return res.status(400).json({
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
		console.error("Failed to publish tracker.created event:", error);
	}
	return res.status(201).json(
		legacyResponse(result.item, Boolean(req.canonicalWorkItemsRoute)),
	);
}
