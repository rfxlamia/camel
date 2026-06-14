import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../api";
import { useBoard } from "../context/BoardContext";
import type { AgentCardOutput, AgentColumn } from "../types";

interface AgentCardDetailProps {
	column: AgentColumn;
	boardId: number;
	onClose: () => void;
}

export default function AgentCardDetail({
	column,
	boardId,
	onClose,
}: AgentCardDetailProps) {
	const { activeWorkspaceId } = useBoard();
	const [output, setOutput] = useState<AgentCardOutput | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		let cancelled = false;
		setLoading(true);
		setError(false);
		api
			.getAgentCardOutput(activeWorkspaceId, boardId, column.slug)
			.then((data) => {
				if (!cancelled) setOutput(data);
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
	}, [activeWorkspaceId, boardId, column.slug]);

	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [onClose]);

	return (
		<div className="fixed inset-y-0 right-0 z-30 w-full max-w-md border-l border-neutral-200 bg-white shadow-lg overflow-y-auto">
			{/* Header */}
			<div className="sticky top-0 flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
				<div className="min-w-0">
					<h3 className="text-sm font-semibold text-neutral-900 truncate">
						{column.name}
					</h3>
					<p className="text-xs text-neutral-500">{column.slug}</p>
				</div>
				<button
					onClick={onClose}
					aria-label="Close"
					className="shrink-0 rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					<X size={18} aria-hidden />
				</button>
			</div>

			<div className="space-y-4 p-4">
				{/* Reasoning badge */}
				<div>
					<span className="text-xs font-medium text-neutral-600">
						Extended Thinking:
					</span>
					<span
						className={`ml-2 rounded-md px-2 py-0.5 text-xs font-medium ${
							column.reasoning
								? "bg-success-100 text-success-900"
								: "bg-neutral-200 text-neutral-700"
						}`}
					>
						{column.reasoning ? "ON" : "OFF"}
					</span>
				</div>

				{/* System prompt */}
				<div>
					<h4 className="text-xs font-medium text-neutral-600 mb-1">
						System Prompt
					</h4>
					<div className="rounded-md border border-neutral-200 bg-neutral-100 p-3">
						<p className="text-sm text-neutral-800 whitespace-pre-wrap">
							{column.systemPrompt}
						</p>
					</div>
				</div>

				{/* Output */}
				<div>
					<h4 className="text-xs font-medium text-neutral-600 mb-1">Output</h4>
					{loading && (
						<p className="text-sm text-neutral-500">Loading output...</p>
					)}
					{error && (
						<p className="text-sm text-error-600">
							Couldn&apos;t load output. This card may not have been executed
							yet.
						</p>
					)}
					{!loading && !error && !output && (
						<p className="text-sm text-neutral-500">
							No output yet. Approve the board to start execution.
						</p>
					)}
					{output && (
						<div className="rounded-md border border-neutral-200 bg-white p-3">
							<p className="text-sm text-neutral-800 whitespace-pre-wrap">
								{output.output}
							</p>
						</div>
					)}
				</div>

				{/* Thinking */}
				{output?.thinking && (
					<div>
						<h4 className="text-xs font-medium text-neutral-600 mb-1">
							Thinking
						</h4>
						<div className="rounded-md border border-neutral-200 bg-neutral-100 p-3">
							<p className="text-sm text-neutral-700 whitespace-pre-wrap">
								{output.thinking}
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
