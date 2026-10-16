import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Settings2 } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { BoardCreatePayload } from "../../shared/taskCreateContracts";
import type { Card, Column } from "../../types";
import { wipStatus } from "../../types";
import AddCard from "./AddCard";
import CardView from "./CardView";
import ColumnSettings from "./ColumnSettings";
import { resolveColumnAppearance } from "./columnStyleResolver";

interface Props {
	column: Column;
	onOpenCard: (card: Card) => void;
	onAddCard: (payload: BoardCreatePayload) => Promise<void>;
	onUpdateColumn: (
		id: number,
		patch: {
			title?: string;
			wipLimit?: number | null;
			policy?: string;
			isDone?: boolean;
			isSignable?: boolean;
			signableAssigneeId?: number | null;
			color?: string | null;
		},
	) => Promise<void>;
	onDeleteColumn: (id: number) => Promise<void>;
}

const WIP_BADGE_STYLES: Record<string, string> = {
	under: "bg-primary-100 text-primary-800",
	at: "bg-warning-100 text-warning-900",
	over: "bg-error-100 text-error-900",
};

function WipBadge({ column }: { column: Column }) {
	const status = wipStatus(column.cards.length, column.wipLimit);
	if (status === "unlimited") {
		return (
			<span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-semibold tabular-nums text-neutral-600">
				{column.cards.length}
			</span>
		);
	}
	return (
		<span
			title={status === "under" ? "Within WIP limit" : "WIP limit reached"}
			className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${WIP_BADGE_STYLES[status]}`}
		>
			{column.cards.length} / {column.wipLimit}
		</span>
	);
}

export default memo(ColumnView);

function ColumnView({
	column,
	onOpenCard,
	onAddCard,
	onUpdateColumn,
	onDeleteColumn,
}: Props) {
	const [editing, setEditing] = useState(false);
	const { setNodeRef, isOver } = useDroppable({
		id: `col-${column.id}`,
		data: { type: "column", columnId: column.id },
	});
	const over =
		column.wipLimit !== null && column.cards.length > column.wipLimit;

	const appearance = useMemo(
		() => resolveColumnAppearance(column.color, over),
		[column.color, over],
	);

	const colorClassName =
		appearance.kind === "inline" ? "" : appearance.className;
	const colorStyle =
		appearance.kind === "inline" ? appearance.style : undefined;

	return (
		<section
			className={`flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border shadow-[0_1px_2px_oklch(28%_0.044_250_/_0.06)] transition-colors ${colorClassName}`}
			style={colorStyle}
		>
			<div className="flex min-h-0 flex-1 flex-col p-2">
				<header className="px-1 pt-1">
					<div className="flex items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2">
							<h2 className="truncate text-sm font-semibold tracking-tight text-neutral-800">
								{column.title}
							</h2>
							<WipBadge column={column} />
						</div>
						<button
							onClick={() => setEditing((v) => !v)}
							aria-label={`Edit ${column.title} column`}
							aria-expanded={editing}
							className={`shrink-0 rounded-md p-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
								editing
									? "bg-neutral-200 text-neutral-700"
									: "text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
							}`}
						>
							<Settings2 size={15} aria-hidden />
						</button>
					</div>
					{column.policy && !editing && (
						<p className="mt-1 text-xs leading-snug text-neutral-500">
							{column.policy}
						</p>
					)}
					{editing && (
						<ColumnSettings
							column={column}
							onUpdateColumn={onUpdateColumn}
							onDeleteColumn={onDeleteColumn}
							onClose={() => setEditing(false)}
						/>
					)}
				</header>

				<SortableContext
					items={column.cards.map((c) => `card-${c.id}`)}
					strategy={verticalListSortingStrategy}
				>
					<div
						ref={setNodeRef}
						className={`mt-2 flex min-h-16 flex-col gap-2 rounded-lg transition-colors ${
							isOver ? "bg-primary-100/40" : ""
						}`}
					>
						{column.cards.length === 0 && (
							<p className="rounded-lg border border-dashed border-neutral-300 bg-neutral-100/60 px-3 py-6 text-center text-xs text-neutral-500">
								Nothing here yet.
							</p>
						)}
						{column.cards.map((card) => (
							<CardView key={card.id} card={card} onOpen={onOpenCard} />
						))}
					</div>
				</SortableContext>

				<AddCard column={column} onAddCard={onAddCard} />
			</div>
		</section>
	);
}
