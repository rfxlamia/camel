import { Check, Plus } from "lucide-react";
import type { AgentBoard } from "../../types";
import { formatRelativeTime } from "../../types";

const TEMPLATE_NAMES: Record<string, string> = {
	"research-report": "Research & Report",
};

function templateName(templateId: string): string {
	return TEMPLATE_NAMES[templateId] ?? templateId;
}

// ---- Status pill ----

function StatusPill({ board }: { board: AgentBoard }) {
	const map: { label: string; dot: string; className: string } = (() => {
		if (board.executionStatus === "done")
			return {
				label: "Done",
				dot: "bg-success-500",
				className: "bg-success-100 text-success-900",
			};
		if (board.executionStatus === "failed")
			return {
				label: "Failed",
				dot: "bg-error-500",
				className: "bg-error-100 text-error-900",
			};
		if (board.executionStatus === "running")
			return {
				label: "Running",
				dot: "bg-info-500 animate-pulse",
				className: "bg-info-100 text-info-900",
			};
		if (board.status === "approved")
			return {
				label: "Approved",
				dot: "bg-primary-500",
				className: "bg-primary-100 text-primary-800",
			};
		return {
			label: "Draft",
			dot: "bg-warning-500",
			className: "bg-warning-100 text-warning-900",
		};
	})();

	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${map.className}`}
		>
			<span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} aria-hidden />
			{map.label}
		</span>
	);
}

// ---- Stage stepper ----

const STAGES = ["Draft", "Review", "Run", "Done"] as const;

function deriveStage(board: AgentBoard): {
	current: number;
	complete: boolean;
	failed: boolean;
} {
	if (board.executionStatus === "done")
		return { current: 3, complete: true, failed: false };
	if (board.executionStatus === "failed")
		return { current: 2, complete: false, failed: true };
	if (board.executionStatus === "running")
		return { current: 2, complete: false, failed: false };
	if (board.status === "approved")
		return { current: 2, complete: false, failed: false };
	return { current: 1, complete: false, failed: false };
}

function StageStepper({ board }: { board: AgentBoard }) {
	const { current, complete, failed } = deriveStage(board);

	return (
		<ol className="flex items-center gap-1.5" aria-label="Agent progress">
			{STAGES.map((label, i) => {
				const isCompleted = complete || i < current;
				const isActive = !complete && i === current;
				const isError = failed && i === current;
				const isLast = i === STAGES.length - 1;

				let node: string;
				let text: string;
				if (isError) {
					node = "border-error-500 bg-error-100 text-error-900";
					text = "text-error-900";
				} else if (isCompleted) {
					node = "border-primary-600 bg-primary-600 text-white";
					text = "text-neutral-700";
				} else if (isActive) {
					node =
						"border-primary-600 bg-white text-primary-700 ring-2 ring-primary-600/15";
					text = "text-primary-800 font-medium";
				} else {
					node = "border-neutral-300 bg-white text-neutral-400";
					text = "text-neutral-400";
				}

				return (
					<li key={label} className="flex items-center gap-1.5">
						<span
							className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${node}`}
						>
							{isCompleted && !isError ? (
								<Check size={11} strokeWidth={3} aria-hidden />
							) : (
								i + 1
							)}
						</span>
						<span className={`text-xs ${text}`}>{label}</span>
						{!isLast && (
							<span
								className={`mx-1 h-px w-5 sm:w-8 ${
									isCompleted ? "bg-primary-300" : "bg-neutral-200"
								}`}
								aria-hidden
							/>
						)}
					</li>
				);
			})}
		</ol>
	);
}

// ---- Header ----

export default function AgentBoardHeader({
	board,
	onNewBoard,
}: {
	board: AgentBoard;
	onNewBoard: () => void;
}) {
	return (
		<div className="border-b border-neutral-200 bg-white/80 px-5 py-3.5 backdrop-blur-sm">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold text-neutral-900">
						{board.originalIntent}
					</p>
					<p className="mt-0.5 text-xs text-neutral-500">
						{templateName(board.templateId)} ·{" "}
						{formatRelativeTime(board.createdAt)}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<StatusPill board={board} />
					<button
						onClick={onNewBoard}
						className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<Plus size={14} aria-hidden />
						New board
					</button>
				</div>
			</div>
			<div className="mt-3 overflow-x-auto">
				<StageStepper board={board} />
			</div>
		</div>
	);
}
