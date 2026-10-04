import { sql } from "kysely";
import { allocateCardIdentity } from "../../core/allocate-card-identity.js";
import { POSITION_GAP } from "../../core/position.js";
import type { DBExecutor } from "../../db/kysely.js";
import type { getAttachmentStorage } from "../../lib/attachment-storage.js";
import { addCardAssignee } from "../../lib/card-assignees.js";
import { hydrateCardResponses } from "../../lib/card-response.js";
import { recordActivity } from "../../lib/helpers.js";
import type { NormalizedTaskCreateMetadata } from "../../lib/work-item-create-metadata.js";
import type {
	Column,
	CreatedAttachmentRow,
	CreateInput,
	CreateResult,
	HydratedCard,
	PreparedAttachment,
	PreparedCreate,
	WrittenAttachment,
} from "./card-create-types.js";
import { selectFullCard } from "./cards.js";

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

export async function persistCreatedCard(
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

export async function writeUploadedAttachments(
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

export async function removeWrittenAttachments(
	storage: ReturnType<typeof getAttachmentStorage>,
	attachments: WrittenAttachment[],
): Promise<void> {
	await storage.removePairs(attachments.map(({ pair }) => pair));
}
