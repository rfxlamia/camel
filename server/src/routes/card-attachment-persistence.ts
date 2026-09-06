import { sql } from "kysely";
import type { AuthUser } from "../auth.js";
import { type DBExecutor, db } from "../db/kysely.js";
import {
	type AttachmentPair,
	getAttachmentStorage,
} from "../lib/attachment-storage.js";
import { recordActivity } from "./helpers.js";

type UploadedFile = Express.Multer.File;
export type PreparedAttachment = {
	thumbnail: UploadedFile;
	original: UploadedFile;
	mimeType: string;
};
export type WrittenAttachment = {
	pair: AttachmentPair;
};
export type StoredAttachment = {
	id: number;
	mimeType: string;
	createdAt: string;
};

export const EXISTING_CARD_ATTACHMENT_LIMIT = 3;
export const EXISTING_CARD_ATTACHMENT_CAPACITY_MESSAGE =
	"Max 3 images per card";

type ExistingCardAttachmentCapacityHook = (input: {
	cardId: number;
	existingCount: number;
	availableSlots: number;
	requestedCount: number;
}) => void | Promise<void>;

let existingCardAttachmentCapacityHook:
	| ExistingCardAttachmentCapacityHook
	| undefined;

/** Narrow synchronization seam used by the PostgreSQL contention integration test. */
export function setExistingCardAttachmentCapacityHookForTests(
	hook: ExistingCardAttachmentCapacityHook | null,
): void {
	existingCardAttachmentCapacityHook = hook ?? undefined;
}

export const setAttachmentCapacityHookForTests =
	setExistingCardAttachmentCapacityHookForTests;

async function removeWrittenExistingAttachments(
	storage: ReturnType<typeof getAttachmentStorage>,
	attachments: WrittenAttachment[],
): Promise<void> {
	await storage.removePairs(attachments.map(({ pair }) => pair));
}

function toIso(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

type LockedCard = { id: number; column_id: number };

async function lockExistingCard(
	trx: DBExecutor,
	workspaceId: number,
	cardId: number,
): Promise<LockedCard> {
	const card = await trx
		.selectFrom("cards")
		.select(["id", "column_id"])
		.where("id", "=", cardId)
		.where("workspace_id", "=", workspaceId)
		.where("deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
	if (!card) throw Object.assign(new Error("Not found"), { statusCode: 404 });
	return card;
}

async function availableAttachmentSlots(
	trx: DBExecutor,
	cardId: number,
	requestedCount: number,
): Promise<{ existingCount: number; availableSlots: number }> {
	const countRow = await trx
		.selectFrom("attachments")
		.select(sql<number>`count(*)::int`.as("count"))
		.where("card_id", "=", cardId)
		.executeTakeFirstOrThrow();
	const existingCount = countRow.count;
	const availableSlots = Math.max(
		0,
		EXISTING_CARD_ATTACHMENT_LIMIT - existingCount,
	);
	await existingCardAttachmentCapacityHook?.({
		cardId,
		existingCount,
		availableSlots,
		requestedCount,
	});
	return { existingCount, availableSlots };
}

function throwIfAtCapacity(availableSlots: number): void {
	if (availableSlots === 0) {
		throw Object.assign(new Error(EXISTING_CARD_ATTACHMENT_CAPACITY_MESSAGE), {
			statusCode: 409,
			capacity: true,
		});
	}
}

async function persistOneExistingAttachment(
	trx: DBExecutor,
	input: {
		workspaceId: number;
		card: LockedCard;
		actor: AuthUser;
		attachment: PreparedAttachment;
		storage: ReturnType<typeof getAttachmentStorage>;
		written: WrittenAttachment[];
	},
): Promise<StoredAttachment> {
	const { attachment, card, storage } = input;
	const pair = await storage.writePair({
		thumbnail: attachment.thumbnail.buffer,
		original: attachment.original.buffer,
	});
	input.written.push({ pair });
	const row = await trx
		.insertInto("attachments")
		.values({
			card_id: card.id,
			mime_type: attachment.mimeType,
			thumbnail_path: pair.thumbnailPath,
			original_path: pair.originalPath,
			thumbnail_size_bytes: attachment.thumbnail.size,
			original_size_bytes: attachment.original.size,
		})
		.returning(["id", "mime_type", "created_at"])
		.executeTakeFirstOrThrow();
	const createdAt = toIso(row.created_at);
	await recordActivity(
		trx,
		input.actor,
		input.workspaceId,
		"attachment_added",
		{
			cardId: card.id,
			toColumnId: card.column_id,
			payload: { attachmentId: row.id, mimeType: row.mime_type, createdAt },
		},
	);
	return { id: row.id, mimeType: row.mime_type, createdAt };
}

async function persistAcceptedExistingAttachments(
	trx: DBExecutor,
	input: {
		workspaceId: number;
		card: LockedCard;
		actor: AuthUser;
		attachments: PreparedAttachment[];
		availableSlots: number;
		storage: ReturnType<typeof getAttachmentStorage>;
		written: WrittenAttachment[];
	},
): Promise<StoredAttachment[]> {
	const accepted: StoredAttachment[] = [];
	for (const attachment of input.attachments.slice(0, input.availableSlots)) {
		accepted.push(
			await persistOneExistingAttachment(trx, { ...input, attachment }),
		);
	}
	return accepted;
}

async function persistExistingCardAttachments(
	trx: DBExecutor,
	input: {
		workspaceId: number;
		cardId: number;
		actor: AuthUser;
		attachments: PreparedAttachment[];
		storage: ReturnType<typeof getAttachmentStorage>;
		written: WrittenAttachment[];
	},
): Promise<{ accepted: StoredAttachment[]; existingCount: number }> {
	const card = await lockExistingCard(trx, input.workspaceId, input.cardId);
	const capacity = await availableAttachmentSlots(
		trx,
		card.id,
		input.attachments.length,
	);
	throwIfAtCapacity(capacity.availableSlots);
	const accepted = await persistAcceptedExistingAttachments(trx, {
		...input,
		card,
		availableSlots: capacity.availableSlots,
	});
	return { accepted, existingCount: capacity.existingCount };
}

export async function runExistingCardUploadTransaction(input: {
	workspaceId: number;
	cardId: number;
	actor: AuthUser;
	attachments: PreparedAttachment[];
	storage: ReturnType<typeof getAttachmentStorage>;
	written: WrittenAttachment[];
}): Promise<{ accepted: StoredAttachment[]; existingCount: number }> {
	try {
		return await db
			.transaction()
			.execute((trx) => persistExistingCardAttachments(trx, input));
	} catch (error) {
		await removeWrittenExistingAttachments(input.storage, input.written);
		throw error;
	}
}
