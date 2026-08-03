import {
	addMonths,
	format,
	isToday,
	startOfMonth,
	subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { SaveCardResult } from "../context/BoardContext";
import { isDueOverdue } from "../lib/boardViewUtils";
import { buildMonthGrid } from "../lib/calendarGrid";
import type { Card, Column } from "../types";
import CalendarDayModal from "./CalendarDayModal";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MAX_VISIBLE_CHIPS = 2;

export default function CalendarView({
	columns,
	onOpenCard: _onOpenCard,
	saveCard: _saveCard,
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

			<div className="grid grid-cols-7">
				{grid.map((cell) => {
					const cards = cardsByDate.get(cell.iso) ?? [];
					const hideChips = modalDate === cell.iso;
					const visible = hideChips ? [] : cards.slice(0, MAX_VISIBLE_CHIPS);
					const overflow = hideChips ? 0 : cards.length - MAX_VISIBLE_CHIPS;
					const showOverdue = cards.some(isDueOverdue);
					const todayCell = isToday(cell.date);

					return (
						<button
							key={cell.iso}
							type="button"
							data-testid={`date-cell-${cell.iso}`}
							id={`date-${cell.iso}`}
							onClick={() => handleCellClick(cell.iso, cards)}
							className={`flex min-h-24 flex-col border-b border-r border-neutral-200 p-1.5 text-left transition-colors hover:bg-primary-100/30 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600 ${
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
									<span
										key={card.id}
										id={`calendar-card-${card.id}`}
										className="truncate rounded bg-primary-100 px-1.5 py-0.5 text-[11px] font-medium text-primary-800"
									>
										{card.title}
									</span>
								))}
								{overflow > 0 && (
									<span className="text-[11px] font-medium text-neutral-500">
										+{overflow} more
									</span>
								)}
							</div>
						</button>
					);
				})}
			</div>

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
