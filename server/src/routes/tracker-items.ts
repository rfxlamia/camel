import { Router } from "express";
import { sql } from "kysely";
import { formatKey, parseKeyFromUrl } from "../core/tracker-key.js";
import {
	recordListDuration,
	WORK_ITEMS_LIST_THRESHOLD_MS,
} from "../core/work-item-latency.js";
import { db } from "../db/kysely.js";
import { requireWorkspaceMember } from "../middleware/workspace.js";
import { publishEvent } from "../realtime.js";
import { recordTrackerActivity } from "./tracker-activity.js";
import { createTrackerItemHandler } from "./tracker-item-create.js";
import { reorderTrackerItemHandler } from "./tracker-item-reorder.js";
import {
	resolveWorkItemByKey,
	routeKeyParam,
	workspacePrefix,
} from "./tracker-item-route-helpers.js";
import { updateTrackerItemHandler } from "./tracker-item-update.js";
import { getWorkItemEvents } from "./work-item-events.js";
import {
	findBoardCardByKeyNumber,
	findTrackerItemByKeyNumber,
	listMergedWorkItems,
} from "./work-item-response.js";

export const trackerItemsRouter = Router({ mergeParams: true });

const findItemByKeyNumber = findTrackerItemByKeyNumber;

trackerItemsRouter.get(
	"/tracker/items",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const prefix = await workspacePrefix(db, workspaceId);
		if (!prefix) return res.status(404).json({ error: "Not found" });

		const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
		const start = performance.now();
		const items = await listMergedWorkItems(db, workspaceId, prefix, q);
		const ms = performance.now() - start;
		recordListDuration(ms);
		if (ms > WORK_ITEMS_LIST_THRESHOLD_MS) {
			console.warn(
				JSON.stringify({
					event: "work_items_list_slow",
					ms,
					workspaceId,
				}),
			);
		}
		res.json(items);
	},
);

trackerItemsRouter.post(
	"/tracker/items",
	requireWorkspaceMember,
	createTrackerItemHandler,
);

trackerItemsRouter.get(
	"/tracker/items/:key",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
		if (!parsed) {
			return res.status(400).json({ error: "invalid tracker key" });
		}

		const prefix = await workspacePrefix(db, workspaceId);
		if (!prefix) return res.status(404).json({ error: "Not found" });

		const redirectFrom =
			parsed.prefix !== prefix
				? formatKey(parsed.prefix, parsed.keyNumber)
				: undefined;

		const item = await resolveWorkItemByKey(
			db,
			workspaceId,
			parsed.keyNumber,
			prefix,
			redirectFrom,
		);
		if (!item) return res.status(404).json({ error: "Not found" });
		res.json(item);
	},
);

trackerItemsRouter.patch(
	"/tracker/items/:key/position",
	requireWorkspaceMember,
	reorderTrackerItemHandler,
);

trackerItemsRouter.patch(
	"/tracker/items/:key",
	requireWorkspaceMember,
	updateTrackerItemHandler,
);

trackerItemsRouter.delete(
	"/tracker/items/:key",
	requireWorkspaceMember,
	async (req, res) => {
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

		const existing = await findItemByKeyNumber(
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
	},
);

trackerItemsRouter.get(
	"/tracker/items/:key/events",
	requireWorkspaceMember,
	async (req, res) => {
		const { workspaceId } = req.workspace!;
		const parsed = parseKeyFromUrl(routeKeyParam(req.params.key));
		if (!parsed) {
			return res.status(400).json({ error: "invalid tracker key" });
		}

		const events = await getWorkItemEvents(db, workspaceId, parsed.keyNumber);
		if (!events) {
			return res.status(404).json({ error: "Not found" });
		}

		return res.json({ events });
	},
);
