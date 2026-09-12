import {
	mapColumnSlots,
	statusIdForSlot,
	type ColumnStatusInput,
	type StatusSlot,
} from "./column-status-map.js";
import { resolveColumnForStatusChange } from "./column-status-reverse.js";

export type MyWorkDoneBoardColumn = ColumnStatusInput & {
	workspaceId: number;
	boardId: number | null;
};

export type MyWorkDoneStatusVocabulary = {
	id: number;
	workspaceId: number;
	kind: string;
	slot: StatusSlot | null;
	/** Existing vocabulary ordering; id is the stable tie-breaker. */
	position?: number;
};

export type MyWorkDoneTargetInputs = {
	boardColumns: readonly MyWorkDoneBoardColumn[];
	statusVocabularies: readonly MyWorkDoneStatusVocabulary[];
};

export type MyWorkDoneTargetCandidate =
	| { source: "board"; workspaceId: number; columnId: number }
	| { source: "tracker"; workspaceId: number };

export type MyWorkDoneTarget =
	| {
			available: true;
			source: "board";
			columnId: number;
			statusId: number;
			slot: "done";
	  }
	| {
			available: true;
			source: "tracker";
			statusId: number;
			slot: "done";
	  }
	| { available: false; reason: "missing_done_mapping" };

const unavailable = (): MyWorkDoneTarget => ({
	available: false,
	reason: "missing_done_mapping",
});

function compareStatusVocabulary(
	left: MyWorkDoneStatusVocabulary,
	right: MyWorkDoneStatusVocabulary,
): number {
	const leftPosition = left.position ?? Number.POSITIVE_INFINITY;
	const rightPosition = right.position ?? Number.POSITIVE_INFINITY;
	if (leftPosition !== rightPosition) return leftPosition - rightPosition;
	return left.id - right.id;
}

function statusIdForWorkspaceSlot(
	statusVocabularies: readonly MyWorkDoneStatusVocabulary[],
	workspaceId: number,
	slot: StatusSlot,
): number | null {
	const rows = statusVocabularies
		.filter((row) => row.workspaceId === workspaceId)
		.sort(compareStatusVocabulary);
	return statusIdForSlot(rows, slot);
}

function resolveBoardDoneTarget(
	candidate: Extract<MyWorkDoneTargetCandidate, { source: "board" }>,
	inputs: MyWorkDoneTargetInputs,
): MyWorkDoneTarget {
	const currentColumn = inputs.boardColumns.find(
		(column) =>
			column.workspaceId === candidate.workspaceId &&
			column.id === candidate.columnId,
	);
	if (!currentColumn) return unavailable();

	const siblingColumns = inputs.boardColumns.filter(
		(column) =>
			column.workspaceId === currentColumn.workspaceId &&
			column.boardId === currentColumn.boardId,
	);
	const destinationColumnId = resolveColumnForStatusChange(
		currentColumn.id,
		"done",
		siblingColumns,
	);
	if (destinationColumnId === "unmappable" || destinationColumnId === null) {
		return unavailable();
	}

	const destinationSlot =
		mapColumnSlots(siblingColumns).get(destinationColumnId);
	if (destinationSlot !== "done") return unavailable();
	const statusId = statusIdForWorkspaceSlot(
		inputs.statusVocabularies,
		candidate.workspaceId,
		destinationSlot,
	);
	if (statusId === null) return unavailable();

	return {
		available: true,
		source: "board",
		columnId: destinationColumnId,
		statusId,
		slot: "done",
	};
}

function resolveTrackerDoneTarget(
	candidate: Extract<MyWorkDoneTargetCandidate, { source: "tracker" }>,
	inputs: MyWorkDoneTargetInputs,
): MyWorkDoneTarget {
	const statusId = statusIdForWorkspaceSlot(
		inputs.statusVocabularies,
		candidate.workspaceId,
		"done",
	);
	if (statusId === null) return unavailable();
	return {
		available: true,
		source: "tracker",
		statusId,
		slot: "done",
	};
}

/**
 * Resolve the canonical source-specific target used by Mark done.
 *
 * This is intentionally pure. The caller supplies already-authorized,
 * batched Board geometry and Tracker vocabulary rows, while the existing
 * source mapping helpers remain the single implementation of their rules.
 */
export function resolveMyWorkDoneTarget(
	candidate: MyWorkDoneTargetCandidate,
	inputs: MyWorkDoneTargetInputs,
): MyWorkDoneTarget {
	return candidate.source === "board"
		? resolveBoardDoneTarget(candidate, inputs)
		: resolveTrackerDoneTarget(candidate, inputs);
}

export const resolveDoneTarget = resolveMyWorkDoneTarget;
