import { XCircle } from "lucide-react";
import { deriveColumnState } from "../../lib/agentColumnState";
import type { AgentBoard, AgentColumn, AgentEvent } from "../../types";
import LoadingCamel from "../LoadingCamel";
import SuccessAnimation from "../SuccessAnimation";

export default function AgentBoardVisual({
	board,
	onCardClick,
	agentEvents,
}: {
	board: AgentBoard;
	onCardClick: (column: AgentColumn) => void;
	agentEvents: AgentEvent[];
}) {
	return (
		<div className="flex gap-4 overflow-x-auto p-4">
			{board.columns.map((col) => {
				const state = deriveColumnState(
					agentEvents,
					board.id,
					col.slug,
					board.executionStatus,
					col.cards.length > 0,
				);
				const isDone = state === "done";
				const isActive = state === "active";
				const isFailed = state === "failed";

				return (
					<div
						key={col.id}
						className="w-64 shrink-0 rounded-lg border border-neutral-200 bg-white cursor-pointer hover:border-primary-300 hover:shadow-sm transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						onClick={() => onCardClick(col)}
						role="button"
						tabIndex={0}
						onKeyDown={(e: React.KeyboardEvent) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onCardClick(col);
							}
						}}
					>
						<div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
							<h3 className="text-sm font-medium text-neutral-900 truncate">
								{col.name}
							</h3>
							<span className="rounded-md bg-neutral-200 px-1.5 py-0.5 text-xs font-semibold text-neutral-700">
								{col.cards.length}
							</span>
						</div>
						<div className="min-h-[60px] space-y-2 p-2">
							{isDone && (
								<div className="flex justify-center py-1">
									<SuccessAnimation size={48} />
								</div>
							)}
							{isActive && (
								<div className="flex justify-center py-1">
									<LoadingCamel size={48} />
								</div>
							)}
							{isFailed && (
								<div className="flex justify-center py-1">
									<XCircle size={48} className="text-error-900" aria-hidden />
								</div>
							)}
							{state === "pending" && col.cards.length === 0 && (
								<p className="py-4 text-center text-xs text-neutral-400">
									No cards
								</p>
							)}
							{state === "pending" &&
								col.cards.map((card) => (
									<button
										key={card.id}
										onClick={() => onCardClick(col)}
										className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-left text-sm text-neutral-800 hover:border-primary-300 hover:bg-primary-100/30 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
									>
										{card.title}
									</button>
								))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
