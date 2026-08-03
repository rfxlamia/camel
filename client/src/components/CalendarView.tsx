import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	addMonths,
	format,
	isToday,
	startOfMonth,
	subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { SaveCardResult } from "../context/BoardContext";
import { isDueOverdue } from "../lib/boardViewUtils";
import { buildMonthGrid, type CalendarGridCell } from "../lib/calendarGrid";
import type { Card, Column } from "../types";
import CalendarConflictNotice from "./CalendarConflictNotice";
import CalendarDayModal from "./CalendarDayModal";
import UnscheduledTray from "./UnscheduledTray";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MAX_VISIBLE_CHIPS = 2;

type CardDragSource = "calendar" | "tray";

function parseCardDragId(
	id: string | number,
): { cardId: number; source: CardDragSource } | null {
	const str = String(id);
	if (str.startsWith("calendar-card-")) {
		const cardId = Number(str.slice("calendar-card-".length));
		return Number.isFinite(cardId) ? { cardId, source: "calendar" } : null;
	}
	if (str.startsWith("tray-card-")) {
		const cardId = Number(str.slice("tray-card-".length));
		return Number.isFinite(cardId) ? { cardId, source: "tray" } : null;
	}
	return null;
}

function parseDateDropId(id: string | number): string | null {
	const str = String(id);
	if (!str.startsWith("date-")) return null;
	return str.slice("date-".length);
}

function isTrayDropId(id: string | number): boolean {
	return String(id) === "unscheduled-tray";
}

function CalendarCardChip({
	card,
	showConflict,
	onConflictDismiss,
}: {
	card: Card;
	showConflict: boolean;
	onConflictDismiss: () => void;
}) {
	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useDraggable({ id: `calendar-card-${card.id}` });

	const style = transform
		? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
		: undefined;

	return (
		<span
			ref={setNodeRef}
			style={style}
			id={`calendar-card-${card.id}`}
			className={`truncate rounded bg-primary-100 px-1.5 py-0.5 text-[11px] font-medium text-primary-800 ${
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

function CalendarDateCell({
	cell,
	cards,
	hideChips,
	onCellClick,
	conflictCardIds,
	onConflictDismiss,
}: {
	cell: CalendarGridCell;
	cards: Card[];
	hideChips: boolean;
	onCellClick: (iso: string, cards: Card[]) => void;
	conflictCardIds: Set<number>;
	onConflictDismiss: (cardId: number) => void;
}) {
	const { setNodeRef } = useDroppable({ id: `date-${cell.iso}` });

	const visible = hideChips ? [] : cards.slice(0, MAX_VISIBLE_CHIPS);
	const overflow = hideChips ? 0 : cards.length - MAX_VISIBLE_CHIPS;
	const showOverdue = cards.some(isDueOverdue);
	const todayCell = isToday(cell.date);

	return (
		<div
			ref={setNodeRef}
			id={`date-${cell.iso}`}
			data-testid={`date-cell-${cell.iso}`}
			role="button"
			tabIndex={0}
			onClick={() => onCellClick(cell.iso, cards)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onCellClick(cell.iso, cards);
				}
			}}
			className={`flex min-h-24 cursor-pointer flex-col border-b border-r border-neutral-200 p-1.5 text-left transition-colors hover:bg-primary-100/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600 ${
				cell.inMonth ? "bg-white" : "bg-neutral-50"
			}`}
		>
			<span className="mb-1 flex items-center gap-1">
				<span
					className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${
						todayCell
							? "bg-primary-600 text-white"
							: cell.inMonth
								? "text-neutral-900"
								: "text-neutral-400"
					}`}
				>
					{format(cell.date, "d")}
				</span>
				{showOverdue && (
					<span
						data-testid="overdue-indicator"
						className="h-1.5 w-1.5 rounded-full bg-error-500"
						aria-label="Overdue"
					/>
				)}
			</span>
			<div className="flex flex-col gap-0.5 overflow-hidden">
				{visible.map((card) => (
					<CalendarCardChip
						key={card.id}
						card={card}
						showConflict={conflictCardIds.has(card.id)}
						onConflictDismiss={() => onConflictDismiss(card.id)}
					/>
				))}
				{overflow > 0 && (
					<span className="text-[11px] font-medium text-neutral-500">
						+{overflow} more
					</span>
				)}
			</div>
		</div>
	);
}

