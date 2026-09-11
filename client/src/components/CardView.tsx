import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, Check } from "lucide-react";
import { memo } from "react";
import {
	assigneeInitials,
	formatDueDate,
	isCardDone,
	isDueOverdue,
} from "../lib/boardViewUtils";
import { orderCardAttachments } from "../lib/cardAttachments";
import type { Card } from "../types";

interface Props {
	card: Card;
	onOpen: (card: Card) => void;
}

export function CardBody({ card }: { card: Card }) {
	const done = isCardDone(card);
	const overdue = isDueOverdue(card);
	const attachments = orderCardAttachments(card.attachments ?? []);
	const cover = attachments[0];
	const extraCount = attachments.length - 1;
	return (
		<>
			{cover && (
				<div className="relative mb-2 overflow-hidden rounded-md border border-neutral-200 bg-neutral-100">
					<img
						key={cover.id}
						src={cover.thumbnailUrl}
						alt={`Attachment preview for ${card.title}`}
						title="Card attachment"
						className="h-24 w-full object-cover"
						onError={(event) => {
							const image = event.currentTarget;
							if (image.dataset.fallbackAttempted === "true") return;
							image.dataset.fallbackAttempted = "true";
							image.src = cover.originalUrl;
						}}
					/>
					{extraCount > 0 && (
						<span
							className="absolute top-1.5 right-1.5 rounded bg-neutral-900/75 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums"
							aria-label={`${extraCount} more attachments`}
						>
							+{extraCount}
						</span>
					)}
				</div>
			)}
			{card.key && (
				<span className="mb-1 block break-all font-mono text-[11px] leading-tight text-neutral-500 tabular-nums">
					{card.key}
				</span>
			)}
			<div className="flex items-start gap-2">
				<p
					className={`min-w-0 flex-1 text-sm font-medium leading-snug ${
						done ? "text-neutral-500" : "text-neutral-900"
					}`}
				>
					{card.title}
				</p>
				{done && (
					<span
						className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success-100 text-success-900"
						title="Done"
						aria-label="Done"
					>
						<Check size={11} strokeWidth={3} aria-hidden />
					</span>
				)}
			</div>
			{card.description.trim() && (
				<pre
					className={`mt-1.5 line-clamp-3 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-neutral-200 bg-neutral-100/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed tracking-tight ${
						done ? "text-neutral-500" : "text-neutral-700"
					}`}
				>
					{card.description}
				</pre>
			)}
			{(card.dueDate || card.assignees.length > 0) && (
				<div className="mt-2 flex items-center gap-2">
					{card.dueDate && (
						<span
							className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
								overdue
									? "bg-error-100 text-error-900"
									: "bg-neutral-100 text-neutral-600"
							}`}
							title={overdue ? "Overdue" : "Due date"}
						>
							<Calendar size={11} aria-hidden />
							{formatDueDate(card.dueDate)}
						</span>
					)}
					{card.assignees.length > 0 && (
						<div className="ml-auto flex -space-x-1.5">
							{card.assignees.slice(0, 3).map((assignee) => (
								<span
									key={assignee.id}
									className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white bg-primary-100 text-[10px] font-semibold text-primary-800"
									title={`Assigned to ${assignee.displayName}`}
									aria-label={`Assigned to ${assignee.displayName}`}
								>
									{assigneeInitials(assignee.displayName)}
								</span>
							))}
							{card.assignees.length > 3 && (
								<span
									className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-white bg-neutral-200 px-1 text-[9px] font-semibold text-neutral-700"
									title={card.assignees
										.slice(3)
										.map((a) => a.displayName)
										.join(", ")}
								>
									+{card.assignees.length - 3}
								</span>
							)}
						</div>
					)}
				</div>
			)}
		</>
	);
}

export default memo(CardView);

function CardView({ card, onOpen }: Props) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: `card-${card.id}`,
		data: { type: "card", card },
	});

	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
			}}
			{...attributes}
			{...listeners}
			onClick={() => onOpen(card)}
			className={`group relative cursor-grab touch-none rounded-md border border-neutral-200 bg-white py-2.5 pr-3 pl-3.5 shadow-xs transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-neutral-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 active:cursor-grabbing ${
				isDragging ? "opacity-40" : ""
			}`}
		>
			<CardBody card={card} />
		</div>
	);
}
