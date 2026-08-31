/** The fixed status slots shared by board columns and tracker vocabulary. */
export const STATUS_SLOTS = [
	"backlog",
	"todo",
	"in_progress",
	"done",
	"canceled",
] as const;

export type StatusSlot = (typeof STATUS_SLOTS)[number];
export type ColumnStatusSlot = Exclude<StatusSlot, "canceled">;

export interface ColumnStatusInput {
	id: number;
	position: number;
	is_done: boolean;
}

export interface StatusVocabularyInput {
	id: number;
	kind: string;
	slot: StatusSlot | null;
}

function compareColumns(
	left: ColumnStatusInput,
	right: ColumnStatusInput,
): number {
	const positionDifference = left.position - right.position;
	if (positionDifference !== 0) return positionDifference;
	return left.id - right.id;
}

/**
 * Map each column id to its fixed status slot by column geometry.
 *
 * Done columns are assigned first conceptually, so they do not consume one
 * of the backlog/todo/in-progress positions among non-done columns.
 */
export function mapColumnSlots(
	columns: readonly ColumnStatusInput[],
): Map<number, ColumnStatusSlot> {
	const mapped = new Map<number, ColumnStatusSlot>();
	const orderedColumns = [...columns].sort(compareColumns);
	let nonDoneIndex = 0;

	for (const column of orderedColumns) {
		if (column.is_done) {
			mapped.set(column.id, "done");
			continue;
		}

		const slot: ColumnStatusSlot =
			nonDoneIndex === 0
				? "backlog"
				: nonDoneIndex === 1
					? "todo"
					: "in_progress";
		mapped.set(column.id, slot);
		nonDoneIndex += 1;
	}

	return mapped;
}

/** First non-done column by geometry — the backlog boundary for started_at. */
export function firstNonDoneColumnId(
	columns: readonly ColumnStatusInput[],
): number | undefined {
	const orderedColumns = [...columns].sort(compareColumns);
	return orderedColumns.find((column) => !column.is_done)?.id;
}

/** Resolve a fixed status vocabulary id without consulting display metadata. */
export function statusIdForSlot(
	rows: readonly StatusVocabularyInput[],
	slot: StatusSlot,
): number | null {
	return (
		rows.find((row) => row.kind === "status" && row.slot === slot)?.id ?? null
	);
}
