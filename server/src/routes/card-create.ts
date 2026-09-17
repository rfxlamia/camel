import type { Request, Response } from "express";
import { sql } from "kysely";
import type { AuthUser } from "../auth.js";
import { allocateCardIdentity } from "../core/allocate-card-identity.js";
import { POSITION_GAP } from "../core/position.js";
import { checkWipLimit } from "../core/wip.js";
import { type DBExecutor, db } from "../db/kysely.js";
import { domainBus, EVENTS } from "../events.js";
import {
	type AttachmentPair,
	getAttachmentStorage,
} from "../lib/attachment-storage.js";
import { validateAttachmentPairs } from "../lib/attachment-validation.js";
import { publishEvent } from "../realtime.js";
import {
	validateCardDescription,
	validateCardTitle,
	validateDueDate,
} from "../validators/input-length.js";
import { addCardAssignee } from "./card-assignees.js";
import { hydrateCardResponses } from "./card-response.js";
import { selectFullCard } from "./cards.js";
import { recordActivity } from "../lib/helpers.js";
import {
	type NormalizedTaskCreateMetadata,
	validateTaskCreateMetadata,
} from "../lib/work-item-create-metadata.js";
import { lockTaskCreateReferences } from "../lib/workspace-mutation-lock.js";

type CreateBody = Record<string, unknown>;
type UploadedFile = Express.Multer.File;
type PreparedAttachment = {
	thumbnail: UploadedFile;
	original: UploadedFile;
	mimeType: string;
};
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
	| {
			kind: "ok";
			card: HydratedCard;
			assignmentIds: number[];
			attachments: Array<{ id: number; mimeType: string; createdAt: string }>;
	  };
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

type WrittenAttachment = {
	pair: AttachmentPair;
	mimeType: string;
	thumbnailSize: number;
	originalSize: number;
};

type CreatedAttachmentRow = {
	id: number;
	mime_type: string;
	created_at: Date;
};

async function insertCreatedCard(
	trx: DBExecutor,
	input: CreateInput,
	prepared: Extract<PreparedCreate, { kind: "ready" }>,
): Promise<number> {
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
	return inserted.id;
}

async function insertCreatedAttachments(
	trx: DBExecutor,
	cardId: number,
	attachments: WrittenAttachment[],
): Promise<CreatedAttachmentRow[]> {
	if (attachments.length === 0) return [];
	return trx
		.insertInto("attachments")
		.values(
			attachments.map(({ pair, mimeType, thumbnailSize, originalSize }) => ({
				card_id: cardId,
				mime_type: mimeType,
				thumbnail_path: pair.thumbnailPath,
				original_path: pair.originalPath,
				thumbnail_size_bytes: thumbnailSize,
				original_size_bytes: originalSize,
			})),
		)
		.returning(["id", "mime_type", "created_at"])
		.execute();
}

async function recordCreatedCardActivity(
	trx: DBExecutor,
	input: CreateInput,
	prepared: Extract<PreparedCreate, { kind: "ready" }>,
	cardId: number,
	attachments: CreatedAttachmentRow[],
): Promise<void> {
	await recordActivity(trx, input.actor, input.workspaceId, "create", {
		cardId,
		toColumnId: input.columnId,
		payload: {
			cardTitle: input.title,
			...(prepared.dueDate === null ? {} : { dueDate: prepared.dueDate }),
		},
	});
	for (const attachment of attachments) {
		await recordActivity(
			trx,
			input.actor,
			input.workspaceId,
			"attachment_added",
			{
				cardId,
				toColumnId: prepared.column.id,
				payload: {
					attachmentId: attachment.id,
					mimeType: attachment.mime_type,
					createdAt: attachment.created_at.toISOString(),
				},
			},
		);
	}
}

