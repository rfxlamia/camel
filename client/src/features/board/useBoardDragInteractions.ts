import {
	type DragEndEvent,
	type DragOverEvent,
	type DragStartEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useRef, useState } from "react";
import { ApiError, api } from "../../api";
import type { useShowToast } from "../../shared/ToastContext";
import type { Card, Column } from "../../types";
import type { useBoard } from "./BoardContext";
import { moveCardToColumn, revertCardMove } from "./boardColumnMoves";
import { cardIdFrom, columnIdFrom, findColumnOfCard } from "./boardPageUtils";
export function useBoardDragInteractions({
	activeWorkspaceId,
	board,
	showToast,
}: {
	activeWorkspaceId: number | null;
	board: ReturnType<typeof useBoard>;
	showToast: ReturnType<typeof useShowToast>;
}) {
	const { columns, setColumns, refresh, cancelScheduledRefresh, deleteCard } =
		board;
	const [activeCard, setActiveCard] = useState<Card | null>(null);
	const snapshotRef = useRef<Column[] | null>(null);
	const inFlightColumnRef = useRef<Set<number>>(new Set());
	const queuedColumnRef = useRef<Map<number, number>>(new Map());
	const columnsRef = useRef<Column[] | null>(columns);
	columnsRef.current = columns;
	const applyColumns = useCallback(
		(updater: (cols: Column[]) => Column[]) => {
			setColumns((cols) => {
				if (!cols) return cols;
				const next = updater(cols);
				columnsRef.current = next;
				return next;
			});
		},
		[setColumns],
	);
	const changeColumn = useCallback(
		async (card: Card, toColumnId: number) => {
			const currentColumns = columnsRef.current;
			if (
				!currentColumns ||
				activeWorkspaceId === null ||
				toColumnId === card.columnId
			) {
				return;
			}
			const targetCol = currentColumns.find((col) => col.id === toColumnId);
			if (!targetCol) return;
			const sourceCol = findColumnOfCard(currentColumns, card.id);
			if (!sourceCol) return;
			if (inFlightColumnRef.current.has(card.id)) {
				queuedColumnRef.current.set(card.id, toColumnId);
				return;
			}
			inFlightColumnRef.current.add(card.id);
			const restore = {
				columnId: card.columnId,
				index: sourceCol.cards.findIndex((c) => c.id === card.id),
				card,
			};
			const insertAt = targetCol.cards.filter((c) => c.id !== card.id).length;
			applyColumns((cols) =>
				moveCardToColumn(cols, card.id, toColumnId, insertAt),
			);
			try {
				cancelScheduledRefresh();
				const updated = await api.moveCard(activeWorkspaceId, card.id, {
					toColumnId,
					index: insertAt,
					version: card.version,
				});
				applyColumns((cols) =>
					cols.map((col) => ({
						...col,
						cards: col.cards.map((c) => (c.id === card.id ? updated : c)),
					})),
				);
				await refresh();
			} catch (err) {
				if (err instanceof ApiError && err.code === "version_conflict") {
					applyColumns((cols) => revertCardMove(cols, card.id, restore));
					showToast(
						"Someone else moved this card first — board refreshed.",
						"warning",
					);
					queuedColumnRef.current.delete(card.id);
					await refresh();
				} else {
					applyColumns((cols) => revertCardMove(cols, card.id, restore));
					if (err instanceof ApiError && err.status === 409) {
						showToast("WIP limit reached — finish something first.", "warning");
					} else {
						showToast(
							"Couldn't move the card. Check your connection and try again.",
							"error",
						);
					}
				}
			} finally {
				inFlightColumnRef.current.delete(card.id);
				const queued = queuedColumnRef.current.get(card.id);
				if (queued !== undefined) {
					queuedColumnRef.current.delete(card.id);
					const latest = columnsRef.current;
					const liveCard =
						latest?.flatMap((col) => col.cards).find((c) => c.id === card.id) ??
						card;
					void changeColumn(liveCard, queued);
				}
			}
		},
		[
			activeWorkspaceId,
			applyColumns,
			cancelScheduledRefresh,
			refresh,
			showToast,
		],
	);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);
	const onDragStart = (event: DragStartEvent) => {
		if (!columns) return;
		snapshotRef.current = structuredClone(columns);
		const cardId = cardIdFrom(event.active.id);
		if (cardId === null) return;
		const col = findColumnOfCard(columns, cardId);
		setActiveCard(col?.cards.find((c) => c.id === cardId) ?? null);
	};
	const onDragOver = (event: DragOverEvent) => {
		const { active, over } = event;
		if (!over || !columns) return;
		const cardId = cardIdFrom(active.id);
		if (cardId === null) return;
		const sourceCol = findColumnOfCard(columns, cardId);
		const targetColId =
			columnIdFrom(over.id) ??
			findColumnOfCard(columns, cardIdFrom(over.id) ?? -1)?.id;
		if (!sourceCol || targetColId === undefined || sourceCol.id === targetColId)
			return;
		setColumns((cols) => {
			if (!cols) return cols;
			const overCardId = cardIdFrom(over.id);
			const targetCards =
				cols
					.find((col) => col.id === targetColId)
					?.cards.filter((c) => c.id !== cardId) ?? [];
			const overIndex =
				overCardId === null
					? targetCards.length
					: targetCards.findIndex((c) => c.id === overCardId);
			const insertAt = overIndex === -1 ? targetCards.length : overIndex;
			return moveCardToColumn(cols, cardId, targetColId, insertAt);
		});
	};
	const revert = useCallback(() => {
		if (snapshotRef.current) setColumns(snapshotRef.current);
		snapshotRef.current = null;
	}, [setColumns]);
	const onDragEnd = async (event: DragEndEvent) => {
		setActiveCard(null);
		const { active, over } = event;
		if (!columns) return;
		const cardId = cardIdFrom(active.id);
		if (cardId === null || !over) {
			revert();
			return;
		}
		if (over.id === "trash") {
			setColumns((cols) =>
				cols
					? cols.map((c) => ({
							...c,
							cards: c.cards.filter((card) => card.id !== cardId),
						}))
					: cols,
			);
			try {
				cancelScheduledRefresh();
				await deleteCard(cardId);
				snapshotRef.current = null;
			} catch {
				revert();
				showToast(
					"Couldn't delete the card. Check your connection and try again.",
					"error",
				);
			}
			return;
		}
		const col = findColumnOfCard(columns, cardId);
		if (!col) {
			revert();
			return;
		}
		let index = col.cards.findIndex((c) => c.id === cardId);
		const overCardId = cardIdFrom(over.id);
		if (overCardId !== null && overCardId !== cardId) {
			const overCol = findColumnOfCard(columns, overCardId);
			if (overCol && overCol.id === col.id) {
				const from = index;
				const to = overCol.cards.findIndex((c) => c.id === overCardId);
				if (from !== to) {
					index = to;
					setColumns(
						columns.map((c) =>
							c.id === col.id
								? { ...c, cards: arrayMove(c.cards, from, to) }
								: c,
						),
					);
				}
			}
		}
		const before = snapshotRef.current;
		const movedAcross =
			before && findColumnOfCard(before, cardId)?.id !== col.id;
		const reordered =
			index !==
			before
				?.find((c) => c.id === col.id)
				?.cards.findIndex((c) => c.id === cardId);
		if (!movedAcross && !reordered) {
			snapshotRef.current = null;
			return;
		}
		const version = before
			? findColumnOfCard(before, cardId)?.cards.find((c) => c.id === cardId)
					?.version
			: undefined;
		if (activeWorkspaceId === null) {
			revert();
			return;
		}
		try {
			cancelScheduledRefresh();
			await api.moveCard(activeWorkspaceId, cardId, {
				toColumnId: col.id,
				index,
				version,
			});
			snapshotRef.current = null;
			await refresh();
		} catch (err) {
			revert();
			if (err instanceof ApiError && err.code === "version_conflict") {
				showToast(
					"Someone else moved this card first — board refreshed.",
					"warning",
				);
				await refresh();
			} else if (err instanceof ApiError && err.status === 409) {
				showToast("WIP limit reached — finish something first.", "warning");
			} else {
				showToast(
					"Couldn't move the card. Check your connection and try again.",
					"error",
				);
			}
		}
	};
	return {
		activeCard,
		changeColumn,
		onDragEnd,
		onDragOver,
		onDragStart,
		revert,
		sensors,
		setActiveCard,
	};
}
