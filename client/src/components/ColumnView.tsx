import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Settings2 } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { api } from "../api";
import { useBoard } from "../context/BoardContext";
import type { Card, Column, WorkspaceMember } from "../types";
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
			isSignable?: boolean;
			signableAssigneeId?: number | null;
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

function ColumnSettings({
	column,
	onUpdateColumn,
	onClose,
}: {
	column: Column;
	onUpdateColumn: Props["onUpdateColumn"];
	onClose: () => void;
}) {
	const { activeWorkspaceId } = useBoard();
	const [title, setTitle] = useState(column.title);
	const [wipLimit, setWipLimit] = useState(
		column.wipLimit === null ? "" : String(column.wipLimit),
	);
	const [policy, setPolicy] = useState(column.policy);
	const [isDone, setIsDone] = useState(column.isDone);
	const [isSignable, setIsSignable] = useState(column.isSignable);
	const [signableAssigneeId, setSignableAssigneeId] = useState<number | null>(
		column.signableAssigneeId,
	);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [membersError, setMembersError] = useState(false);

	useEffect(() => {
		if (!isSignable || activeWorkspaceId === null) return;
		let active = true;
		setMembersError(false);
		api
			.getWorkspaceMembers(activeWorkspaceId)
			.then(({ members: m }) => {
				if (!active) return;
				setMembers(m);
				// Validate that signableAssigneeId still exists in the members list
				if (
					signableAssigneeId !== null &&
					!m.some((mem) => mem.userId === signableAssigneeId)
				) {
					setSignableAssigneeId(null);
				}
			})
			.catch(() => {
				if (active) {
					setMembersError(true);
					// Clear signableAssigneeId when we can't verify membership
					setSignableAssigneeId(null);
				}
			});
		return () => {
			active = false;
		};
	}, [isSignable, activeWorkspaceId, signableAssigneeId]);

	const save = async () => {
		const limit = wipLimit.trim() === "" ? null : Number(wipLimit);
		// Sanitize signableAssigneeId: validate against current members or clear if errored
		const sanitizedSignableAssigneeId = isSignable
			? membersError
				? null
				: signableAssigneeId !== null &&
						!members.some((m) => m.userId === signableAssigneeId)
					? null
					: signableAssigneeId
			: null;
		await onUpdateColumn(column.id, {
			title: title.trim() || column.title,
			wipLimit:
				limit !== null && (!Number.isInteger(limit) || limit < 1)
					? null
					: limit,
			policy,
			isDone,
			isSignable,
			signableAssigneeId: sanitizedSignableAssigneeId,
		});
		onClose();
	};

	const inputClass =
		"w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

	return (
		<div className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
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
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={isSignable}
					onChange={(e) => setIsSignable(e.target.checked)}
					className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
				/>
				<span className="text-xs font-medium text-neutral-700">
					Mark as Signable Column
				</span>
			</label>
			<p className="-mt-1 text-xs text-neutral-500">
				Cards moved here will be auto-assigned to the selected member
			</p>
			{isSignable && (
				<label className="block">
					<span className="text-xs font-medium text-neutral-700">
						Auto-assign to
					</span>
					{membersError ? (
						<p className="text-xs text-error-600">
							Failed to load members. Save and reopen to retry.
						</p>
					) : (
						<select
							className={inputClass}
							value={signableAssigneeId ?? ""}
							onChange={(e) =>
								setSignableAssigneeId(
									e.target.value === "" ? null : Number(e.target.value),
								)
							}
						>
							<option value="">No auto-assign</option>
							{members.map((m) => (
								<option key={m.userId} value={m.userId}>
									{m.displayName}
								</option>
							))}
						</select>
					)}
				</label>
			)}
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
				className="mt-2 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-primary-600 transition-colors hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
			>
				<Plus size={15} className="shrink-0" aria-hidden />
				Add card
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
		<div className="mt-2 space-y-2">
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

export default memo(ColumnView);

function ColumnView({ column, onOpenCard, onAddCard, onUpdateColumn }: Props) {
	const [editing, setEditing] = useState(false);
	const { setNodeRef, isOver } = useDroppable({
		id: `col-${column.id}`,
		data: { type: "column", columnId: column.id },
	});
	const over =
		column.wipLimit !== null && column.cards.length > column.wipLimit;

	// Flow rail: WIP-over (red) → done (green) → active/limited (blue) → idle (grey).
	const rail = over
		? "bg-error-500"
		: column.isDone
			? "bg-success-500"
			: column.wipLimit !== null
				? "bg-primary-500"
				: "bg-neutral-300";

	return (
		<section
			className={`flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border shadow-[0_1px_2px_oklch(28%_0.044_250_/_0.06)] transition-colors ${
				over
					? "border-error-300 bg-error-100/40"
					: "border-neutral-200 bg-neutral-100"
			}`}
		>
			{/* Flow-state rail */}
			<div className={`h-[3px] w-full ${rail}`} aria-hidden />

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
