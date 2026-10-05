import type { Request, Response } from "express";
import { applyBoardCardStatusChange } from "../../core/board-card-status-change.js";
import { formatKey } from "../../core/tracker-key.js";
import { db } from "../../db/kysely.js";
import { domainBus, EVENTS } from "../../events.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { resolveWorkItemByKey } from "./tracker-item-route-helpers.js";
import { statusIdField } from "./tracker-schemas.js";

type BoardCardUpdateContext = {
	boardCard: { id: number };
	body: Record<string, unknown>;
	version: number | undefined;
	prefix: string;
	keyNumber: number;
};

/** Tracker-route PATCH of a board-native item: only status changes are allowed. */
export async function updateBoardCardViaTracker(
	req: Request,
	res: Response,
	{ boardCard, body, version, prefix, keyNumber }: BoardCardUpdateContext,
) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const allowedKeys = new Set(["version", "statusId"]);
	const bodyKeys = Object.keys(body).filter((key) => body[key] !== undefined);
	const hasOnlyStatus =
		bodyKeys.length > 0 &&
		bodyKeys.every((key) => allowedKeys.has(key)) &&
		body.statusId !== undefined;
	if (!hasOnlyStatus) {
		return res.status(409).json({
			error: "Board items must be updated via the card API.",
			code: "board_item_use_card_api",
		});
	}
	const parsedStatusId = parseWith(statusIdField, body.statusId);
	if (!parsedStatusId.ok) return sendValidationError(res, parsedStatusId.body);

	const result = await db.transaction().execute(async (trx) =>
		applyBoardCardStatusChange(trx, {
			workspaceId,
			actor,
			cardId: boardCard.id,
			targetStatusId: parsedStatusId.data,
			version: version as number | undefined,
		}),
	);

	if (result.kind === "not_found") {
		return res.status(404).json({ error: "Not found" });
	}
	if (result.kind === "conflict") {
		return res.status(409).json({
			error: "Someone else updated this item first.",
			code: "version_conflict",
		});
	}
	if (result.kind === "invalid_status") {
		return sendValidationError(res, { error: "invalid status" });
	}
	if (result.kind === "unmappable") {
		return res.status(409).json({
			error: "This status cannot be mapped to the current board columns.",
			code: "status_column_unmappable",
		});
	}
	if (result.kind === "wip") {
		return res.status(409).json({
			error: "WIP limit reached for this column",
			reason: result.reason,
		});
	}

	const key = formatKey(prefix, keyNumber);
	await publishEvent(workspaceId, {
		type: result.moved ? "card.moved" : "card.updated",
		actor,
		cardId: boardCard.id,
		payload: { key },
	});

	if (result.addedSignableAssignee != null) {
		domainBus.emit(EVENTS.CARD_ASSIGNED, {
			type: EVENTS.CARD_ASSIGNED,
			workspaceId,
			actorId: actor.id,
			payload: {
				cardId: boardCard.id,
				assigneeId: result.addedSignableAssignee,
				cardTitle: result.cardTitle,
				actorDisplayName: actor.displayName,
			},
		});
	}

	const item = await resolveWorkItemByKey(db, workspaceId, keyNumber, prefix);
	if (!item) return res.status(404).json({ error: "Not found" });
	return res.json(item);
}
