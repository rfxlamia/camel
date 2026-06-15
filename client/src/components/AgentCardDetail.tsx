import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { useBoard } from "../context/BoardContext";
import { deriveToolTrace, pickToolTraceForColumn } from "../lib/toolTrace";
import type { AgentCardOutput, AgentColumn, ToolTraceItem } from "../types";
import { ToolTrace } from "./ToolTrace";

interface AgentCardDetailProps {
	column: AgentColumn;
	boardId: number;
	toolTrace?: ToolTraceItem[];
	onClose: () => void;
}

export default function AgentCardDetail({
	column,
	boardId,
	toolTrace = [],
	onClose,
}: AgentCardDetailProps) {
	const { activeWorkspaceId, agentEvents } = useBoard();
	const [output, setOutput] = useState<AgentCardOutput | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const [isPromptOpen, setIsPromptOpen] = useState(false);

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

	const traceSteps = pickToolTraceForColumn(
		toolTrace,
		deriveToolTrace(agentEvents),
		column.slug,
	);

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

				{/* System prompt — collapsible */}
				<div>
					<button
						type="button"
						onClick={() => setIsPromptOpen((v) => !v)}
						className="flex w-full items-center gap-1.5 text-left"
					>
						{isPromptOpen ? (
							<ChevronDown
								size={14}
								className="shrink-0 text-neutral-500"
								aria-hidden
							/>
						) : (
							<ChevronRight
								size={14}
								className="shrink-0 text-neutral-500"
								aria-hidden
							/>
						)}
						<h4 className="text-xs font-medium text-neutral-600">
							System Prompt
						</h4>
					</button>
					{isPromptOpen && (
						<div className="mt-1 rounded-md border border-neutral-200 bg-neutral-100 p-3">
							<p className="text-sm text-neutral-800 whitespace-pre-wrap">
								{column.systemPrompt}
							</p>
						</div>
					)}
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
							<div className="text-sm text-neutral-800 leading-relaxed">
								<ReactMarkdown
									remarkPlugins={[remarkGfm]}
									components={{
										h1: ({ children }) => (
											<h1 className="text-xl font-semibold text-neutral-900 mt-4 mb-2 first:mt-0">
												{children}
											</h1>
										),
										h2: ({ children }) => (
											<h2 className="text-lg font-semibold text-neutral-900 mt-4 mb-2 first:mt-0">
												{children}
											</h2>
										),
										h3: ({ children }) => (
											<h3 className="text-base font-semibold text-neutral-900 mt-3 mb-1.5 first:mt-0">
												{children}
											</h3>
										),
										p: ({ children }) => (
											<p className="text-sm text-neutral-800 leading-relaxed mb-2 last:mb-0">
												{children}
											</p>
										),
										ul: ({ children }) => (
											<ul className="list-disc pl-5 mb-2 space-y-1 text-sm text-neutral-800">
												{children}
											</ul>
										),
										ol: ({ children }) => (
											<ol className="list-decimal pl-5 mb-2 space-y-1 text-sm text-neutral-800">
												{children}
											</ol>
										),
										li: ({ children }) => (
											<li className="text-sm text-neutral-800 leading-relaxed">
												{children}
											</li>
										),
										strong: ({ children }) => (
											<strong className="font-semibold text-neutral-900">
												{children}
											</strong>
										),
										em: ({ children }) => (
											<em className="italic text-neutral-700">{children}</em>
										),
										a: ({ href, children }) => (
											<a
												href={href}
												target="_blank"
												rel="noopener noreferrer"
												className="text-primary-600 hover:text-primary-700 underline underline-offset-2"
											>
												{children}
											</a>
										),
										hr: () => <hr className="my-3 border-neutral-200" />,
										code: ({ children, className }) => {
											const isBlock = className?.includes("language-");
											if (isBlock) {
												return (
													<pre className="rounded-md bg-neutral-100 border border-neutral-200 p-3 mb-2 overflow-x-auto">
														<code className="text-xs font-mono text-neutral-800">
															{children}
														</code>
													</pre>
												);
											}
											return (
												<code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-mono text-neutral-800">
													{children}
												</code>
											);
										},
										blockquote: ({ children }) => (
											<blockquote className="border-l-2 border-primary-300 pl-3 py-1 mb-2 text-sm text-neutral-600 italic">
												{children}
											</blockquote>
										),
										table: ({ children }) => (
											<div className="overflow-x-auto mb-2">
												<table className="w-full text-sm border-collapse">
													{children}
												</table>
											</div>
										),
										th: ({ children }) => (
											<th className="border-b border-neutral-200 px-3 py-1.5 text-left text-xs font-semibold text-neutral-700">
												{children}
											</th>
										),
										td: ({ children }) => (
											<td className="border-b border-neutral-200 px-3 py-1.5 text-sm text-neutral-800">
												{children}
											</td>
										),
									}}
								>
									{output.output}
								</ReactMarkdown>
							</div>
						</div>
					)}
				</div>

				{/* Tool activity for this column */}
				{traceSteps.length > 0 && (
					<div>
						<h4 className="text-xs font-medium text-neutral-600 mb-1">
							Tool Activity
						</h4>
						<ToolTrace steps={traceSteps} />
					</div>
				)}

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
