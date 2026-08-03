import { X } from "lucide-react";
import type { Card } from "../types";

export default function CalendarDayModal({
	cards,
	onClose,
	onSelectCard,
}: {
	cards: Card[];
	onClose: () => void;
	onSelectCard: (card: Card) => void;
}) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Cards due this day"
				className="w-full max-w-md rounded-lg border border-neutral-200 bg-white shadow-lg"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
					<h2 className="text-sm font-semibold text-neutral-900">
						{cards.length} card{cards.length === 1 ? "" : "s"} due
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						aria-label="Close"
					>
						<X size={16} aria-hidden />
					</button>
				</div>
				<ul className="max-h-80 overflow-y-auto py-1">
					{cards.map((card) => (
						<li key={card.id}>
							<button
								type="button"
								onClick={() => onSelectCard(card)}
								className="flex w-full px-4 py-2.5 text-left text-sm text-neutral-900 hover:bg-primary-100/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600"
							>
								{card.title}
							</button>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
