import {
	type ColumnStatusInput,
	mapColumnSlots,
	type StatusSlot,
	statusIdForSlot,
} from "./column-status-map.js";

export type RemapCardInput = {
	id: number;
	column_id: number;
	status_id: number | null;
	deleted_at?: Date | string | null;
};

export type RemapStatusInput = {
	id: number;
	kind: string;
	slot: StatusSlot | null;
};

export type CardStatusRemap = {
	cardId: number;
	columnId: number;
	fromStatusId: number | null;
	statusId: number;
};

export type RemapPlanInput = {
	beforeColumns: readonly ColumnStatusInput[];
	afterColumns: readonly ColumnStatusInput[];
	cards: readonly RemapCardInput[];
	statuses: readonly RemapStatusInput[];
};

/**
 * Build the status updates needed after a column's done marker changes.
 *
 * The card's column is deliberately not part of the returned mutation: a
 * column is a geometry anchor, while status is the normalized representation
 * of that geometry. Only live cards whose fixed slot changes are returned.
 */
export function buildRemapPlan({
	beforeColumns,
	afterColumns,
	cards,
	statuses,
}: RemapPlanInput): CardStatusRemap[] {
	const beforeSlots = mapColumnSlots(beforeColumns);
	const afterSlots = mapColumnSlots(afterColumns);
	const plan: CardStatusRemap[] = [];

	for (const card of cards) {
		if (card.deleted_at != null) continue;

		const beforeSlot = beforeSlots.get(card.column_id);
		const afterSlot = afterSlots.get(card.column_id);
		if (beforeSlot === undefined || afterSlot === undefined) continue;
		if (beforeSlot === afterSlot) continue;

		const statusId = statusIdForSlot(statuses, afterSlot);
		if (statusId === null) {
			throw new Error(`missing status vocabulary for slot: ${afterSlot}`);
		}
		plan.push({
			cardId: card.id,
			columnId: card.column_id,
			fromStatusId: card.status_id,
			statusId,
		});
	}

	return plan;
}

/** Narrow aliases for callers that describe the operation as status remapping. */
export const planCardStatusRemap = buildRemapPlan;
export const planCardStatusRemaps = buildRemapPlan;
export const buildCardStatusRemapPlan = buildRemapPlan;

export type RemappedStatusSlot = StatusSlot;
