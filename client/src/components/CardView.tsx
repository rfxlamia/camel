import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, Check } from "lucide-react";
import { memo } from "react";
import type { Card } from "../types";

interface Props {
	card: Card;
	onOpen: (card: Card) => void;
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** Initials for the assignee avatar: "Jane Doe" → "JD", "cher" → "CH". */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Today as a "YYYY-MM-DD" calendar string in the user's local timezone. */
function todayISO(): string {
	const d = new Date();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

/** "2026-06-21" → "Jun 21". Parsed from the string to avoid timezone shifts. */
function formatDue(iso: string): string {
	const [, m, d] = iso.split("-").map(Number);
	return `${MONTHS[m - 1]} ${d}`;
}

export function CardBody({ card }: { card: Card }) {
	const done = card.doneAt !== null;
	// Date-only string compare is valid because ISO "YYYY-MM-DD" sorts lexically.
	const overdue = card.dueDate !== null && !done && card.dueDate < todayISO();
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
			{(card.dueDate || card.assignee) && (
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
							{formatDue(card.dueDate)}
						</span>
					)}
					{card.assignee && (
						<span
							className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[10px] font-semibold text-primary-800"
							title={`Assigned to ${card.assignee.displayName}`}
							aria-label={`Assigned to ${card.assignee.displayName}`}
						>
							{initials(card.assignee.displayName)}
						</span>
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
