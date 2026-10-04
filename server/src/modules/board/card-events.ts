import type { AuthUser } from "../../auth.js";
import { derivePrefix, formatKey } from "../../core/tracker-key.js";
import { db } from "../../db/kysely.js";
import { domainBus, EVENTS } from "../../events.js";
import { publishEvent } from "../../realtime.js";

async function cardEventPayload(
	cardId: number,
	workspaceId: number,
): Promise<Record<string, unknown>> {
	const row = await db
		.selectFrom("cards as c")
		.innerJoin("workspaces as w", "w.id", "c.workspace_id")
		.select(["c.key_number", "w.name as workspace_name"])
		.where("c.id", "=", cardId)
		.where("c.workspace_id", "=", workspaceId)
		.executeTakeFirst();
	if (row?.key_number == null || row.workspace_name == null) return {};
	return {
		key: formatKey(derivePrefix(row.workspace_name), row.key_number),
	};
}

export async function publishCardWorkspaceEvent(
	workspaceId: number,
	event: {
		type:
			| "card.created"
			| "card.updated"
			| "card.moved"
			| "card.reordered"
			| "card.deleted";
		actor: AuthUser;
		cardId: number;
	},
) {
	await publishEvent(workspaceId, {
		...event,
		payload: await cardEventPayload(event.cardId, workspaceId),
	});
}

export function emitCardAssigned(
	workspaceId: number,
	actorId: number,
	cardId: number,
	cardTitle: string,
	actorDisplayName: string,
	assigneeId: number,
) {
	domainBus.emit(EVENTS.CARD_ASSIGNED, {
		type: EVENTS.CARD_ASSIGNED,
		workspaceId,
		actorId,
		payload: { cardId, assigneeId, cardTitle, actorDisplayName },
	});
}

export function emitDueDateChange(
	workspaceId: number,
	actorId: number,
	cardId: number,
	cardTitle: string,
	actorDisplayName: string,
	assigneeIds: number[],
	oldDueDate: string | null,
	newDueDate: string | null,
) {
	for (const assigneeId of assigneeIds) {
		if (newDueDate != null) {
			domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
				type: EVENTS.CARD_DUE_DATE_CHANGED,
				workspaceId,
				actorId,
				payload: {
					cardId,
					assigneeId,
					cardTitle,
					actorDisplayName,
					oldDueDate,
					newDueDate,
				},
			});
		} else {
			domainBus.emit(EVENTS.CARD_DUE_DATE_REMOVED, {
				type: EVENTS.CARD_DUE_DATE_REMOVED,
				workspaceId,
				actorId,
				payload: {
					cardId,
					assigneeId,
					cardTitle,
					actorDisplayName,
					oldDueDate,
				},
			});
		}
	}
}
