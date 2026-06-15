import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card } from "../types";

interface Props {
	card: Card;
	onOpen: (card: Card) => void;
}

export function CardBody({ card }: { card: Card }) {
	return (
		<>
			<p className="text-sm font-medium text-neutral-900">{card.title}</p>
			{card.description && (
				<p className="mt-1 line-clamp-2 text-xs text-neutral-600">
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
			className={`cursor-grab rounded-md border border-neutral-200 bg-white px-3 py-2.5 shadow-xs hover:border-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
				isDragging ? "opacity-40" : ""
			}`}
		>
			<CardBody card={card} />
		</div>
	);
}
