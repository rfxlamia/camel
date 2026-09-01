import {
	type ColumnStatusInput,
	type ColumnStatusSlot,
	mapColumnSlots,
} from "./column-status-map.js";

function compareColumns(
	left: ColumnStatusInput,
	right: ColumnStatusInput,
): number {
	const positionDifference = left.position - right.position;
	if (positionDifference !== 0) return positionDifference;
	return left.id - right.id;
}

function nonDoneColumns(columns: readonly ColumnStatusInput[]): ColumnStatusInput[] {
	return [...columns].filter((column) => !column.is_done).sort(compareColumns);
}

/**
 * Resolve the destination column when a board card's status slot changes from Tracker.
 *
 * Returns null when the card should stay in its current column (canceled slot).
 * Returns "unmappable" when the board geometry cannot represent the requested slot.
 */
export function resolveColumnForStatusChange(
	currentColumnId: number,
	targetSlot: ColumnStatusSlot | "canceled",
	columns: readonly ColumnStatusInput[],
): number | null | "unmappable" {
	if (targetSlot === "canceled") {
		return null;
	}

	const slotByColumn = mapColumnSlots(columns);
	const currentSlot = slotByColumn.get(currentColumnId);
	const currentColumn = columns.find((column) => column.id === currentColumnId);
	const nonDone = nonDoneColumns(columns);

	if (targetSlot === "in_progress") {
		if (currentSlot === "in_progress") {
			return currentColumnId;
		}
		const inProgressColumn = nonDone.find(
			(column) => slotByColumn.get(column.id) === "in_progress",
		);
		if (inProgressColumn) return inProgressColumn.id;
		if (currentColumn?.is_done && nonDone.length > 0) {
			return nonDone[0]!.id;
		}
		return "unmappable";
	}

	if (targetSlot === "done") {
		const doneColumn = [...columns]
			.sort(compareColumns)
			.find((column) => column.is_done);
		if (!doneColumn) return "unmappable";
		return doneColumn.id;
	}

	if (nonDone.length === 0) return "unmappable";

	if (targetSlot === "backlog") {
		return nonDone[0]!.id;
	}

	if (targetSlot === "todo") {
		const todoColumn = nonDone.find(
			(column) => slotByColumn.get(column.id) === "todo",
		);
		if (todoColumn) return todoColumn.id;
		return (nonDone[1] ?? nonDone[0])!.id;
	}

	return "unmappable";
}
