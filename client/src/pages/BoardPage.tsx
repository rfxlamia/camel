import {
	closestCorners,
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Columns3, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate } from "react-router";
import { ApiError, api } from "../api";
import { CardBody } from "../components/CardView";
import ColumnView from "../components/ColumnView";
import EmptyState from "../components/EmptyState";
import TrashZone from "../components/TrashZone";
import { useBoard } from "../context/BoardContext";
import type { Card, Column } from "../types";

/* ------------------------------------------------------------------ */
/*  Board toolbar — live flow summary, gives the board a sense of place */
/* ------------------------------------------------------------------ */

function StatChip({
	dot,
	value,
	label,
}: {
	dot: string;
	value: number | string;
	label: string;
}) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-600">
			<span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
			<span className="font-semibold tabular-nums text-neutral-900">
				{value}
			</span>
			{label}
		</span>
	);
}

function BoardToolbar({ columns }: { columns: Column[] }) {
	const s = useMemo(() => {
		let total = 0;
		let active = 0;
		let done = 0;
		let over = 0;
		for (const col of columns) {
			total += col.cards.length;
			if (col.wipLimit !== null && col.cards.length > col.wipLimit) over++;
			for (const c of col.cards) {
				if (c.doneAt) done++;
				else if (c.startedAt) active++;
			}
		}
		return { total, active, done, over, cols: columns.length };
	}, [columns]);

	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 md:px-6">
			<StatChip dot="bg-neutral-300" value={s.total} label="cards" />
			<StatChip dot="bg-primary-400" value={s.active} label="in progress" />
			<StatChip dot="bg-success-500" value={s.done} label="done" />
			<span className="hidden text-neutral-300 sm:inline" aria-hidden>
				·
			</span>
			<span className="hidden text-xs text-neutral-500 sm:inline">
				{s.cols} column{s.cols === 1 ? "" : "s"}
			</span>
			<div className="ml-auto">
				{s.over > 0 ? (
					<span className="inline-flex items-center gap-1.5 rounded-md bg-error-100 px-2.5 py-1 text-xs font-medium text-error-900">
						<span
							className="h-1.5 w-1.5 rounded-full bg-error-500"
							aria-hidden
						/>
						WIP over in {s.over} column{s.over === 1 ? "" : "s"}
					</span>
				) : (
					<span className="inline-flex items-center gap-1.5 rounded-md bg-success-100 px-2.5 py-1 text-xs font-medium text-success-900">
						<span
							className="h-1.5 w-1.5 rounded-full bg-success-500"
							aria-hidden
						/>
						Flow healthy
					</span>
				)}
			</div>
		</div>
	);
}

function cardIdFrom(dndId: string | number): number | null {
	const s = String(dndId);
	return s.startsWith("card-") ? Number(s.slice(5)) : null;
}

function columnIdFrom(dndId: string | number): number | null {
	const s = String(dndId);
	return s.startsWith("col-") ? Number(s.slice(4)) : null;
}

function findColumnOfCard(
	columns: Column[],
	cardId: number,
): Column | undefined {
	return columns.find((col) => col.cards.some((c) => c.id === cardId));
}

function AddColumn({
	onAddColumn,
}: {
	onAddColumn: (title: string) => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");

	if (!open) {
		return (
			<button
				onClick={() => setOpen(true)}
				className="flex w-72 shrink-0 items-center gap-1.5 self-start rounded-xl border border-dashed border-neutral-300 px-3 py-2.5 text-left text-sm font-medium text-neutral-500 transition-colors hover:border-primary-300 hover:bg-primary-100/50 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				<Plus size={16} className="shrink-0" aria-hidden />
				Add column
			</button>
		);
	}

	const submit = async () => {
		if (title.trim() === "") return;
		await onAddColumn(title.trim());
		setTitle("");
		setOpen(false);
	};

	return (
		<div className="w-72 shrink-0 self-start space-y-2 rounded-xl border border-neutral-200 bg-neutral-100 p-3 shadow-sm">
			<input
				autoFocus
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void submit();
					}
					if (e.key === "Escape") setOpen(false);
				}}
				placeholder="Column title"
				className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none"
			/>
			<div className="flex gap-2">
				<button
					onClick={() => void submit()}
					className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Add column
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

