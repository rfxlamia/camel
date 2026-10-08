import type { DBExecutor } from "../db/kysely.js";
import { getCardAssigneeIds, syncCardAssignees } from "./card-assignees.js";

export type TrackerItemAssignee = {
	id: number;
	username: string;
	displayName: string;
};

// Legacy read over `tracker_item_assignees`; only My Work (T12) still uses it.
export async function loadTrackerAssigneesForItems(
	dbExec: DBExecutor,
	trackerItemIds: number[],
): Promise<Map<number, TrackerItemAssignee[]>> {
	const map = new Map<number, TrackerItemAssignee[]>();
	if (trackerItemIds.length === 0) return map;

	const rows = await dbExec
		.selectFrom("tracker_item_assignees as tia")
		.innerJoin("users as u", "u.id", "tia.user_id")
		.select(["tia.tracker_item_id", "u.id", "u.username", "u.display_name"])
		.where("tia.tracker_item_id", "in", trackerItemIds)
		.orderBy("tia.tracker_item_id")
		.orderBy("u.display_name")
		.execute();

	for (const row of rows) {
		const itemId = row.tracker_item_id;
		const list = map.get(itemId) ?? [];
		list.push({
			id: row.id,
			username: row.username as string,
			displayName: row.display_name,
		});
		map.set(itemId, list);
	}
	return map;
}

/** Tracker items are column-less cards rows, so assignees live in card_assignees. */
export async function getTrackerItemAssigneeIds(
	dbExec: DBExecutor,
	trackerItemId: number,
): Promise<number[]> {
	return getCardAssigneeIds(dbExec, trackerItemId);
}

export async function syncTrackerItemAssignees(
	dbExec: DBExecutor,
	trackerItemId: number,
	assigneeIds: number[],
): Promise<{ prev: number[]; added: number[]; removed: number[] }> {
	return syncCardAssignees(dbExec, trackerItemId, assigneeIds);
}
