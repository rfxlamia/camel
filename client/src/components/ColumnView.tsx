import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState } from "react";
import type { Card, Column } from "../types";
import { wipStatus } from "../types";
import CardView from "./CardView";

interface Props {
	column: Column;
	onOpenCard: (card: Card) => void;
	onAddCard: (columnId: number, title: string) => Promise<void>;
	onUpdateColumn: (
		id: number,
		patch: {
			title?: string;
			wipLimit?: number | null;
			policy?: string;
			isDone?: boolean;
		},
	) => Promise<void>;
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
			<span className="rounded-md bg-neutral-200 px-1.5 py-0.5 text-xs font-semibold text-neutral-700">
				{column.cards.length}
			</span>
		);
	}
	return (
		<span
			title={status === "under" ? "Within WIP limit" : "WIP limit reached"}
			className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${WIP_BADGE_STYLES[status]}`}
		>
			{column.cards.length} / {column.wipLimit}
		</span>
	);
}

function ColumnSettings({
	column,
	onUpdateColumn,
	onClose,
}: {
	column: Column;
	onUpdateColumn: Props["onUpdateColumn"];
	onClose: () => void;
}) {
	const [title, setTitle] = useState(column.title);
	const [wipLimit, setWipLimit] = useState(
		column.wipLimit === null ? "" : String(column.wipLimit),
	);
	const [policy, setPolicy] = useState(column.policy);
	const [isDone, setIsDone] = useState(column.isDone);

	const save = async () => {
		const limit = wipLimit.trim() === "" ? null : Number(wipLimit);
		await onUpdateColumn(column.id, {
			title: title.trim() || column.title,
			wipLimit:
				limit !== null && (!Number.isInteger(limit) || limit < 1)
					? null
					: limit,
			policy,
			isDone,
		});
		onClose();
	};

	const inputClass =
		"w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

	return (
		<div className="mt-2 space-y-2 rounded-md border border-neutral-200 bg-white p-3">
			<label className="block">
				<span className="text-xs font-medium text-neutral-700">
					Column name
				</span>
				<input
					className={inputClass}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Column name"
				/>
			</label>
			<label className="block">
				<span className="text-xs font-medium text-neutral-700">
					WIP limit (leave empty for none)
				</span>
				<input
					className={inputClass}
					value={wipLimit}
					onChange={(e) => setWipLimit(e.target.value)}
					type="number"
					min={1}
					placeholder="No limit"
				/>
			</label>
			<label className="block">
				<span className="text-xs font-medium text-neutral-700">Policy</span>
				<textarea
					className={inputClass}
					value={policy}
					onChange={(e) => setPolicy(e.target.value)}
					rows={2}
					placeholder="When does a card belong here?"
				/>
			</label>
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={isDone}
					onChange={(e) => setIsDone(e.target.checked)}
					className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
				/>
				<span className="text-xs font-medium text-neutral-700">
					Mark as Done column
				</span>
			</label>
			<p className="-mt-1 text-xs text-neutral-500">
				Cards moved here will be marked as completed
			</p>
			<div className="flex gap-2">
				<button
					onClick={save}
					className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Save
				</button>
				<button
					onClick={onClose}
					className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

function AddCard({
	column,
	onAddCard,
}: {
	column: Column;
	onAddCard: Props["onAddCard"];
}) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");
	const atLimit =
		column.wipLimit !== null && column.cards.length >= column.wipLimit;

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				disabled={atLimit}
				title={atLimit ? "WIP limit reached" : undefined}
				className="mt-1 w-full rounded-md px-3 py-1.5 text-left text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
			>
				+ Add card
			</button>
		);
	}

	const submit = async () => {
		if (title.trim() === "") return;
		await onAddCard(column.id, title.trim());
		setTitle("");
		setOpen(false);
	};

	return (
		<div className="mt-1 space-y-2">
			<textarea
				autoFocus
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						void submit();
					}
					if (e.key === "Escape") setOpen(false);
				}}
				placeholder="What needs doing?"
				rows={2}
				className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none"
			/>
			<div className="flex gap-2">
				<button
					onClick={() => void submit()}
					className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Add to board
				</button>
				<button
					onClick={() => setOpen(false)}
					className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

export default function ColumnView({
	column,
	onOpenCard,
	onAddCard,
	onUpdateColumn,
}: Props) {
	const [editing, setEditing] = useState(false);
	const { setNodeRef } = useDroppable({
		id: `col-${column.id}`,
		data: { type: "column", columnId: column.id },
	});
	const over =
		column.wipLimit !== null && column.cards.length > column.wipLimit;

	return (
		<section
			className={`flex w-72 shrink-0 flex-col rounded-lg border p-2 ${
				over
					? "border-error-500 bg-error-100/40"
					: "border-neutral-200 bg-neutral-200/50"
			}`}
		>
			<header className="px-1 pt-1">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<h2 className="text-sm font-semibold text-neutral-800">
							{column.title}
						</h2>
						<WipBadge column={column} />
					</div>
					<button
						onClick={() => setEditing((v) => !v)}
						aria-label={`Edit ${column.title} column`}
						className="rounded-md px-1.5 py-0.5 text-xs font-medium text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Edit
					</button>
				</div>
				{column.policy && !editing && (
					<p className="mt-1 text-xs leading-snug text-neutral-600">
						{column.policy}
					</p>
				)}
				{editing && (
					<ColumnSettings
						column={column}
						onUpdateColumn={onUpdateColumn}
						onClose={() => setEditing(false)}
					/>
				)}
			</header>

			<SortableContext
				items={column.cards.map((c) => `card-${c.id}`)}
				strategy={verticalListSortingStrategy}
			>
				<div ref={setNodeRef} className="mt-2 flex min-h-16 flex-col gap-2">
					{column.cards.length === 0 && (
						<p className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500">
							Nothing here yet.
						</p>
					)}
					{column.cards.map((card) => (
						<CardView key={card.id} card={card} onOpen={onOpenCard} />
					))}
				</div>
			</SortableContext>

			<AddCard column={column} onAddCard={onAddCard} />
		</section>
	);
}
