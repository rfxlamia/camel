import type { Request, Response } from "express";
import { sql } from "kysely";
import { parseKeyFromUrl } from "../core/tracker-key.js";
import { db } from "../db/kysely.js";
import { publishEvent } from "../realtime.js";
import { recordTrackerActivity } from "./tracker-activity.js";
import { routeKeyParam } from "./tracker-item-route-helpers.js";
import {
	findBoardCardByKeyNumber,
	findTrackerItemByKeyNumber,
} from "./work-item-response.js";

export async function deleteTrackerItemHandler(req: Request, res: Response) {
	const { workspaceId } = req.workspace!;
	const actor = req.user!;
	const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
	if (!parsed) {
		return res.status(400).json({ error: "invalid tracker key" });
	}

	const { version } = (req.body ?? {}) as { version?: unknown };
	if (version !== undefined && !Number.isInteger(version)) {
		return res.status(400).json({ error: "version must be an integer" });
	}

	const existing = await findTrackerItemByKeyNumber(
		db,
		workspaceId,
		parsed.keyNumber,
	);
	if (!existing) {
		const boardCard = await findBoardCardByKeyNumber(
			db,
			workspaceId,
			parsed.keyNumber,
		);
		if (boardCard) {
			return res.status(409).json({
				error: "Board items must be deleted from the board.",
				code: "board_item_use_card_api",
			});
		}
		return res.status(404).json({ error: "Not found" });
	}

	type DeleteResult =
		| { kind: "not_found" }
		| { kind: "conflict" }
		| { kind: "ok" };

	const result: DeleteResult = await db.transaction().execute(async (trx) => {
		const row = await trx
			.updateTable("tracker_items")
			.set({ deleted_at: sql`now()`, updated_at: sql`now()` })
			.where("id", "=", existing.id)
			.where("workspace_id", "=", workspaceId)
			.where("deleted_at", "is", null)
			.$if(version !== undefined, (qb) =>
				qb.where("version", "=", version as number),
			)
			.returning(["id", "title"])
			.executeTakeFirst();

		if (!row) {
			const current = await trx
				.selectFrom("tracker_items")
				.select("id")
				.where("id", "=", existing.id)
				.where("workspace_id", "=", workspaceId)
				.where("deleted_at", "is", null)
				.executeTakeFirst();
			return current ? { kind: "conflict" } : { kind: "not_found" };
		}

		await recordTrackerActivity(
			trx,
			actor,
			workspaceId,
			"tracker_item_deleted",
			{
				trackerItemId: row.id,
				payload: { title: row.title },
			},
		);

		return { kind: "ok" };
	});

	if (result.kind === "not_found") {
		return res.status(404).json({ error: "Not found" });
	}
	if (result.kind === "conflict") {
		return res.status(409).json({
			error: "Someone else updated this item first.",
			code: "version_conflict",
		});
	}

	await publishEvent(workspaceId, {
		type: "tracker.deleted",
		actor,
		trackerItemId: existing.id,
	});
	res.status(204).send();
}
