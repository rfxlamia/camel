import type { AgentBoard } from "../../types";
import { formatRelativeTime } from "../../types";

function statusBadge(board: AgentBoard) {
	if (board.executionStatus === "done") {
		return (
			<span className="rounded-md bg-success-100 px-2 py-0.5 text-xs font-medium text-success-900">
				Done
			</span>
		);
	}
	if (board.executionStatus === "failed") {
		return (
			<span className="rounded-md bg-error-100 px-2 py-0.5 text-xs font-medium text-error-900">
				Failed
			</span>
		);
	}
	if (board.executionStatus === "running") {
		return (
			<span className="rounded-md bg-info-100 px-2 py-0.5 text-xs font-medium text-info-900">
				Running
			</span>
		);
	}
	if (board.status === "approved") {
		return (
			<span className="rounded-md bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
				Approved
			</span>
		);
	}
	return (
		<span className="rounded-md bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-900">
			Pending
		</span>
	);
}

export default function AgentBoardHeader({
	board,
	onNewBoard,
}: {
	board: AgentBoard;
	onNewBoard: () => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
			<div className="min-w-0">
				<p className="text-sm font-medium text-neutral-900 truncate">
					{board.originalIntent}
				</p>
				<p className="text-xs text-neutral-500">
					{formatRelativeTime(board.createdAt)}
				</p>
			</div>
			<div className="flex items-center gap-2">
				{statusBadge(board)}
				<button
					onClick={onNewBoard}
					className="rounded-md px-2.5 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					New
				</button>
			</div>
		</div>
	);
}
