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
	const item = await trx
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
	if (!item) return { kind: "not_found" };
	if (params.version !== undefined && item.version !== params.version) {
		return { kind: "conflict" };
	}

	// Read and lock the status row inside the same transaction as the item
	// update. A status/mapping deletion that committed before this point is
	// therefore rejected before any source write or activity is recorded.
	const targetStatus = await trx
		.selectFrom("tracker_vocabularies")
		.select(["id", "category", "slot"])
		.where("id", "=", params.targetStatusId)
		.where("workspace_id", "=", params.workspaceId)
		.where("kind", "=", "status")
		.forUpdate()
		.executeTakeFirst();
	if (!targetStatus) return { kind: "invalid_status" };

	const completedAt = completedAtForTrackerCategory(targetStatus.category);

	let update = trx
		.updateTable("tracker_items")
		.set({
			status_id: params.targetStatusId,
			completed_at: completedAt,
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
	if (!updated) {
		const current = await trx
			.selectFrom("tracker_items as ti")
			.select("ti.id")
			.where("ti.id", "=", params.trackerItemId)
			.where("ti.workspace_id", "=", params.workspaceId)
			.where("ti.deleted_at", "is", null)
			.executeTakeFirst();
		return current ? { kind: "conflict" } : { kind: "not_found" };
	}

	await recordTrackerActivity(
		trx,
		params.actor,
		params.workspaceId,
		"tracker_item_updated",
		{
			trackerItemId: params.trackerItemId,
			payload: {
				title: item.title,
				changed: ["status"],
			},
		},
	);

	return {
		kind: "ok",
		itemId: updated.id,
		itemTitle: updated.title,
	};
}

/** Backward-compatible descriptive alias for source mutation callers. */
export const applyTrackerStatusChange = applyTrackerItemStatusChange;
