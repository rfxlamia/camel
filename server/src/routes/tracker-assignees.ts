import type { DBExecutor } from "../db/kysely.js";
import { diffAssigneeIds } from "./card-assignees.js";

export type TrackerItemAssignee = {
	id: number;
	username: string;
	displayName: string;
};

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

export async function getTrackerItemAssigneeIds(
	dbExec: DBExecutor,
	trackerItemId: number,
): Promise<number[]> {
	const rows = await dbExec
		.selectFrom("tracker_item_assignees")
		.select("user_id")
		.where("tracker_item_id", "=", trackerItemId)
		.orderBy("user_id")
		.execute();
	return rows.map((r) => r.user_id);
}

export async function syncTrackerItemAssignees(
	dbExec: DBExecutor,
	trackerItemId: number,
	assigneeIds: number[],
): Promise<{ prev: number[]; added: number[]; removed: number[] }> {
	const prev = await getTrackerItemAssigneeIds(dbExec, trackerItemId);
	const { added, removed } = diffAssigneeIds(prev, assigneeIds);

	if (removed.length > 0) {
		await dbExec
			.deleteFrom("tracker_item_assignees")
			.where("tracker_item_id", "=", trackerItemId)
			.where("user_id", "in", removed)
			.execute();
	}
	for (const userId of added) {
		await dbExec
			.insertInto("tracker_item_assignees")
			.values({ tracker_item_id: trackerItemId, user_id: userId })
			.onConflict((oc) => oc.doNothing())
			.execute();
	}

	return { prev, added, removed };
}
