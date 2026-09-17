import type { Request, Response } from "express";
import { formatKey, parseKeyFromUrl } from "../../core/tracker-key.js";
import {
	recordListDuration,
	WORK_ITEMS_LIST_THRESHOLD_MS,
} from "../../core/work-item-latency.js";
import { db } from "../../db/kysely.js";
import {
	resolveWorkItemByKey,
	routeKeyParam,
	workspacePrefix,
} from "./tracker-item-route-helpers.js";
import { getWorkItemEvents } from "../../lib/work-item-events.js";
import { listMergedWorkItems } from "../../lib/work-item-response.js";

export async function listTrackerItemsHandler(req: Request, res: Response) {
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
}

export async function getTrackerItemHandler(req: Request, res: Response) {
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
}

export async function getTrackerItemEventsHandler(req: Request, res: Response) {
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
}
