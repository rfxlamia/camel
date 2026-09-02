import { sql } from "kysely";
import { formatKey } from "../core/tracker-key.js";
import type { DBExecutor } from "../db/kysely.js";
import {
	type CardAssignee,
	loadCardAssigneesForCards,
} from "./card-assignees.js";
import { computeCardUpdatedAt, loadCardLabelsForCards } from "./card-response.js";
import {
	loadTrackerAssigneesForItems,
	type TrackerItemAssignee,
} from "./tracker-assignees.js";
import {
	serializeVocabulary,
	type VocabularyRow,
} from "./vocabulary-response.js";

export type WorkItemSource = "board" | "tracker";

export type TrackerItemRow = {
	id: number;
	key_number: number;
	title: string;
	description: string;
	version: number;
	created_at: Date;
	updated_at: Date;
	status_id: number;
	status_name: string;
	status_kind: string;
	status_position: number;
	status_colour: string;
	status_category: string | null;
	status_slot: string | null;
	priority_id: number | null;
	priority_name: string | null;
	priority_kind: string | null;
	priority_position: number | null;
	priority_colour: string | null;
	project_id: number | null;
	phase_id: number | null;
	start_date: Date | string | null;
	end_date: Date | string | null;
	completed_at: Date | null;
	position: number | null;
};

export type BoardWorkItemRow = {
	id: number;
	key_number: number;
	title: string;
	description: string;
	version: number;
	created_at: Date;
	started_at: Date | null;
	done_at: Date | null;
	due_date: string | null;
	column_id: number;
	column_name: string | null;
	position: number;
	status_id: number;
	status_name: string;
	status_kind: string;
	status_position: number;
	status_colour: string;
	status_category: string | null;
	status_slot: string | null;
	priority_id: number | null;
	priority_name: string | null;
	priority_kind: string | null;
	priority_position: number | null;
	priority_colour: string | null;
	project_id: number | null;
	phase_id: number | null;
};

function formatDateOnly(value: Date | string | null): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value.slice(0, 10);
	return value.toISOString().slice(0, 10);
}

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

function serializeStatus(row: {
	status_id: number;
	status_name: string;
	status_kind: string;
	status_position: number;
	status_colour: string;
	status_category: string | null;
	status_slot: string | null;
}) {
	return serializeVocabulary({
		id: row.status_id,
		kind: row.status_kind,
		name: row.status_name,
		position: row.status_position,
		colour: row.status_colour,
		category: row.status_category,
		slot: row.status_slot,
	});
}

function serializePriority(row: {
	priority_id: number | null;
	priority_name: string | null;
	priority_kind: string | null;
	priority_position: number | null;
	priority_colour: string | null;
}) {
	if (row.priority_id == null) return null;
	return serializeVocabulary({
		id: row.priority_id,
		kind: row.priority_kind!,
		name: row.priority_name!,
		position: row.priority_position!,
		colour: row.priority_colour!,
	});
}

export function serializeTrackerWorkItem(
	row: TrackerItemRow,
	prefix: string,
	assignees: TrackerItemAssignee[],
	labels: VocabularyRow[] = [],
	opts?: { redirectFrom?: string },
) {
	const key = formatKey(prefix, row.key_number);
	const body: Record<string, unknown> = {
		id: row.id,
		key,
		source: "tracker" as const,
		title: row.title,
		description: row.description,
		projectId: row.project_id,
		phaseId: row.phase_id,
		startDate: formatDateOnly(row.start_date),
		endDate: formatDateOnly(row.end_date),
		completedAt: row.completed_at?.toISOString() ?? null,
		position: row.position,
		status: serializeStatus(row),
		priority: serializePriority(row),
		labels: labels.map(serializeVocabulary),
		assignees,
		version: row.version,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString(),
	};
	if (opts?.redirectFrom) {
		body.canonicalKey = key;
		body.redirectFrom = opts.redirectFrom;
	}
	return body;
}

