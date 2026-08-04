import { Calendar, ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { columnColorPreviewStyle } from "../lib/columnColorUtils";
import {
	assigneeInitials,
	formatDueDate,
	isCardDone,
	isDueOverdue,
} from "../lib/boardViewUtils";
import type { Card, Column } from "../types";
import {
	type PickerOption,
	TrackerPropertyPicker,
} from "./tracker/TrackerPropertyPicker";

interface Props {
	columns: Column[];
	onOpenCard: (card: Card) => void;
	onColumnChange: (card: Card, toColumnId: number) => void;
}

function ColumnDot({
	color,
	size = 10,
}: {
	color: string | null;
	size?: number;
}) {
	return (
		<span
			className="shrink-0 rounded-full border border-neutral-300/60"
			style={{ width: size, height: size, ...columnColorPreviewStyle(color) }}
			aria-hidden
		/>
	);
}

function ListRow({
	card,
	columns,
	currentColumn,
	onOpenCard,
	onColumnChange,
}: {
	card: Card;
	columns: Column[];
	currentColumn: Column;
	onOpenCard: (card: Card) => void;
	onColumnChange: (card: Card, toColumnId: number) => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const overdue = isDueOverdue(card);
	const done = isCardDone(card) || currentColumn.isDone;

	const columnOptions: PickerOption[] = useMemo(
		() =>
			[...columns]
				.sort((a, b) => a.position - b.position)
				.map((column) => ({
					id: String(column.id),
					label: column.title,
					icon: <ColumnDot color={column.color} />,
					selected: column.id === card.columnId,
				})),
		[columns, card.columnId],
	);

	return (
		<div className="group grid h-10 grid-cols-[48px_28px_1fr_80px_88px] items-center gap-2 border-b border-neutral-100 px-3 last:border-b-0 hover:bg-neutral-50">
			<span className="text-xs tabular-nums text-neutral-400">{card.id}</span>
			<span className="flex justify-center">
				<TrackerPropertyPicker
					variant="inline"
					triggerLabel={`${currentColumn.title}, ${card.title}`}
					placeholder="Column"
					searchPlaceholder="Change column…"
					icon={<ColumnDot color={currentColumn.color} size={12} />}
					options={columnOptions}
					open={menuOpen}
					onOpenChange={setMenuOpen}
					onSelect={(id) => {
						const toColumnId = Number(id);
						if (toColumnId === card.columnId) return;
						onColumnChange(card, toColumnId);
					}}
				/>
			</span>
			<button
				type="button"
				onClick={() => onOpenCard(card)}
				className={`min-w-0 truncate text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
					done ? "text-neutral-500 line-through" : "text-neutral-900"
				}`}
			>
				{card.title}
			</button>
			<div className="flex justify-end">
				{card.assignees.length > 0 && (
					<div className="flex -space-x-1.5">
						{card.assignees.slice(0, 2).map((assignee) => (
							<span
								key={assignee.id}
								className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white bg-primary-100 text-[10px] font-semibold text-primary-800"
								title={assignee.displayName}
							>
								{assigneeInitials(assignee.displayName)}
							</span>
						))}
					</div>
				)}
			</div>
			<div className="flex justify-end">
				{card.dueDate && (
					<span
						data-testid={overdue ? "overdue-due-date" : undefined}
						className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
							overdue
								? "bg-error-100 text-error-900"
								: "bg-neutral-100 text-neutral-600"
						}`}
					>
						<Calendar size={11} aria-hidden />
						{formatDueDate(card.dueDate)}
					</span>
				)}
			</div>
		</div>
	);
}

function ListGroup({
	column,
	columns,
	collapsed,
	onToggleCollapsed,
	onOpenCard,
	onColumnChange,
}: {
	column: Column;
	columns: Column[];
	collapsed: boolean;
	onToggleCollapsed: () => void;
	onOpenCard: (card: Card) => void;
	onColumnChange: (card: Card, toColumnId: number) => void;
}) {
	const sortedCards = useMemo(
		() => [...column.cards].sort((a, b) => a.position - b.position),
		[column.cards],
	);

	return (
		<section className="border-b border-neutral-200 last:border-b-0">
			<header className="flex items-center gap-2 bg-neutral-50/80 px-3 py-2">
				<button
					type="button"
					onClick={onToggleCollapsed}
					className="inline-flex items-center gap-2 rounded px-1 py-0.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					aria-expanded={!collapsed}
				>
					{collapsed ? (
						<ChevronRight size={14} className="text-neutral-500" aria-hidden />
					) : (
						<ChevronDown size={14} className="text-neutral-500" aria-hidden />
					)}
					<ColumnDot color={column.color} size={10} />
					<h3 className="text-sm font-semibold text-neutral-900">
						{column.title}
						<span className="ml-1.5 font-normal text-neutral-500">
							{column.cards.length}
						</span>
					</h3>
				</button>
			</header>
			{!collapsed && (
				<div>
					{sortedCards.length === 0 ? (
						<p className="border-t border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-500">
							Nothing here yet.
						</p>
					) : (
						sortedCards.map((card) => (
							<ListRow
								key={card.id}
								card={card}
								columns={columns}
								currentColumn={column}
								onOpenCard={onOpenCard}
								onColumnChange={onColumnChange}
							/>
						))
					)}
				</div>
			)}
		</section>
	);
}

export default function ListView({
	columns,
	onOpenCard,
	onColumnChange,
}: Props) {
	const [collapsedIds, setCollapsedIds] = useState<Set<number>>(() => new Set());

	const handleColumnChange = useCallback(
		(card: Card, toColumnId: number) => {
			if (toColumnId === card.columnId) return;
			setCollapsedIds((prev) => {
				if (!prev.has(toColumnId)) return prev;
				const next = new Set(prev);
				next.delete(toColumnId);
				return next;
			});
			onColumnChange(card, toColumnId);
		},
		[onColumnChange],
	);

	if (columns.length === 0) {
		return (
			<div
				data-testid="list-view"
				className="flex items-center justify-center rounded-xl border border-neutral-200 bg-white px-6 py-16 shadow-sm"
			>
				<p className="text-sm text-neutral-500">Nothing here yet.</p>
			</div>
		);
	}

	return (
		<div
			data-testid="list-view"
			className="mx-auto w-full max-w-[1100px] overflow-visible rounded-xl border border-neutral-200 bg-white shadow-sm"
		>
			<div className="grid grid-cols-[48px_28px_1fr_80px_88px] gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] font-medium tracking-wide text-neutral-500 uppercase">
				<span>ID</span>
				<span />
				<span>Title</span>
				<span className="text-right">Assignee</span>
				<span className="text-right">Due</span>
			</div>
			{columns.map((column) => (
				<ListGroup
					key={column.id}
					column={column}
					columns={columns}
					collapsed={collapsedIds.has(column.id)}
					onToggleCollapsed={() =>
						setCollapsedIds((prev) => {
							const next = new Set(prev);
							if (next.has(column.id)) next.delete(column.id);
							else next.add(column.id);
							return next;
						})
					}
					onOpenCard={onOpenCard}
					onColumnChange={handleColumnChange}
				/>
			))}
		</div>
	);
}
