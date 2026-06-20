import { ChevronRight, XCircle } from "lucide-react";
import { deriveColumnState } from "../../lib/agentColumnState";
import type { AgentBoard, AgentColumn, AgentEvent } from "../../types";
import LoadingCamel from "../LoadingCamel";
import SuccessAnimation from "../SuccessAnimation";

type ColState = "active" | "done" | "failed" | "pending";

const STATE_META: Record<
	ColState,
	{ accent: string; chip: string; label: string }
> = {
	done: {
		accent: "bg-success-500",
		chip: "bg-success-100 text-success-900",
		label: "Complete",
	},
	active: {
		accent: "bg-info-500",
		chip: "bg-info-100 text-info-900",
		label: "Working",
	},
	failed: {
		accent: "bg-error-500",
		chip: "bg-error-100 text-error-900",
		label: "Failed",
	},
	pending: {
		accent: "bg-neutral-300",
		chip: "bg-neutral-200 text-neutral-600",
		label: "Ready",
	},
};

export default function AgentBoardVisual({
	board,
	onCardClick,
	agentEvents,
}: {
	board: AgentBoard;
	onCardClick: (column: AgentColumn) => void;
	agentEvents: AgentEvent[];
}) {
	const states: ColState[] = board.columns.map((col) =>
		deriveColumnState(
			agentEvents,
			board.id,
			col.slug,
			board.executionStatus,
			col.cards.length > 0,
		),
	);

	const total = board.columns.length;
	const doneCount = states.filter((s) => s === "done").length;
	const hasRun = board.executionStatus !== "idle";
	const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

	return (
		<div className="p-5">
			{/* Progress / guidance strip */}
			<div className="mb-4 flex items-center justify-between gap-4">
				{hasRun ? (
					<>
						<div className="flex items-baseline gap-2">
							<span className="text-sm font-semibold text-neutral-900">
								{doneCount} of {total}
							</span>
							<span className="text-xs text-neutral-500">columns complete</span>
						</div>
						<div className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-200">
							<div
								className="h-full rounded-full bg-primary-600 transition-[width] duration-500 ease-out"
								style={{ width: `${pct}%` }}
							/>
						</div>
					</>
				) : (
					<p className="text-xs text-neutral-500">
						<span className="font-medium text-neutral-700">
							{total} columns
						</span>{" "}
						drafted — open any to inspect its prompt, then approve to run.
					</p>
				)}
			</div>

			{/* Pipeline */}
			<div className="flex items-stretch gap-1 overflow-x-auto pb-2">
				{board.columns.map((col, i) => {
					const state = states[i];
					const meta = STATE_META[state];
					const isPending = state === "pending";

					return (
						<div key={col.id} className="flex items-stretch gap-1">
							<div
								className="animate-rise-in group flex w-72 shrink-0 cursor-pointer flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								style={{ animationDelay: `${i * 70}ms` }}
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
								{/* Status accent */}
								<div className={`h-1 w-full ${meta.accent}`} aria-hidden />

								{/* Header */}
								<div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
									<span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-semibold text-neutral-500">
										{i + 1}
									</span>
									<h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">
										{col.name}
									</h3>
									<span
										className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${meta.chip}`}
									>
										{meta.label}
									</span>
								</div>

								{/* Body */}
								<div className="min-h-[88px] flex-1 space-y-2 border-t border-neutral-100 px-3 py-2.5">
									{state === "done" && (
										<div className="flex flex-col items-center justify-center gap-1 py-2">
											<SuccessAnimation size={48} />
											<span className="text-xs text-success-900">
												Output ready
											</span>
										</div>
									)}
									{state === "active" && (
										<div className="flex flex-col items-center justify-center gap-1 py-2">
											<LoadingCamel size={48} />
											<span className="text-xs text-info-900">
												Researching…
											</span>
										</div>
									)}
									{state === "failed" && (
										<div className="flex flex-col items-center justify-center gap-1 py-2">
											<XCircle
												size={40}
												className="text-error-500"
												aria-hidden
											/>
											<span className="text-xs text-error-900">
												This column failed
											</span>
										</div>
									)}
									{isPending && col.cards.length === 0 && (
										<p className="py-5 text-center text-xs text-neutral-400">
											No cards yet
										</p>
									)}
									{isPending &&
										col.cards.map((card) => (
											<div
												key={card.id}
												className="rounded-md border border-neutral-200 bg-neutral-100/60 px-2.5 py-2 text-left text-sm text-neutral-800 transition-colors group-hover:border-primary-200"
											>
												{card.title}
											</div>
										))}
								</div>

								{/* Footer affordance */}
								<div className="flex items-center justify-between border-t border-neutral-100 px-3 py-1.5">
									<span className="text-[10px] text-neutral-400">
										{col.cards.length} card
										{col.cards.length === 1 ? "" : "s"}
									</span>
									<span className="text-[10px] font-medium text-primary-600 opacity-0 transition-opacity group-hover:opacity-100">
										Open →
									</span>
								</div>
							</div>

							{/* Connector */}
							{i < board.columns.length - 1 && (
								<div className="flex w-5 items-center justify-center self-stretch">
									<ChevronRight
										size={16}
										className="text-neutral-300"
										aria-hidden
									/>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
