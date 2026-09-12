import { type RawBuilder, sql } from "kysely";
import type { AuthUser } from "../auth.js";
import type { DBExecutor } from "../db/kysely.js";
import { recordTrackerActivity } from "../routes/tracker-activity.js";

export type TrackerItemStatusChangeResult =
	| { kind: "not_found" }
	| { kind: "conflict" }
	| { kind: "invalid_status" }
	| {
			kind: "ok";
			itemId: number;
			itemTitle: string;
	  };

export type TrackerItemStatusChangeParams = {
	workspaceId: number;
	actor: AuthUser;
	trackerItemId: number;
	targetStatusId: number;
	version?: number;
};

/** Read the persisted Tracker status category used by combined PATCH writes. */
export async function getTrackerStatusCategory(
	dbExec: DBExecutor,
	workspaceId: number,
	statusId: number,
): Promise<string | null> {
	const row = await dbExec
		.selectFrom("tracker_vocabularies")
		.select("category")
		.where("id", "=", statusId)
		.where("workspace_id", "=", workspaceId)
		.where("kind", "=", "status")
		.executeTakeFirst();
	return row?.category ?? null;
}

/** Keep completed_at derivation identical for status-only and combined writes. */
export function completedAtForTrackerCategory(
	category: string | null,
): RawBuilder<Date> | null {
	return category === "completed"
		? sql<Date>`COALESCE(completed_at, now())`
		: null;
}

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
 * only touches tracker_items and tracker_events, so Board work cannot leak
 * into the Tracker mutation path.
 */
export async function applyTrackerItemStatusChange(
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

/** Backward-compatible descriptive alias for source mutation callers. */
export const applyTrackerStatusChange = applyTrackerItemStatusChange;
