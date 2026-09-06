import type { DBExecutor } from "../db/kysely.js";

export interface AttachmentResponseRow {
	id: number;
	card_id: number;
	mime_type: string;
	thumbnail_path: string;
	original_path: string;
	created_at: Date | string;
}

export interface CardAttachmentResponse {
	id: number;
	thumbnailUrl: string;
	originalUrl: string;
	downloadUrl: string;
	mimeType: string;
	createdAt: string;
}

export interface AttachmentResponseContext {
	workspaceId: number;
	cardId: number;
}

function toIso(value: Date | string): string {
	return typeof value === "string" ? value : value.toISOString();
}

function attachmentBasePath({
	workspaceId,
	cardId,
	attachmentId,
}: {
	workspaceId: number;
	cardId: number;
	attachmentId: number;
}): string {
	return `/api/workspaces/${workspaceId}/cards/${cardId}/attachments/${attachmentId}`;
}

export function mapAttachmentResponse(
	row: AttachmentResponseRow,
	context: AttachmentResponseContext,
): CardAttachmentResponse {
	const basePath = attachmentBasePath({
		workspaceId: context.workspaceId,
		cardId: context.cardId,
		attachmentId: row.id,
	});
	return {
		id: row.id,
		thumbnailUrl: `${basePath}/thumbnail`,
		originalUrl: `${basePath}/original`,
		downloadUrl: `${basePath}/original/download`,
		mimeType: row.mime_type,
		createdAt: toIso(row.created_at),
	};
}

export function mapAttachmentResponses(
	rows: AttachmentResponseRow[],
	context: AttachmentResponseContext,
): CardAttachmentResponse[] {
	return [...rows]
		.sort((a, b) => {
			const createdAt =
				new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
			return createdAt === 0 ? a.id - b.id : createdAt;
		})
		.map((row) => mapAttachmentResponse(row, context));
}

export async function loadCardAttachmentsForCards(
	dbExec: DBExecutor,
	workspaceId: number,
	cardIds: number[],
): Promise<Map<number, CardAttachmentResponse[]>> {
	const attachmentsByCard = new Map<number, CardAttachmentResponse[]>();
	if (cardIds.length === 0) return attachmentsByCard;

	const rows = await dbExec
		.selectFrom("attachments as a")
		.innerJoin("cards as c", "c.id", "a.card_id")
		.select([
			"a.id",
			"a.card_id",
			"a.mime_type",
			"a.thumbnail_path",
			"a.original_path",
			"a.created_at",
		])
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.where("a.card_id", "in", cardIds)
		.orderBy("a.card_id")
		.orderBy("a.created_at")
		.orderBy("a.id")
		.execute();

	for (const row of rows) {
		const attachments = attachmentsByCard.get(row.card_id) ?? [];
		attachments.push(
			mapAttachmentResponse(row, { workspaceId, cardId: row.card_id }),
		);
		attachmentsByCard.set(row.card_id, attachments);
	}
	return attachmentsByCard;
}

export const serializeAttachment = mapAttachmentResponse;
export const serializeAttachments = mapAttachmentResponses;