export function serializeBoardWorkItem(
	row: BoardWorkItemRow,
	prefix: string,
	assignees: CardAssignee[],
	labels: VocabularyRow[] = [],
	opts?: { redirectFrom?: string },
) {
	const key = formatKey(prefix, row.key_number);
	const body: Record<string, unknown> = {
		id: row.id,
		key,
		source: "board" as const,
		title: row.title,
		description: row.description,
		projectId: row.project_id,
		phaseId: row.phase_id,
		startDate: null,
		endDate: null,
		completedAt: null,
		position: row.position,
		status: serializeStatus(row),
		priority: serializePriority(row),
		labels: labels.map(serializeVocabulary),
		assignees,
		version: row.version,
		createdAt: row.created_at.toISOString(),
		updatedAt: computeCardUpdatedAt(row),
		columnId: row.column_id,
		columnName: row.column_name,
		dueDate: row.due_date,
		startedAt: row.started_at?.toISOString() ?? null,
		doneAt: row.done_at?.toISOString() ?? null,
	};
	if (opts?.redirectFrom) {
		body.canonicalKey = key;
		body.redirectFrom = opts.redirectFrom;
	}
	return body;
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
		serializeBoardWorkItem(row, prefix, assigneesByCard.get(row.id) ?? [], labelsByCard.get(row.id) ?? []),
	);
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
	let trackerQuery = selectTrackerItemRows(dbExec)
		.where("ti.workspace_id", "=", workspaceId)
		.where("ti.deleted_at", "is", null);

	let cardQuery = selectBoardWorkItemRows(dbExec)
		.where("c.workspace_id", "=", workspaceId)
		.where("c.deleted_at", "is", null)
		.where("c.key_number", "is not", null);

	if (q) {
		const pattern = `%${q}%`;
		trackerQuery = trackerQuery.where((eb) =>
			eb.or([
				eb("ti.title", "ilike", pattern),
				eb("ti.description", "ilike", pattern),
				eb(sql`ti.key_number::text`, "ilike", pattern),
			]),
		);
		cardQuery = cardQuery.where((eb) =>
			eb.or([
				eb("c.title", "ilike", pattern),
				eb("c.description", "ilike", pattern),
				eb(sql`c.key_number::text`, "ilike", pattern),
			]),
		);
	}

	const [trackerRows, cardRows] = await Promise.all([
		trackerQuery.execute(),
		cardQuery.execute(),
	]);

	const trackerKeys = new Set(trackerRows.map((row) => row.key_number));
	const boardOnlyRows = cardRows.flatMap((row) => {
		if (row.key_number == null || trackerKeys.has(row.key_number)) {
			return [];
		}
		return [row as BoardWorkItemRow];
	});

	type MergedEntry =
		| { kind: "tracker"; created_at: Date; row: TrackerItemRow }
		| { kind: "board"; created_at: Date; row: BoardWorkItemRow };

	const merged: MergedEntry[] = [
		...trackerRows.map((row) => ({
			kind: "tracker" as const,
			created_at: row.created_at,
			row,
		})),
		...boardOnlyRows.map((row) => ({
			kind: "board" as const,
			created_at: row.created_at,
			row,
		})),
	];
	merged.sort(
		(a, b) => a.created_at.getTime() - b.created_at.getTime(),
	);

	const trackerOnly = merged
		.filter((e): e is Extract<MergedEntry, { kind: "tracker" }> => e.kind === "tracker")
		.map((e) => e.row);
	const boardOnly = merged
		.filter((e): e is Extract<MergedEntry, { kind: "board" }> => e.kind === "board")
		.map((e) => e.row);

	const [trackerItems, boardItems] = await Promise.all([
		hydrateTrackerWorkItems(dbExec, trackerOnly, prefix),
		hydrateBoardWorkItems(dbExec, boardOnly, prefix),
	]);

	const byKey = new Map<string, Record<string, unknown>>();
	for (const item of trackerItems) {
		byKey.set(item.key as string, item);
	}
	for (const item of boardItems) {
		byKey.set(item.key as string, item);
	}

	return merged.map((entry) => {
		const key =
			entry.kind === "tracker"
				? formatKey(prefix, entry.row.key_number)
				: formatKey(prefix, entry.row.key_number);
		return byKey.get(key)!;
	});
}
