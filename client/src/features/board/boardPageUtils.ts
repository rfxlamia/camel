import type { Column } from "../../types";

export function cardIdFrom(dndId: string | number): number | null {
	const s = String(dndId);
	return s.startsWith("card-") ? Number(s.slice(5)) : null;
}

export function columnIdFrom(dndId: string | number): number | null {
	const s = String(dndId);
	return s.startsWith("col-") ? Number(s.slice(4)) : null;
}

export function findColumnOfCard(
	columns: Column[],
	cardId: number,
): Column | undefined {
	return columns.find((col) => col.cards.some((c) => c.id === cardId));
}
