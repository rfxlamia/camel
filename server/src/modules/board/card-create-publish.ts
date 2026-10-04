import type { AuthUser } from "../../auth.js";
import { domainBus, EVENTS } from "../../events.js";
import { logger } from "../../lib/logger.js";
import { publishEvent } from "../../realtime.js";
import type { CreateResult } from "./card-create-types.js";

function publisherError(kind: string, error: unknown): void {
	logger.error({ err: error }, `Failed to publish card ${kind} event`);
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

export async function publishCreatedResult(
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
