import type { Request, Response } from "express";
import { formatKey, parseKeyFromUrl } from "../../core/tracker-key.js";
import { db } from "../../db/kysely.js";
import { findBoardCardByKeyNumber } from "../../lib/work-item-response.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import {
	findColumnlessItem,
	loadMutationResponse,
} from "./tracker-item-merged-queries.js";
import { reorderInTransaction } from "./tracker-item-reorder-write.js";
import { workspacePrefix } from "./tracker-item-route-helpers.js";
import { parseTrackerKey, reorderNeighborKeys } from "./tracker-schemas.js";

function resolveNeighborKeyNumber(key: string, prefix: string): number | null {
	const parsed = parseKeyFromUrl(key);
	if (!parsed || parsed.prefix !== prefix) return null;
	return parsed.keyNumber;
}

export async function reorderTrackerItemHandler(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const key = parseTrackerKey(req.params.key);
	if (!key.ok) return sendValidationError(res, key.body);
	const parsed = key.data;

	const body = req.body ?? {};
	if ("projectId" in body || "phaseId" in body) {
		return sendValidationError(res, {
			error: "cross-bucket move not allowed on reorder",
		});
	}

	const neighbors = parseWith(reorderNeighborKeys, body);
	if (!neighbors.ok) return sendValidationError(res, neighbors.body);
	const { beforeKey, afterKey } = neighbors.data;

	const prefix = await workspacePrefix(db, workspaceId);
	if (!prefix) return res.status(404).json({ error: "Not found" });

	const existing = await findColumnlessItem(db, workspaceId, parsed.keyNumber);
	if (!existing) {
		const boardCard = await findBoardCardByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
		if (boardCard) {
			return res.status(409).json({
				error: "Board items cannot be reordered from Tracker.",
				code: "board_item_use_card_api",
			});
		}
		return res.status(404).json({ error: "Not found" });
	}

	const beforeKeyNumber =
		beforeKey === undefined
			? undefined
			: resolveNeighborKeyNumber(beforeKey, prefix);
	const afterKeyNumber =
		afterKey === undefined
			? undefined
			: resolveNeighborKeyNumber(afterKey, prefix);
	if (beforeKeyNumber === null || afterKeyNumber === null) {
		return sendValidationError(res, { error: "invalid neighbor key" });
	}

	const result = await db.transaction().execute((trx) =>
		reorderInTransaction(trx, {
			workspaceId,
			actor,
			cardId: existing.id,
			beforeKeyNumber,
			afterKeyNumber,
		}),
	);

	if (result.kind === "not_found") {
		return res.status(404).json({ error: "Not found" });
	}
	if (result.kind === "bad_neighbors") {
		return sendValidationError(res, { error: "neighbor not in bucket" });
	}
	if (result.kind === "non_adjacent_neighbors") {
		return sendValidationError(res, { error: "neighbors must be adjacent" });
	}

	const item = await loadMutationResponse(db, {
		workspaceId,
		keyNumber: parsed.keyNumber,
		prefix,
		canonical: Boolean(req.canonicalWorkItemsRoute),
		redirectFrom:
			parsed.prefix !== prefix
				? formatKey(parsed.prefix, parsed.keyNumber)
				: undefined,
	});
	if (!item) return res.status(404).json({ error: "Not found" });
	await publishEvent(workspaceId, {
		type: "tracker.updated",
		actor,
		trackerItemId: existing.id,
	});
	res.json(item);
}
