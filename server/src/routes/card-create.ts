import type { Request, Response } from "express";
import { sql } from "kysely";
import type { AuthUser } from "../auth.js";
import { allocateCardIdentity } from "../core/allocate-card-identity.js";
import { POSITION_GAP } from "../core/position.js";
import { checkWipLimit } from "../core/wip.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";
import { publishEvent } from "../realtime.js";
import {
	validateCardDescription,
	validateCardTitle,
	validateDueDate,
} from "../validators/input-length.js";
import { addCardAssignee } from "./card-assignees.js";
import { hydrateCardResponses } from "./card-response.js";
import { selectFullCard } from "./cards.js";
import { recordActivity } from "./helpers.js";
import {
	type NormalizedTaskCreateMetadata,
	validateTaskCreateMetadata,
} from "./work-item-create-metadata.js";
import { lockTaskCreateReferences } from "./workspace-mutation-lock.js";

type CreateBody = Record<string, unknown>;
type Column = {
	id: number;
	wip_limit: number | null;
	is_signable: boolean;
	signable_assignee_id: number | null;
};
type HydratedCard = Awaited<ReturnType<typeof hydrateCardResponses>>[number];
type CreateResult =
	| { kind: "not_found_column" }
	| { kind: "wip" }
	| { kind: "bad_request"; fieldErrors: Record<string, string> }
	| { kind: "ok"; card: HydratedCard; assignmentIds: number[] };
type PreparedCreate =
	| { kind: "not_found_column" }
	| { kind: "wip" }
	| { kind: "bad_request"; fieldErrors: Record<string, string> }
	| {
			kind: "ready";
			column: Column;
			metadata: NormalizedTaskCreateMetadata;
			dueDate: string | null;
	  };

type CreateInput = {
	workspaceId: number;
	columnId: number;
	body: CreateBody;
	actor: AuthUser;
	title: string;
	description: string;
};

function integerIds(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.filter((id): id is number => Number.isInteger(id));
}

function metadataReferences(body: CreateBody) {
	const priorityId = Number.isInteger(body.priorityId)
		? [body.priorityId as number]
		: [];
	const statusId = Number.isInteger(body.statusId)
		? [body.statusId as number]
		: [];
	return {
		assigneeIds: integerIds(body.assigneeIds),
		userIds: integerIds(body.assigneeIds),
		vocabularyIds: [...statusId, ...priorityId, ...integerIds(body.labelIds)],
		statusId: statusId[0] ?? null,
		priorityId: priorityId[0] ?? null,
		labelIds: integerIds(body.labelIds),
		projectId: Number.isInteger(body.projectId)
			? (body.projectId as number)
			: null,
		phaseId: Number.isInteger(body.phaseId) ? (body.phaseId as number) : null,
	};
}

function parseCreateDueDate(body: CreateBody): {
	dueDate: string | null;
	error?: string;
} {
	if (
		!("dueDate" in body) ||
		body.dueDate === null ||
		body.dueDate === undefined
	) {
		return { dueDate: null };
	}
	const parsed = validateDueDate(body.dueDate as string);
	return parsed.valid
		? { dueDate: parsed.trimmed as string }
		: { dueDate: null, error: parsed.error ?? "invalid due date" };
}

async function prepareCreate(
	trx: DBExecutor,
	input: CreateInput,
): Promise<PreparedCreate> {
	await lockTaskCreateReferences(trx, input.workspaceId, {
		...metadataReferences(input.body),
		actorId: input.actor.id,
		destinationColumnId: input.columnId,
	});
	const column = await trx
		.selectFrom("columns")
		.select(["id", "wip_limit", "is_signable", "signable_assignee_id"])
		.where("id", "=", input.columnId)
		.where("workspace_id", "=", input.workspaceId)
		.forUpdate()
		.executeTakeFirst();
	if (!column) return { kind: "not_found_column" };

	const fieldErrors: Record<string, string> = {};
	await validateSignableAssignee(trx, input.workspaceId, column, fieldErrors);
	const metadata = await validateTaskCreateMetadata(
		trx,
		input.workspaceId,
		input.body,
	);
	Object.assign(fieldErrors, metadata.fieldErrors);
	const dueDate = parseCreateDueDate(input.body);
	if (dueDate.error) fieldErrors.dueDate = dueDate.error;
	if (Object.keys(fieldErrors).length > 0 || !metadata.valid) {
		return { kind: "bad_request", fieldErrors };
	}

	const countRow = await trx
		.selectFrom("cards")
		.select(sql<number>`count(*)::int`.as("n"))
		.where("column_id", "=", input.columnId)
		.where("workspace_id", "=", input.workspaceId)
		.where("deleted_at", "is", null)
		.executeTakeFirstOrThrow();
	const wip = checkWipLimit({
		currentCount: countRow.n,
		wipLimit: column.wip_limit,
		isSameColumn: false,
	});
	if (!wip.allowed) return { kind: "wip" };
	return {
		kind: "ready",
		column,
		metadata: metadata.metadata,
		dueDate: dueDate.dueDate,
	};
}

async function validateSignableAssignee(
	trx: DBExecutor,
	workspaceId: number,
	column: Column,
	fieldErrors: Record<string, string>,
): Promise<void> {
	if (!column.is_signable || column.signable_assignee_id == null) return;
	const member = await trx
		.selectFrom("workspace_members")
		.select("user_id")
		.where("workspace_id", "=", workspaceId)
		.where("user_id", "=", column.signable_assignee_id)
		.executeTakeFirst();
	if (!member) {
		fieldErrors.columnId =
			"column signable assignee must be a member of this workspace";
	}
}