async function persistCreatedCard(
	trx: DBExecutor,
	input: CreateInput,
	prepared: Extract<PreparedCreate, { kind: "ready" }>,
	attachments: WrittenAttachment[],
): Promise<Extract<CreateResult, { kind: "ok" }>> {
	const cardId = await insertCreatedCard(trx, input, prepared);
	const assignmentIds = await insertCardRelations(
		trx,
		cardId,
		prepared.column,
		prepared.metadata,
	);
	const attachmentRows = await insertCreatedAttachments(
		trx,
		cardId,
		attachments,
	);
	await recordCreatedCardActivity(trx, input, prepared, cardId, attachmentRows);
	const card = await hydrateCreatedCard(trx, cardId, input.workspaceId);
	return {
		kind: "ok",
		card,
		assignmentIds,
		attachments: attachmentRows.map((attachment) => ({
			id: attachment.id,
			mimeType: attachment.mime_type,
			createdAt: attachment.created_at.toISOString(),
		})),
	};
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

async function publishCreatedAttachment(
	workspaceId: number,
	actor: AuthUser,
	cardId: number,
	attachment: { id: number; mimeType: string; createdAt: string },
): Promise<void> {
	try {
		await publishEvent(workspaceId, {
			type: "attachment.added",
			actor,
			cardId,
			payload: {
				attachmentId: attachment.id,
				mimeType: attachment.mimeType,
				createdAt: attachment.createdAt,
			},
		});
	} catch (error) {
		publisherError("attachment", error);
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

function parseRequestBody(req: Request): CreateBody {
	if (!req.is("multipart/form-data")) return (req.body ?? {}) as CreateBody;
	const metadata = (req.body as Record<string, unknown> | undefined)?.metadata;
	if (typeof metadata !== "string") {
		throw new Error("metadata must be a JSON object");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(metadata);
	} catch (error) {
		throw new Error("metadata must be a JSON object", { cause: error });
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("metadata must be a JSON object");
	}
	return parsed as CreateBody;
}

function uploadedAttachments(req: Request): {
	attachments?: PreparedAttachment[];
	error?: string;
} {
	if (!req.is("multipart/form-data")) return { attachments: [] };
	const files = (req.files ?? {}) as Record<string, UploadedFile[]>;
	const thumbnails = files.thumbnail ?? [];
	const originals = files.original ?? [];
	if (thumbnails.length !== originals.length) {
		return { error: "thumbnail and original attachment counts must match" };
	}
	return {
		attachments: thumbnails.map((thumbnail, index) => ({
			thumbnail,
			original: originals[index]!,
			mimeType: originals[index]!.mimetype,
		})),
	};
}

async function writeUploadedAttachments(
	storage: ReturnType<typeof getAttachmentStorage>,
	attachments: PreparedAttachment[],
): Promise<WrittenAttachment[]> {
	const written: WrittenAttachment[] = [];
	try {
		for (const attachment of attachments) {
			const pair = await storage.writePair({
				thumbnail: attachment.thumbnail.buffer,
				original: attachment.original.buffer,
			});
			written.push({
				pair,
				mimeType: attachment.mimeType,
				thumbnailSize: attachment.thumbnail.size,
				originalSize: attachment.original.size,
			});
		}
		return written;
	} catch (error) {
		await storage.removePairs(written.map(({ pair }) => pair));
		throw error;
	}
}

type PreparedRequest =
	| { kind: "bad_request"; error: string }
	| { kind: "ready"; input: CreateInput; attachments: PreparedAttachment[] };

async function prepareCreateRequest(
	req: Request,
	workspaceId: number,
): Promise<PreparedRequest> {
	let body: CreateBody;
	try {
		body = parseRequestBody(req);
	} catch (error) {
		return { kind: "bad_request", error: (error as Error).message };
	}
	const uploaded = uploadedAttachments(req);
	if (uploaded.error) return { kind: "bad_request", error: uploaded.error };
	const attachments = uploaded.attachments ?? [];
	const attachmentValidationError = await validateAttachmentPairs(attachments);
	if (attachmentValidationError) {
		return { kind: "bad_request", error: attachmentValidationError };
	}
	const { columnId } = body;
	if (body.statusId !== undefined) {
		return {
			kind: "bad_request",
			error: "statusId is not accepted for card creation",
		};
	}
	if (!Number.isInteger(columnId)) {
		return { kind: "bad_request", error: "columnId must be an integer" };
	}
	const title = validateCardTitle((body.title ?? "") as string);
	const description = validateCardDescription(
		(body.description ?? "") as string,
	);
	if (!title.valid) {
		return {
			kind: "bad_request",
			error: title.error ?? "invalid title",
		};
	}
	if (!description.valid) {
		return {
			kind: "bad_request",
			error: description.error ?? "invalid description",
		};
	}
	return {
		kind: "ready",
		input: {
			workspaceId,
			columnId: columnId as number,
			body,
			actor: req.user!,
			title: title.trimmed as string,
			description: description.trimmed ?? "",
		},
		attachments,
	};
}

async function removeWrittenAttachments(
	storage: ReturnType<typeof getAttachmentStorage>,
	attachments: WrittenAttachment[],
): Promise<void> {
	await storage.removePairs(attachments.map(({ pair }) => pair));
}

function respondToCreateFailure(
	res: Response,
	result: Exclude<CreateResult, { kind: "ok" }>,
): Response {
	if (result.kind === "not_found_column") {
		return res.status(404).json({ error: "column not found" });
	}
	if (result.kind === "wip") {
		return res.status(409).json({ error: "WIP limit reached for this column" });
	}
	return res.status(400).json({
		error: "Some card fields are invalid",
		fieldErrors: result.fieldErrors,
	});
}

async function publishCreatedResult(
	workspaceId: number,
	actor: AuthUser,
	result: Extract<CreateResult, { kind: "ok" }>,
): Promise<void> {
	await publishCreatedCard(workspaceId, actor, result.card);
	for (const attachment of result.attachments) {
		await publishCreatedAttachment(
			workspaceId,
			actor,
			result.card.id,
			attachment,
		);
	}
	for (const assigneeId of result.assignmentIds) {
		publishAssignment(workspaceId, actor, result.card, assigneeId);
	}
}

export async function createCard(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const preparedRequest = await prepareCreateRequest(req, workspaceId);
	if (preparedRequest.kind === "bad_request") {
		return res.status(400).json({ error: preparedRequest.error });
	}

	const { input, attachments } = preparedRequest;
	const attachmentStorage = getAttachmentStorage();
	let writtenAttachments: WrittenAttachment[];
	try {
		writtenAttachments = await writeUploadedAttachments(
			attachmentStorage,
			attachments,
		);
	} catch (error) {
		console.error("Failed to write card attachments", error);
		return res.status(500).json({ error: "Unable to store card attachments" });
	}

	let result: CreateResult;
	try {
		result = await db.transaction().execute(async (trx) => {
			const prepared = await prepareCreate(trx, input);
			if (prepared.kind !== "ready") return prepared;
			return persistCreatedCard(trx, input, prepared, writtenAttachments);
		});
	} catch (error) {
		await removeWrittenAttachments(attachmentStorage, writtenAttachments);
		console.error("Failed to create card with attachments", error);
		return res.status(500).json({ error: "Unable to create card" });
	}
	if (result.kind !== "ok") {
		await removeWrittenAttachments(attachmentStorage, writtenAttachments);
		return respondToCreateFailure(res, result);
	}

	await publishCreatedResult(workspaceId, input.actor, result);
	return res.status(201).json(result.card);
}