export default function CalendarView({
	columns,
	onOpenCard: _onOpenCard,
	saveCard,
}: {
	columns: Column[];
	onOpenCard: (card: Card) => void;
	saveCard: (
		id: number,
		patch: { dueDate?: string | null; version?: number },
	) => Promise<SaveCardResult>;
}) {
	const navigate = useNavigate();
	const [month, setMonth] = useState(() => startOfMonth(new Date()));
	const [modalDate, setModalDate] = useState<string | null>(null);
	const [conflictCardIds, setConflictCardIds] = useState<Set<number>>(
		new Set(),
	);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	const cardsByDate = useMemo(() => {
		const map = new Map<string, Card[]>();
		for (const col of columns) {
			for (const card of col.cards) {
				if (card.dueDate === null) continue;
				const list = map.get(card.dueDate) ?? [];
				list.push(card);
				map.set(card.dueDate, list);
			}
		}
		return map;
	}, [columns]);

	const cardById = useMemo(() => {
		const map = new Map<number, Card>();
		for (const col of columns) {
			for (const card of col.cards) {
				map.set(card.id, card);
			}
		}
		return map;
	}, [columns]);

	const grid = useMemo(() => buildMonthGrid(month), [month]);
	const modalCards = modalDate ? (cardsByDate.get(modalDate) ?? []) : [];

	const handleCellClick = (iso: string, cards: Card[]) => {
		if (cards.length === 1) {
			navigate(`/board/card/${cards[0]!.id}`);
			return;
		}
		if (cards.length > 1) {
			setModalDate(iso);
		}
	};

	const dismissConflict = useCallback((cardId: number) => {
		setConflictCardIds((prev) => {
			const next = new Set(prev);
			next.delete(cardId);
			return next;
		});
	}, []);

	const showConflict = useCallback((cardId: number) => {
		setConflictCardIds((prev) => new Set(prev).add(cardId));
	}, []);

	const handleDragEnd = useCallback(
		async (event: DragEndEvent) => {
			const { active, over } = event;
			if (!over) return;

			const drag = parseCardDragId(active.id);
			if (!drag) return;

			const card = cardById.get(drag.cardId);
			if (!card) return;

			if (isTrayDropId(over.id)) {
				if (drag.source === "tray" || card.dueDate === null) return;

				const result = await saveCard(drag.cardId, {
					dueDate: null,
					version: card.version,
				});
				if (result === "conflict") {
					showConflict(drag.cardId);
				}
				return;
			}

			const targetDate = parseDateDropId(over.id);
			if (targetDate === null || card.dueDate === targetDate) return;

			const result = await saveCard(drag.cardId, {
				dueDate: targetDate,
				version: card.version,
			});
			if (result === "conflict") {
				showConflict(drag.cardId);
			}
		},
		[cardById, saveCard, showConflict],
	);

	return (
		<div
			data-testid="calendar-view"
			className="mx-auto w-full max-w-5xl rounded-xl border border-neutral-200 bg-white shadow-sm"
		>
			<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
				<h2 className="text-base font-semibold text-neutral-900">
					{format(month, "MMMM yyyy")}
				</h2>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => setMonth((m) => subMonths(m, 1))}
						className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						aria-label="Previous month"
					>
						<ChevronLeft size={18} aria-hidden />
					</button>
					<button
						type="button"
						onClick={() => setMonth(startOfMonth(new Date()))}
						className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Today
					</button>
					<button
						type="button"
						onClick={() => setMonth((m) => addMonths(m, 1))}
						className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						aria-label="Next month"
					>
						<ChevronRight size={18} aria-hidden />
					</button>
				</div>
			</div>

			<div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50">
				{WEEKDAYS.map((day) => (
					<div
						key={day}
						className="px-2 py-2 text-center text-xs font-medium text-neutral-500"
					>
						{day}
					</div>
				))}
			</div>

			<DndContext sensors={sensors} onDragEnd={handleDragEnd}>
				<div className="grid grid-cols-7">
					{grid.map((cell) => {
						const cards = cardsByDate.get(cell.iso) ?? [];
						const hideChips = modalDate === cell.iso;

						return (
							<CalendarDateCell
								key={cell.iso}
								cell={cell}
								cards={cards}
								hideChips={hideChips}
								onCellClick={handleCellClick}
								conflictCardIds={conflictCardIds}
								onConflictDismiss={dismissConflict}
							/>
						);
					})}
				</div>
				<UnscheduledTray
					columns={columns}
					saveCard={saveCard}
					onConflict={showConflict}
					conflictCardIds={conflictCardIds}
					onConflictDismiss={dismissConflict}
				/>
			</DndContext>

			{modalDate !== null && (
				<CalendarDayModal
					cards={modalCards}
					onClose={() => setModalDate(null)}
					onSelectCard={(card) => {
						setModalDate(null);
						navigate(`/board/card/${card.id}`);
					}}
				/>
			)}
		</div>
	);
}
