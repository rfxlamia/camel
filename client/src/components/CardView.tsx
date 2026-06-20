import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check } from "lucide-react";
import type { Card } from "../types";

interface Props {
	card: Card;
	onOpen: (card: Card) => void;
}

export function CardBody({ card }: { card: Card }) {
	const done = card.doneAt !== null;
	return (
		<>
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
			{card.description && (
				<p className="mt-1 line-clamp-2 text-xs leading-snug text-neutral-600">
					{card.description}
				</p>
			)}
		</>
	);
}

export default function CardView({ card, onOpen }: Props) {
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

	const done = card.doneAt !== null;
	const active = card.startedAt !== null && !done;
	// Left accent rail encodes lifecycle: done (green) → active (blue) → idle (none).
	const rail = done
		? "before:bg-success-500"
		: active
			? "before:bg-primary-400"
			: "before:bg-transparent";

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
			className={`group relative cursor-grab touch-none rounded-md border border-neutral-200 bg-white py-2.5 pr-3 pl-3.5 shadow-xs transition-[border-color,box-shadow,transform] duration-150 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:content-[''] ${rail} hover:-translate-y-px hover:border-neutral-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 active:cursor-grabbing ${
				isDragging ? "opacity-40" : ""
			}`}
		>
			<CardBody card={card} />
		</div>
	);
}
