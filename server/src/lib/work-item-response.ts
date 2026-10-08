// Work item read layer over the merged `cards` table (column_id NULL = Tracker item).
// ADR: docs/pocket/adr/2026-09-board-tracker-dual-table.md (#103).
import { sql } from "kysely";
import type { DBExecutor } from "../db/kysely.js";
import { loadCardAssigneesForCards } from "./card-assignees.js";
import { loadCardLabelsForCards } from "./card-response.js";
import {
	type BoardWorkItemRow,
	type MergedWorkItemRow,
	serializeBoardWorkItem,
	serializeMergedWorkItem,
} from "./work-item-serializers.js";

export {
	type BoardWorkItemRow,
	legacyTrackerItemResponse,
	type MergedWorkItemRow,
	serializeBoardWorkItem,
	serializeMergedWorkItem,
	serializeTrackerWorkItem,
	type TrackerItemRow,
	type WorkItemSource,
} from "./work-item-serializers.js";

export function selectBoardWorkItemRows(dbExec: DBExecutor) {
	return dbExec
		.selectFrom("cards as c")
		.innerJoin("tracker_vocabularies as st", "st.id", "c.status_id")
		.innerJoin("columns as col", "col.id", "c.column_id")
		.leftJoin("tracker_vocabularies as pr", "pr.id", "c.priority_id")
		.select([
			"c.id",
			"c.key_number",
			"c.title",
			"c.description",
			"c.version",
			"c.created_at",
			"c.started_at",
			"c.done_at",
			sql<string | null>`c.due_date::text`.as("due_date"),
			"c.column_id",
			"col.title as column_name",
			"c.position",
			"c.status_id",
			"st.name as status_name",
			"st.kind as status_kind",
			"st.position as status_position",
			"st.colour as status_colour",
			"st.category as status_category",
			"st.slot as status_slot",
			"c.priority_id",
			"pr.name as priority_name",
			"pr.kind as priority_kind",
			"pr.position as priority_position",
			"pr.colour as priority_colour",
			"c.project_id",
			"c.phase_id",
		])
		.where("col.board_id", "is", null);
}

/**
 * One row per live work item, board cards and column-less Tracker items alike.
 * Cards on non-default boards (agent boards) stay excluded: the predicate is
 * "no column, or a column that belongs to no board".
 */
export function selectWorkItemRows(dbExec: DBExecutor) {
	return dbExec
		.selectFrom("cards as c")
		.innerJoin("tracker_vocabularies as st", "st.id", "c.status_id")
		.leftJoin("columns as col", "col.id", "c.column_id")
		.leftJoin("tracker_vocabularies as pr", "pr.id", "c.priority_id")
		.select([
			"c.id",
			"c.key_number",
			"c.title",
			"c.description",
			"c.version",
			"c.created_at",
			"c.updated_at",
			"c.started_at",
			"c.done_at",
			sql<string | null>`c.due_date::text`.as("due_date"),
			"c.column_id",
			"col.title as column_name",
			"c.position",
			"c.plan_position",
			"c.start_date",
			"c.end_date",
			"c.completed_at",
			"c.status_id",
			"st.name as status_name",
			"st.kind as status_kind",
			"st.position as status_position",
			"st.colour as status_colour",
			"st.category as status_category",
			"st.slot as status_slot",
			"c.priority_id",
			"pr.name as priority_name",
			"pr.kind as priority_kind",
			"pr.position as priority_position",
			"pr.colour as priority_colour",
			"c.project_id",
			"c.phase_id",
		])
		.where((eb) =>
			eb.or([eb("c.column_id", "is", null), eb("col.board_id", "is", null)]),
		);
}

export async function hydrateWorkItems(
	dbExec: DBExecutor,
	rows: MergedWorkItemRow[],
	prefix: string,
) {
	const ids = rows.map((r) => r.id);
	const [assigneesByCard, labelsByCard] = await Promise.all([
		loadCardAssigneesForCards(dbExec, ids),
		loadCardLabelsForCards(dbExec, ids),
	]);
	return rows.map((row) =>
		serializeMergedWorkItem(
			row,
			prefix,
			assigneesByCard.get(row.id) ?? [],
			labelsByCard.get(row.id) ?? [],
		),
	);
}

export async function hydrateBoardWorkItems(
	dbExec: DBExecutor,
	rows: BoardWorkItemRow[],
	prefix: string,
) {
	const ids = rows.map((r) => r.id);
	const [assigneesByCard, labelsByCard] = await Promise.all([
		loadCardAssigneesForCards(dbExec, ids),
		loadCardLabelsForCards(dbExec, ids),
	]);
	return rows.map((row) =>
		serializeBoardWorkItem(
			row,
			prefix,
			assigneesByCard.get(row.id) ?? [],
			labelsByCard.get(row.id) ?? [],
		),
	);
}

export async function findWorkItemByKeyNumber(
	dbExec: DBExecutor,
	workspaceId: number,
	keyNumber: number,
) {
	return selectWorkItemRows(dbExec)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.key_number", "=", keyNumber)
		.where("c.deleted_at", "is", null)
		.executeTakeFirst();
}

export async function findBoardCardByKeyNumber(
	dbExec: DBExecutor,
	workspaceId: number,
	keyNumber: number,
) {
	return selectBoardWorkItemRows(dbExec)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.key_number", "=", keyNumber)
		.where("c.deleted_at", "is", null)
		.executeTakeFirst();
}

export async function listMergedWorkItems(
	dbExec: DBExecutor,
	workspaceId: number,
	prefix: string,
	q: string,
) {
	let query = selectWorkItemRows(dbExec)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.where("c.key_number", "is not", null);

	if (q) {
		const pattern = `%${q}%`;
		query = query.where((eb) =>
			eb.or([
				eb("c.title", "ilike", pattern),
				eb("c.description", "ilike", pattern),
				eb(sql`c.key_number::text`, "ilike", pattern),
			]),
		);
	}

	const rows = await query.orderBy("c.created_at").orderBy("c.id").execute();
	return hydrateWorkItems(dbExec, rows as MergedWorkItemRow[], prefix);
}
