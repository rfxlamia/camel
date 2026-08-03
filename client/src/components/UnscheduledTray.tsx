import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import type { SaveCardResult } from "../context/BoardContext";
import { isCardDone } from "../lib/boardViewUtils";
import type { Card, Column } from "../types";
import CalendarConflictNotice from "./CalendarConflictNotice";

function TrayCardChip({
	card,
	showConflict,
	onConflictDismiss,
}: {
	card: Card;
	showConflict: boolean;
	onConflictDismiss: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useDraggable({ id: `tray-card-${card.id}` });

	const style = transform
		? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
		: undefined;

	return (
		<span
			ref={setNodeRef}
			style={style}
			id={`tray-card-${card.id}`}
			className={`rounded border border-dashed border-neutral-300 bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-800 ${
				isDragging ? "opacity-50" : ""
			}`}
			{...listeners}
			{...attributes}
		>
			{card.title}
			{showConflict && (
				<CalendarConflictNotice onDismiss={onConflictDismiss} />
			)}
		</span>
	);
}

export default function UnscheduledTray({
	columns,
	saveCard: _saveCard,
	onConflict: _onConflict,
	conflictCardIds = new Set<number>(),
	onConflictDismiss,
}: {
	columns: Column[];
	saveCard: (
		id: number,
		patch: { dueDate?: string | null; version?: number },
	) => Promise<SaveCardResult>;
	onConflict: (cardId: number) => void;
	conflictCardIds?: Set<number>;
	onConflictDismiss?: (cardId: number) => void;
}) {
	const { setNodeRef } = useDroppable({ id: "unscheduled-tray" });

	const unscheduledCards = useMemo(() => {
		const cards: Card[] = [];
		for (const col of columns) {
			for (const card of col.cards) {
				if (card.dueDate === null && !isCardDone(card)) {
					cards.push(card);
				}
			}
		}
		return cards;
	}, [columns]);

	return (
		<div
			ref={setNodeRef}
			id="unscheduled-tray"
			data-testid="unscheduled-tray"
			className="border-t border-neutral-200 px-4 py-3"
		>
			<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
				Unscheduled
			</h3>
			{unscheduledCards.length === 0 ? (
				<p className="text-sm text-neutral-500">No unscheduled tasks</p>
			) : (
				<div className="flex flex-wrap gap-2">
					{unscheduledCards.map((card) => (
						<TrayCardChip
							key={card.id}
							card={card}
							showConflict={conflictCardIds.has(card.id)}
							onConflictDismiss={() => onConflictDismiss?.(card.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
