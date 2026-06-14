import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { useBoard } from "../context/BoardContext";
import type { AgentBoard } from "../types";
import { formatRelativeTime } from "../types";

function ExecutionBadge({ status }: { status: AgentBoard["executionStatus"] }) {
	const styles: Record<
		AgentBoard["executionStatus"],
		{ label: string; className: string }
	> = {
		done: { label: "Done", className: "bg-success-100 text-success-900" },
		failed: { label: "Failed", className: "bg-error-100 text-error-900" },
		running: {
			label: "Running",
			className: "bg-info-100 text-info-900",
		},
		idle: { label: "Idle", className: "bg-neutral-200 text-neutral-700" },
	};
	const s = styles[status] ?? styles.idle;
	return (
		<span
			className={`rounded-md px-2 py-0.5 text-xs font-medium ${s.className}`}
		>
			{s.label}
		</span>
	);
}

const TEMPLATE_NAMES: Record<string, string> = {
	"research-report": "Research & Report",
};

function templateName(templateId: string): string {
	return TEMPLATE_NAMES[templateId] ?? templateId;
}

export default function HistoryPage() {
	const { activeWorkspaceId } = useBoard();
	const navigate = useNavigate();
	const [boards, setBoards] = useState<AgentBoard[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(false);

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		let cancelled = false;
		setLoading(true);
		setError(false);
		api
			.getAgentBoards(activeWorkspaceId)
			.then((data) => {
				if (!cancelled) setBoards(data);
			})
			.catch(() => {
				if (!cancelled) setError(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId]);

	if (activeWorkspaceId === null) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<p className="text-sm text-neutral-500">
					Select a workspace to view history.
				</p>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<p className="text-sm text-neutral-500">Loading boards...</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
				<p className="text-sm text-error-600">
					Couldn&apos;t load boards. Check your connection and try again.
				</p>
				<button
					onClick={() => window.location.reload()}
					className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Retry
				</button>
			</div>
		);
	}

	if (boards.length === 0) {
		return (
			<div className="mx-auto max-w-2xl p-6">
				<h2 className="text-lg font-semibold text-neutral-900">History</h2>
				<p className="mt-1 text-sm text-neutral-600">
					Review past agent board executions and their results.
				</p>
				<div className="mt-12 flex flex-col items-center gap-3">
					<p className="text-sm text-neutral-500">No agent boards yet.</p>
					<Link
						to="/agent"
						className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Create your first board
					</Link>
				</div>
			</div>
		);
	}

	// Sort newest first (by createdAt descending)
	const sorted = [...boards].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);

	return (
		<div className="mx-auto max-w-2xl p-6">
			<h2 className="text-lg font-semibold text-neutral-900">History</h2>
			<p className="mt-1 text-sm text-neutral-600">
				Review past agent board executions and their results.
			</p>

			<ol className="mt-6 rounded-md border border-neutral-200 bg-white">
				{sorted.map((board) => (
					<li key={board.id}>
						<button
							onClick={() => navigate(`/agent?boardId=${board.id}`)}
							className="flex w-full items-start gap-3 border-b border-neutral-100 px-4 py-3 text-left last:border-b-0 hover:bg-neutral-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium text-neutral-900 truncate">
									{board.originalIntent.length > 80
										? `${board.originalIntent.slice(0, 80)}...`
										: board.originalIntent}
								</p>
								<p className="mt-0.5 text-xs text-neutral-500">
									{templateName(board.templateId)} ·{" "}
									{formatRelativeTime(board.createdAt)}
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-1.5">
								<ExecutionBadge status={board.executionStatus} />
							</div>
						</button>
					</li>
				))}
			</ol>
		</div>
	);
}