async function insertCardRelations(
	trx: DBExecutor,
	cardId: number,
	column: Column,
	metadata: NormalizedTaskCreateMetadata,
): Promise<number[]> {
	const assignmentIds = [
		...new Set([
			...(column.is_signable && column.signable_assignee_id != null
				? [column.signable_assignee_id]
				: []),
			...(metadata.assigneeIds ?? []),
		]),
	];
	for (const assigneeId of assignmentIds) {
		await addCardAssignee(trx, cardId, assigneeId);
	}
	for (const labelId of metadata.labelIds ?? []) {
		await trx
			.insertInto("card_labels")
			.values({ card_id: cardId, vocabulary_id: labelId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
	return assignmentIds;
}

async function hydrateCreatedCard(
	trx: DBExecutor,
	cardId: number,
	workspaceId: number,
): Promise<HydratedCard> {
	const row = await selectFullCard(trx)
		.where("c.id", "=", cardId)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.executeTakeFirstOrThrow();
	const [card] = await hydrateCardResponses(trx, [row]);
	if (!card) throw new Error("created card could not be hydrated");
	return card;
}

async function persistCreatedCard(
	trx: DBExecutor,
	input: CreateInput,
	prepared: Extract<PreparedCreate, { kind: "ready" }>,
): Promise<Extract<CreateResult, { kind: "ok" }>> {
	const identity = await allocateCardIdentity(trx, {
		workspaceId: input.workspaceId,
		columnId: input.columnId,
	});
	const inserted = await trx
		.insertInto("cards")
		.values({
			column_id: input.columnId,
			title: input.title,
			description: input.description,
			due_date: prepared.dueDate,
			priority_id: prepared.metadata.priorityId ?? null,
			project_id: prepared.metadata.projectId ?? null,
			phase_id: prepared.metadata.phaseId ?? null,
			position: sql<number>`COALESCE((SELECT MAX(position) FROM cards WHERE column_id = ${input.columnId} AND workspace_id = ${input.workspaceId} AND deleted_at IS NULL), 0) + ${POSITION_GAP}`,
			workspace_id: input.workspaceId,
			key_number: identity.keyNumber,
			status_id: identity.statusId,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	const assignmentIds = await insertCardRelations(
		trx,
		inserted.id,
		prepared.column,
		prepared.metadata,
	);
	await recordActivity(trx, input.actor, input.workspaceId, "create", {
		cardId: inserted.id,
		toColumnId: input.columnId,
		payload: {
			cardTitle: input.title,
			...(prepared.dueDate === null ? {} : { dueDate: prepared.dueDate }),
		},
	});
	const card = await hydrateCreatedCard(trx, inserted.id, input.workspaceId);
	return { kind: "ok", card, assignmentIds };
}

function publisherError(kind: string, error: unknown): void {
	console.error(`Failed to publish card ${kind} event:`, error);
}

async function publishCreatedCard(
	workspaceId: number,
	actor: AuthUser,
	card: { id: number; key: string | null },
): Promise<void> {
	try {
		await publishEvent(workspaceId, {
			type: "card.created",
			actor,
			cardId: card.id,
			payload: card.key == null ? {} : { key: card.key },
		});
	} catch (error) {
		publisherError("workspace", error);
	}
}

function publishAssignment(
	workspaceId: number,
	actor: AuthUser,
	card: { id: number; title: string },
	assigneeId: number,
): void {
	try {
		domainBus.emit(EVENTS.CARD_ASSIGNED, {
			type: EVENTS.CARD_ASSIGNED,
			workspaceId,
			actorId: actor.id,
			payload: {
				cardId: card.id,
				assigneeId,
				cardTitle: card.title,
				actorDisplayName: actor.displayName,
			},
		});
	} catch (error) {
		publisherError("assignment", error);
	}
}

export async function createCard(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const body = (req.body ?? {}) as CreateBody;
	const { columnId } = body;
	if (body.statusId !== undefined) {
		return res
			.status(400)
			.json({ error: "statusId is not accepted for card creation" });
	}
	if (!Number.isInteger(columnId)) {
		return res.status(400).json({ error: "columnId must be an integer" });
	}
	const title = validateCardTitle((body.title ?? "") as string);
	const description = validateCardDescription(
		(body.description ?? "") as string,
	);
	if (!title.valid) return res.status(400).json({ error: title.error });
	if (!description.valid)
		return res.status(400).json({ error: description.error });

	const input: CreateInput = {
		workspaceId,
		columnId: columnId as number,
		body,
		actor: req.user!,
		title: title.trimmed as string,
		description: description.trimmed ?? "",
	};
	const result: CreateResult = await db.transaction().execute(async (trx) => {
		const prepared = await prepareCreate(trx, input);
		if (prepared.kind !== "ready") return prepared;
		return persistCreatedCard(trx, input, prepared);
	});
	if (result.kind === "not_found_column") {
		return res.status(404).json({ error: "column not found" });
	}
	if (result.kind === "wip") {
		return res.status(409).json({ error: "WIP limit reached for this column" });
	}
	if (result.kind === "bad_request") {
		return res.status(400).json({
			error: "Some card fields are invalid",
			fieldErrors: result.fieldErrors,
		});
	}

	await publishCreatedCard(workspaceId, input.actor, result.card);
	for (const assigneeId of result.assignmentIds) {
		publishAssignment(workspaceId, input.actor, result.card, assigneeId);
	}
	return res.status(201).json(result.card);
}
