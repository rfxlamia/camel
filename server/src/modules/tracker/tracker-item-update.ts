import type { Request, Response } from "express";
import { formatKey } from "../../core/tracker-key.js";
import { db } from "../../db/kysely.js";
import { findBoardCardByKeyNumber } from "../../lib/work-item-response.js";
import { publishEvent } from "../../realtime.js";
import { parseWith, sendValidationError } from "../../validators/http.js";
import { optionalVersion } from "../../validators/schemas.js";
import { workspacePrefix } from "./tracker-item-create-queries.js";
import {
	findColumnlessItem,
	loadMutationResponse,
} from "./tracker-item-merged-queries.js";
import { updateBoardCardViaTracker } from "./tracker-item-update-board.js";
import { parseTrackerUpdateBody } from "./tracker-item-update-parse.js";
import {
	isStatusOnlyUpdate,
	updateTrackerItemStatusOnly,
} from "./tracker-item-update-status.js";
import { writeTrackerUpdate } from "./tracker-item-update-write.js";
import { parseTrackerKey, trackerPatchColumnGuard } from "./tracker-schemas.js";

export async function updateTrackerItemHandler(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const key = parseTrackerKey(req.params.key);
	if (!key.ok) return sendValidationError(res, key.body);
	const parsed = key.data;

	const body = req.body ?? {};
	const parsedVersion = parseWith(optionalVersion, body.version);
	if (!parsedVersion.ok) return sendValidationError(res, parsedVersion.body);
	const version = parsedVersion.data;

	const prefix = await workspacePrefix(db, workspaceId);
	if (!prefix) return res.status(404).json({ error: "Not found" });

	const existing = await findColumnlessItem(db, workspaceId, parsed.keyNumber);
	if (!existing) {
		const boardCard = await findBoardCardByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
		if (!boardCard) {
			return res.status(404).json({ error: "Not found" });
		}

		return updateBoardCardViaTracker(req, res, {
			boardCard,
			body,
			version,
			prefix,
			keyNumber: parsed.keyNumber,
		});
	}

	const columnGuard = parseWith(trackerPatchColumnGuard, body, {
		fieldErrors: true,
	});
	if (!columnGuard.ok) return sendValidationError(res, columnGuard.body);

	if (isStatusOnlyUpdate(body)) {
		return updateTrackerItemStatusOnly(req, res, {
			trackerItemId: existing.id,
			statusId: body.statusId,
			version,
			prefix,
			key: parsed,
		});
	}

	const parsedBody = await parseTrackerUpdateBody(body, workspaceId);
	if ("error" in parsedBody) {
		return sendValidationError(res, { error: parsedBody.error });
	}
	const result = await db.transaction().execute((trx) =>
		writeTrackerUpdate(trx, {
			workspaceId,
			actor,
			existing,
			parsed: parsedBody,
			statusId: typeof body.statusId === "number" ? body.statusId : undefined,
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
