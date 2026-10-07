import { formatKey } from "../core/tracker-key.js";
import type { CardAssignee } from "./card-assignees.js";
import { computeCardUpdatedAt } from "./card-response.js";
import type { TrackerItemAssignee } from "./tracker-assignees.js";
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
	updated_at: Date | null;
	started_at?: Date | null;
	done_at?: Date | null;
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
	updated_at?: Date | null;
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

/**
 * Stored `updated_at` wins. NULL means "use the computed value" (the board
 * cards' historic derivation, see work-item-merge.sql).
 */
function serializeUpdatedAt(row: {
	updated_at?: Date | null;
	started_at?: Date | null;
	done_at?: Date | null;
	created_at: Date;
}): string {
	if (row.updated_at != null) return row.updated_at.toISOString();
	return computeCardUpdatedAt({
		done_at: row.done_at ?? null,
		started_at: row.started_at ?? null,
		created_at: row.created_at,
	});
}

function formatDateOnly(value: Date | string | null): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value.slice(0, 10);
	return value.toISOString().slice(0, 10);
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
		updatedAt: serializeUpdatedAt(row),
	};
	if (opts?.redirectFrom) {
		body.canonicalKey = key;
		body.redirectFrom = opts.redirectFrom;
	}
	return body;
}

export function legacyTrackerItemResponse(
	item: Record<string, unknown>,
	canonical: boolean,
): Record<string, unknown> {
	if (canonical) return item;
	const { source: _source, ...legacy } = item;
	return legacy;
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
		updatedAt: serializeUpdatedAt(row),
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

/** Row shape of the merged `cards` read: board cards and column-less items. */
export type MergedWorkItemRow = Omit<
	BoardWorkItemRow,
	"column_id" | "column_name"
> & {
	column_id: number | null;
	column_name: string | null;
	updated_at: Date | null;
	plan_position: number | null;
	start_date: Date | string | null;
	end_date: Date | string | null;
	completed_at: Date | null;
};

/** `source` is "tracker" when column_id is NULL, otherwise "board". */
export function serializeMergedWorkItem(
	row: MergedWorkItemRow,
	prefix: string,
	assignees: CardAssignee[],
	labels: VocabularyRow[] = [],
) {
	if (row.column_id == null) {
		return serializeTrackerWorkItem(
			{ ...row, position: row.plan_position },
			prefix,
			assignees,
			labels,
		);
	}
	return serializeBoardWorkItem(
		{ ...row, column_id: row.column_id },
		prefix,
		assignees,
		labels,
	);
}