export default function BoardPage() {
	const {
		columns,
		setColumns,
		loadError,
		refresh,
		cancelScheduledRefresh,
		showToast,
		deleteCard,
		activeWorkspaceId,
	} = useBoard();
	const navigate = useNavigate();
	const [activeCard, setActiveCard] = useState<Card | null>(null);
	const snapshotRef = useRef<Column[] | null>(null);

	// Card click opens the route-driven context panel (deep-linkable URL).
	const onOpenCard = useCallback(
		(card: Card) => navigate(`/board/card/${card.id}`),
		[navigate],
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

		// Move the card across columns in local state so the preview follows.
		setColumns((cols) => {
			if (!cols) return cols;
			const card = sourceCol.cards.find((c) => c.id === cardId);
			if (!card) return cols;
			const overCardId = cardIdFrom(over.id);
			return cols.map((col) => {
				if (col.id === sourceCol.id) {
					return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
				}
				if (col.id === targetColId) {
					const cards = col.cards.filter((c) => c.id !== cardId);
					const overIndex =
						overCardId === null
							? cards.length
							: cards.findIndex((c) => c.id === overCardId);
					const insertAt = overIndex === -1 ? cards.length : overIndex;
					const moved = { ...card, columnId: col.id };
					return {
						...col,
						cards: [
							...cards.slice(0, insertAt),
							moved,
							...cards.slice(insertAt),
						],
					};
				}
				return col;
			});
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

		// Dropped on the trash target: soft delete the card. ContextPanel (if open
		// for this card) self-closes once refresh removes it from columns.
		if (over.id === "trash") {
			// Remove the card from local state immediately so it vanishes on drop
			// instead of lingering in the board until the request + refresh land.
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

		// Same-column reorder: compute the final index from the over target.
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

		// Version from the pre-drag snapshot: detects a concurrent move by a teammate.
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

	const onAddCard = useCallback(
		async (columnId: number, title: string) => {
			if (activeWorkspaceId === null) return;
			try {
				cancelScheduledRefresh();
				await api.createCard(activeWorkspaceId, { columnId, title });
				await refresh();
			} catch (err) {
				if (err instanceof ApiError && err.status === 409) {
					showToast("WIP limit reached — finish something first.", "warning");
				} else {
					showToast(
						"Couldn't add the card. Check your connection and try again.",
						"error",
					);
				}
			}
		},
		[activeWorkspaceId, cancelScheduledRefresh, refresh, showToast],
	);

	const onUpdateColumn = useCallback(
		async (
			id: number,
			patch: {
				title?: string;
				wipLimit?: number | null;
				policy?: string;
				isDone?: boolean;
				isSignable?: boolean;
				signableAssigneeId?: number | null;
			},
		) => {
			if (activeWorkspaceId === null) return;
			try {
				cancelScheduledRefresh();
				await api.updateColumn(activeWorkspaceId, id, patch);
				await refresh();
			} catch {
				showToast("Couldn't update the column. Try again.", "error");
			}
		},
		[activeWorkspaceId, cancelScheduledRefresh, refresh, showToast],
	);

	const onAddColumn = useCallback(
		async (title: string) => {
			if (activeWorkspaceId === null) return;
			try {
				cancelScheduledRefresh();
				await api.createColumn(activeWorkspaceId, title);
				await refresh();
			} catch {
				showToast(
					"Couldn't add the column. Check your connection and try again.",
					"error",
				);
			}
		},
		[activeWorkspaceId, cancelScheduledRefresh, refresh, showToast],
	);

	return (
		<div className="flex h-full flex-col">
			{/* Board identity heading — visually carried by the toolbar/columns, but
			    kept in the document so heading order starts at h1 (topbar is a span). */}
			<h1 className="sr-only">Board</h1>
			{columns && columns.length > 0 && <BoardToolbar columns={columns} />}

			<div className="board-canvas relative flex-1 overflow-x-auto p-6">
				{loadError && (
					<div className="mx-auto max-w-md rounded-md border border-error-500 bg-error-100 px-4 py-3 text-sm text-error-900">
						Couldn't load the board. Check that the server is running, then
						refresh.
					</div>
				)}
				{!loadError && columns === null && (
					<p className="text-sm text-neutral-500">Loading board...</p>
				)}
				{columns && (
					<DndContext
						sensors={sensors}
						collisionDetection={closestCorners}
						onDragStart={onDragStart}
						onDragOver={onDragOver}
						onDragEnd={onDragEnd}
						onDragCancel={() => {
							setActiveCard(null);
							revert();
						}}
					>
						{columns.length === 0 ? (
							<div className="flex h-full items-center justify-center">
								<EmptyState
									icon={Columns3}
									title="Start your board"
									description="Columns are the stages your work moves through — like To do, In progress, and Done. Add your first one to get going."
									action={<AddColumn onAddColumn={onAddColumn} />}
								/>
							</div>
						) : (
							<div className="flex h-full items-start gap-5 pb-2">
								{columns.map((column, i) => (
									<div
										key={column.id}
										className="animate-rise-in shrink-0"
										style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
									>
										<ColumnView
											column={column}
											onOpenCard={onOpenCard}
											onAddCard={onAddCard}
											onUpdateColumn={onUpdateColumn}
										/>
									</div>
								))}
								<AddColumn onAddColumn={onAddColumn} />
							</div>
						)}
						<DragOverlay>
							{activeCard && (
								<div className="rotate-2 cursor-grabbing rounded-md border border-primary-300 bg-white py-2.5 pr-3 pl-3.5 shadow-lg ring-1 ring-primary-600/10">
									<CardBody card={activeCard} />
								</div>
							)}
						</DragOverlay>
						<TrashZone visible={activeCard !== null} />
					</DndContext>
				)}
			</div>

			{/* Context panel route (/board/card/:id) renders here. */}
			<Outlet />
		</div>
	);
}
