import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { TrackerVocabulary, WorkItem } from "../../types";
import TrackerRow from "./TrackerRow";

export function SortableTrackerRow({
	item,
	statuses,
	priorities,
	onStatusChange,
}: {
	item: WorkItem;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	onStatusChange?: (item: WorkItem, statusId: number) => void;
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
			// Test hook for jsdom layout stub in TrackerProjectPage tests.
			data-sortable-key={item.key}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
			}}
			className={isDragging ? "relative z-10 opacity-60" : undefined}
		>
			<div className="group/row flex items-stretch">
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

export function StaticTrackerRow({
	item,
	statuses,
	priorities,
	onStatusChange,
}: {
	item: WorkItem;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	onStatusChange?: (item: WorkItem, statusId: number) => void;
}) {
	return (
		<div className="group/row flex items-stretch">
			<div className="w-7 shrink-0" aria-hidden />
			<div className="min-w-0 flex-1">
				<TrackerRow
					item={item}
					statuses={statuses}
					priorities={priorities}
					onStatusChange={(statusId) => onStatusChange?.(item, statusId)}
				/>
			</div>
		</div>
	);
}
