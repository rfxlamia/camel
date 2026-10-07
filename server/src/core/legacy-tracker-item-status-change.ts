// Legacy `tracker_items` status primitive. Kept only for My Work mark-done until
// T12 moves it to the merged table; T21 deletes this file.
import { sql } from "kysely";
import type { DBExecutor } from "../db/kysely.js";
import { recordTrackerActivity } from "../lib/tracker-activity.js";
import {
	completedAtForTrackerCategory,
	type TrackerItemStatusChangeParams,
	type TrackerItemStatusChangeResult,
} from "./tracker-item-status-change.js";

type TrackerStatusChangeItem = {
	id: number;
	title: string;
	status_id: number;
	version: number;
	completed_at: Date | null;
};

type TrackerTargetStatus = {
	id: number;
	category: string | null;
	slot: string | null;
};

type TrackerUpdateResult =
	| { kind: "not_found" }
	| { kind: "conflict" }
	| { kind: "updated"; id: number; title: string };

async function loadTrackerStatusChangeItem(
	trx: DBExecutor,
	params: TrackerItemStatusChangeParams,
): Promise<TrackerStatusChangeItem | undefined> {
	return trx
		.selectFrom("tracker_items as ti")
		.select([
			"ti.id",
			"ti.title",
			"ti.status_id",
			"ti.version",
			"ti.completed_at",
		])
		.where("ti.id", "=", params.trackerItemId)
		.where("ti.workspace_id", "=", params.workspaceId)
		.where("ti.deleted_at", "is", null)
		.forUpdate()
		.executeTakeFirst();
}

function hasTrackerVersionConflict(
	item: TrackerStatusChangeItem,
	version: number | undefined,
): boolean {
	return version !== undefined && item.version !== version;
}

async function loadTargetTrackerStatus(
	trx: DBExecutor,
	params: TrackerItemStatusChangeParams,
): Promise<TrackerTargetStatus | undefined> {
	return trx
		.selectFrom("tracker_vocabularies")
		.select(["id", "category", "slot"])
		.where("id", "=", params.targetStatusId)
		.where("workspace_id", "=", params.workspaceId)
		.where("kind", "=", "status")
		.forUpdate()
		.executeTakeFirst();
}

async function classifyTrackerUpdateFailure(
	trx: DBExecutor,
	params: TrackerItemStatusChangeParams,
): Promise<Exclude<TrackerUpdateResult, { kind: "updated" }>> {
	const current = await trx
		.selectFrom("tracker_items as ti")
		.select("ti.id")
		.where("ti.id", "=", params.trackerItemId)
		.where("ti.workspace_id", "=", params.workspaceId)
		.where("ti.deleted_at", "is", null)
		.executeTakeFirst();
	return current ? { kind: "conflict" } : { kind: "not_found" };
}

async function updateTrackerStatus(
	trx: DBExecutor,
	params: TrackerItemStatusChangeParams,
	targetStatus: TrackerTargetStatus,
): Promise<TrackerUpdateResult> {
	let update = trx
		.updateTable("tracker_items")
		.set({
			status_id: params.targetStatusId,
			completed_at: completedAtForTrackerCategory(targetStatus.category),
			version: sql`version + 1`,
			updated_at: sql`now()`,
		})
		.where("id", "=", params.trackerItemId)
		.where("workspace_id", "=", params.workspaceId)
		.where("deleted_at", "is", null);
	if (params.version !== undefined) {
		update = update.where("version", "=", params.version);
	}

	const updated = await update.returning(["id", "title"]).executeTakeFirst();
	if (!updated) return classifyTrackerUpdateFailure(trx, params);
	return { kind: "updated", id: updated.id, title: updated.title };
}

async function recordTrackerStatusActivity(
	trx: DBExecutor,
	params: TrackerItemStatusChangeParams,
	item: TrackerStatusChangeItem,
): Promise<void> {
	await recordTrackerActivity(
		trx,
		params.actor,
		params.workspaceId,
		"tracker_item_updated",
		{
			trackerItemId: params.trackerItemId,
			payload: { title: item.title, changed: ["status"] },
		},
	);
}

/**
 * Apply one optimistic-lock-protected Tracker status change.
 *
 * Callers own source selection and authorization. This primitive deliberately
 * only touches tracker_items and tracker_events.
 */
export async function applyLegacyTrackerItemStatusChange(
	trx: DBExecutor,
	params: TrackerItemStatusChangeParams,
): Promise<TrackerItemStatusChangeResult> {
	const item = await loadTrackerStatusChangeItem(trx, params);
	if (!item) return { kind: "not_found" };
	if (hasTrackerVersionConflict(item, params.version)) {
		return { kind: "conflict" };
	}

	const targetStatus = await loadTargetTrackerStatus(trx, params);
	if (!targetStatus) return { kind: "invalid_status" };

	const updated = await updateTrackerStatus(trx, params, targetStatus);
	if (updated.kind !== "updated") return updated;
	await recordTrackerStatusActivity(trx, params, item);
	return { kind: "ok", itemId: updated.id, itemTitle: updated.title };
}
