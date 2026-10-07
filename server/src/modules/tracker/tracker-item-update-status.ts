import type { Request, Response } from "express";
import { applyTrackerItemStatusChange } from "../../core/tracker-item-status-change.js";
import { formatKey } from "../../core/tracker-key.js";
import { db } from "../../db/kysely.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { loadMutationResponse } from "./tracker-item-merged-queries.js";
import { statusIdField } from "./tracker-schemas.js";

/** True when the PATCH body carries only `version` and `statusId`. */
export function isStatusOnlyUpdate(body: Record<string, unknown>): boolean {
	const bodyKeys = Object.keys(body).filter((key) => body[key] !== undefined);
	return (
		bodyKeys.length > 0 &&
		bodyKeys.every((key) => key === "version" || key === "statusId") &&
		body.statusId !== undefined
	);
}

type StatusOnlyContext = {
	trackerItemId: number;
	statusId: unknown;
	version: number | undefined;
	prefix: string;
	key: { prefix: string; keyNumber: number };
};

export async function updateTrackerItemStatusOnly(
	req: Request,
	res: Response,
	{ trackerItemId, statusId, version, prefix, key }: StatusOnlyContext,
) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const parsedStatusId = parseWith(statusIdField, statusId);
	if (!parsedStatusId.ok) {
		return sendValidationError(res, parsedStatusId.body);
	}
	const result = await db.transaction().execute(async (trx) =>
		applyTrackerItemStatusChange(trx, {
			workspaceId,
			actor,
			trackerItemId,
			targetStatusId: parsedStatusId.data,
			version,
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

	const item = await loadMutationResponse(db, {
		workspaceId,
		keyNumber: key.keyNumber,
		prefix,
		canonical: Boolean(req.canonicalWorkItemsRoute),
		redirectFrom:
			key.prefix !== prefix ? formatKey(key.prefix, key.keyNumber) : undefined,
	});
	if (!item) return res.status(404).json({ error: "Not found" });
	await publishEvent(workspaceId, {
		type: "tracker.updated",
		actor,
		trackerItemId,
	});
	return res.json(item);
}
