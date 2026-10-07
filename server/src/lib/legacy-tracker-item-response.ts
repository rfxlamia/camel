// Legacy tracker_items read shim. Write paths (T10) and My Work (T12) still use it;
// delete once they move to the merged table (T21 removes the file).
import type { DBExecutor } from "../db/kysely.js";
import { loadTrackerAssigneesForItems } from "./tracker-assignees.js";
import { type VocabularyRow } from "./vocabulary-response.js";
import {
	legacyTrackerItemResponse,
	serializeTrackerWorkItem,
	type TrackerItemRow,
} from "./work-item-serializers.js";

export function selectTrackerItemRows(dbExec: DBExecutor) {
	return dbExec
		.selectFrom("tracker_items as ti")
		.innerJoin("tracker_vocabularies as st", "st.id", "ti.status_id")
		.leftJoin("tracker_vocabularies as pr", "pr.id", "ti.priority_id")
		.select([
			"ti.id",
			"ti.key_number",
			"ti.title",
			"ti.description",
			"ti.version",
			"ti.created_at",
			"ti.updated_at",
			"ti.project_id",
			"ti.phase_id",
			"ti.start_date",
			"ti.end_date",
			"ti.completed_at",
			"ti.position",
			"ti.status_id",
			"st.name as status_name",
			"st.kind as status_kind",
			"st.position as status_position",
			"st.colour as status_colour",
			"st.category as status_category",
			"st.slot as status_slot",
			"ti.priority_id",
			"pr.name as priority_name",
			"pr.kind as priority_kind",
			"pr.position as priority_position",
			"pr.colour as priority_colour",
		]);
}

async function loadTrackerLabelsForItems(
	dbExec: DBExecutor,
	itemIds: number[],
): Promise<Map<number, VocabularyRow[]>> {
	const map = new Map<number, VocabularyRow[]>();
	if (itemIds.length === 0) return map;

	const rows = await dbExec
		.selectFrom("tracker_item_labels as til")
		.innerJoin("tracker_vocabularies as tv", "tv.id", "til.vocabulary_id")
		.select([
			"til.tracker_item_id",
			"tv.id",
			"tv.kind",
			"tv.name",
			"tv.position",
			"tv.colour",
		])
		.where("til.tracker_item_id", "in", itemIds)
		.orderBy("til.tracker_item_id")
		.orderBy("tv.position")
		.execute();

	for (const row of rows) {
		const list = map.get(row.tracker_item_id) ?? [];
		list.push({
			id: row.id,
			kind: row.kind,
			name: row.name,
			position: row.position,
			colour: row.colour,
		});
		map.set(row.tracker_item_id, list);
	}
	return map;
}

export async function hydrateTrackerWorkItems(
	dbExec: DBExecutor,
	rows: TrackerItemRow[],
	prefix: string,
) {
	const ids = rows.map((r) => r.id);
	const assigneesByItem = await loadTrackerAssigneesForItems(dbExec, ids);
	const labelsByItem = await loadTrackerLabelsForItems(dbExec, ids);
	return rows.map((row) =>
		serializeTrackerWorkItem(
			row,
			prefix,
			assigneesByItem.get(row.id) ?? [],
			labelsByItem.get(row.id) ?? [],
		),
	);
}

export async function hydrateMutationItem(
	dbExec: DBExecutor,
	row: TrackerItemRow,
	prefix: string,
	opts?: { canonicalWorkItem?: boolean; redirectFrom?: string },
) {
	const [item] = await hydrateTrackerWorkItems(dbExec, [row], prefix);
	const body = opts?.redirectFrom
		? {
				...item,
				canonicalKey: item.key,
				redirectFrom: opts.redirectFrom,
			}
		: item;
	return legacyTrackerItemResponse(body, Boolean(opts?.canonicalWorkItem));
}

export async function findTrackerItemByKeyNumber(
	dbExec: DBExecutor,
	workspaceId: number,
	keyNumber: number,
) {
	return selectTrackerItemRows(dbExec)
		.where("ti.workspace_id", "=", workspaceId)
		.where("ti.key_number", "=", keyNumber)
		.where("ti.deleted_at", "is", null)
		.executeTakeFirst();
}
