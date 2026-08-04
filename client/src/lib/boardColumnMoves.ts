import type { Card, Column } from "../types";

function findColumnOfCard(
	columns: Column[],
	cardId: number,
): Column | undefined {
	return columns.find((col) => col.cards.some((c) => c.id === cardId));
}

export function moveCardToColumn(
	columns: Column[],
	cardId: number,
	targetColId: number,
	insertAt?: number,
): Column[] {
	const sourceCol = findColumnOfCard(columns, cardId);
	if (!sourceCol) return columns;
	if (sourceCol.id === targetColId) return columns;
	const card = sourceCol.cards.find((c) => c.id === cardId);
	if (!card) return columns;

	return columns.map((col) => {
		if (col.id === sourceCol.id) {
			return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
		}
		if (col.id === targetColId) {
			const cards = col.cards.filter((c) => c.id !== cardId);
			const at = insertAt ?? cards.length;
			const moved = { ...card, columnId: targetColId };
			return {
				...col,
				cards: [...cards.slice(0, at), moved, ...cards.slice(at)],
			};
		}
		return col;
	});
}

export function revertCardMove(
	columns: Column[],
	cardId: number,
	restore: { columnId: number; index: number; card: Card },
): Column[] {
	const without = columns.map((col) => ({
		...col,
		cards: col.cards.filter((c) => c.id !== cardId),
	}));
	return without.map((col) => {
		if (col.id !== restore.columnId) return col;
		const at = Math.min(restore.index, col.cards.length);
		const reverted = { ...restore.card, columnId: restore.columnId };
		return {
			...col,
			cards: [...col.cards.slice(0, at), reverted, ...col.cards.slice(at)],
		};
	});
}
