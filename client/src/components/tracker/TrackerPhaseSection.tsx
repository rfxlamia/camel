import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { formatDueDate } from "../../lib/boardViewUtils";
import {
	isPhaseOverdue,
	isTaskOverdue,
	rollup,
	sectionBounds,
} from "../../lib/trackerRollup";
import type { TrackerItem, TrackerPhase, TrackerVocabulary } from "../../types";
import TrackerProgressBar from "./TrackerProgressBar";
import TrackerRow from "./TrackerRow";

interface Props {
	phase: TrackerPhase | null;
	label: string;
	items: TrackerItem[];
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	collapsed: boolean;
	onToggle: () => void;
	onStatusChange?: (item: TrackerItem, statusId: number) => void;
	onRename?: () => void;
	onDelete?: () => void;
	onReorder?: (oldIndex: number, newIndex: number, itemKey: string) => void;
	children?: ReactNode;
}

function formatDateRange(
	startDate: string | null,
	endDate: string | null,
): string | null {
	if (startDate && endDate) {
		return `${formatDueDate(startDate)} – ${formatDueDate(endDate)}`;
	}
	if (startDate) return formatDueDate(startDate);
	if (endDate) return formatDueDate(endDate);
	return null;
}

function SortableTrackerRow({
	item,
	statuses,
	priorities,
	onStatusChange,
	reorderable,
}: {
	item: TrackerItem;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	onStatusChange?: (item: TrackerItem, statusId: number) => void;
	reorderable: boolean;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: item.key });

	return (
		<div
			ref={setNodeRef}
			data-sortable-key={item.key}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
			}}
			className={isDragging ? "relative z-10 opacity-60" : undefined}
		>
			<div className="group/row flex items-stretch">
				{reorderable && (
					<button
						type="button"
						ref={setActivatorNodeRef}
						aria-label={`Reorder ${item.key}`}
						{...attributes}
						{...listeners}
						className="flex w-7 shrink-0 cursor-grab items-center justify-center text-neutral-400 opacity-0 transition hover:text-neutral-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600 active:cursor-grabbing group-hover/row:opacity-100"
					>
						<GripVertical size={14} aria-hidden />
					</button>
				)}
				<div className="min-w-0 flex-1">
					<TrackerRow
						item={item}
						statuses={statuses}
						priorities={priorities}
						onStatusChange={(statusId) => onStatusChange?.(item, statusId)}
					/>
				</div>
			</div>
		</div>
	);
}

export default function TrackerPhaseSection({
	phase,
	label,
	items,
	statuses,
	priorities,
	collapsed,
	onToggle,
	onStatusChange,
	onRename,
	onDelete,
	onReorder,
	children,
}: Props) {
	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const rollupResult = rollup(items);
	const bounds = sectionBounds(phase, items);
	const sectionKey = phase ? String(phase.id) : "no-phase";
	const dateRange = formatDateRange(bounds.startDate, bounds.endDate);
	const overdue = phase
		? isPhaseOverdue(phase, items)
		: items.some(isTaskOverdue);
	const subtitle = phase?.subtitle?.trim() ?? "";
	const sortableIds = items.map((item) => item.key);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id || !onReorder) return;
		const oldIndex = items.findIndex((item) => item.key === active.id);
		const newIndex = items.findIndex((item) => item.key === over.id);
		if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
		onReorder(oldIndex, newIndex, String(active.id));
	};

	return (
		<section
			data-testid={`phase-${label}`}
			className="border-neutral-200 border-b last:border-b-0"
		>
			<div className="group/head flex min-h-9 items-center gap-2 bg-neutral-100/80 px-4 py-1.5 md:px-6">
				<button
					type="button"
					data-testid={`toggle-phase-${sectionKey}`}
					onClick={onToggle}
					className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					<ChevronRight
						size={13}
						className={`shrink-0 text-neutral-500 transition-transform duration-150 ${
							collapsed ? "" : "rotate-90"
						}`}
						aria-hidden
					/>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							<span className="truncate font-medium text-neutral-800 text-sm">
								{label}
							</span>
							{overdue && (
								<span
									aria-label="Overdue"
									className="shrink-0 rounded-md bg-[oklch(95%_0.025_25)] px-1.5 py-0.5 font-medium text-[oklch(35%_0.085_25)] text-xs"
								>
									Overdue
								</span>
							)}
						</div>
						{subtitle && (
							<p className="truncate text-neutral-600 text-sm">{subtitle}</p>
						)}
					</div>
				</button>
				<div className="w-40 shrink-0">
					<TrackerProgressBar rollup={rollupResult} />
				</div>
				{dateRange && (
					<span className="shrink-0 text-neutral-500 text-xs">{dateRange}</span>
				)}
				{phase && onRename && (
					<button
						type="button"
						aria-label={`Rename phase ${label}`}
						onClick={onRename}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-800 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 group-hover/head:opacity-100"
					>
						<Pencil size={13} aria-hidden />
					</button>
				)}
				{phase && onDelete && (
					<button
						type="button"
						aria-label={`Delete phase ${label}`}
						onClick={onDelete}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-800 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 group-hover/head:opacity-100"
					>
						<Trash2 size={13} aria-hidden />
					</button>
				)}
			</div>
			{children}
			{!collapsed && items.length > 0 && (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={sortableIds}
						strategy={verticalListSortingStrategy}
					>
						<div className="divide-y divide-neutral-200/70 bg-white">
							{items.map((item) => (
								<SortableTrackerRow
									key={item.key}
									item={item}
									statuses={statuses}
									priorities={priorities}
									onStatusChange={onStatusChange}
									reorderable={onReorder != null}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			)}
		</section>
	);
}
