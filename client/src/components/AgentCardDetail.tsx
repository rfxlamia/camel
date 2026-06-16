import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { useBoard } from "../context/BoardContext";
import {
	deriveColumnFailureMessage,
	deriveStreamedOutputForColumn,
	deriveThinkingForColumn,
	pickContent,
} from "../lib/agentStream";
import {
	deriveToolTrace,
	hasLiveToolActivityForColumn,
	pickToolTraceForColumn,
} from "../lib/toolTrace";
import type { AgentCardOutput, AgentColumn, ToolTraceItem } from "../types";
import { ToolTrace } from "./ToolTrace";

interface AgentCardDetailProps {
	column: AgentColumn;
	boardId: number;
	toolTrace?: ToolTraceItem[];
	onClose: () => void;
}

const SCROLL_THRESHOLD = 32;

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
	const scrollRef = useRef<HTMLDivElement>(null);
	const autoFollowRef = useRef(true);

	const liveThinking = deriveThinkingForColumn(
		agentEvents,
		boardId,
		column.slug,
	);
	const liveOutput = deriveStreamedOutputForColumn(
		agentEvents,
		boardId,
		column.slug,
	);
	const hasLiveContent =
		liveThinking.length > 0 ||
		liveOutput.length > 0 ||
		hasLiveToolActivityForColumn(agentEvents, boardId, column.slug);
	const displayOutput = pickContent(liveOutput, output?.output ?? "");
	const displayThinking = pickContent(liveThinking, output?.thinking ?? "");
	const failureError = deriveColumnFailureMessage(
		agentEvents,
		boardId,
		column.slug,
	);

	useEffect(() => {
		if (activeWorkspaceId === null || hasLiveContent) return;
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
	}, [activeWorkspaceId, boardId, column.slug, hasLiveContent]);

	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [onClose]);

	const traceSteps = pickToolTraceForColumn(
		toolTrace,
		deriveToolTrace(agentEvents, boardId),
		column.slug,
	);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el || !autoFollowRef.current) return;
		el.scrollTop = el.scrollHeight;
	}, [displayThinking, displayOutput, traceSteps.length]);

	const handleScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom =
			el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
		autoFollowRef.current = atBottom;
	};

	return (
		<div
			ref={scrollRef}
			onScroll={handleScroll}
			className="fixed inset-y-0 right-0 z-30 w-full max-w-md border-l border-neutral-200 bg-white shadow-lg overflow-y-auto"
		>
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
				{/* Reasoning badge — extended thinking enabled for all columns */}
				<div>
					<span className="text-xs font-medium text-neutral-600">
						Extended Thinking:
					</span>
					<span className="ml-2 rounded-md px-2 py-0.5 text-xs font-medium bg-success-100 text-success-900">
						ON
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
					{loading && !hasLiveContent && (
						<p className="text-sm text-neutral-500">Loading output...</p>
					)}
					{error && !hasLiveContent && (
						<p className="text-sm text-error-600">
							Couldn&apos;t load output. This card may not have been executed
							yet.
						</p>
					)}
					{failureError && !displayOutput && (
						<p className="text-sm text-error-600">
							This column failed: {failureError}
						</p>
					)}
					{!loading &&
						!error &&
						!displayOutput &&
						!failureError && (
							<p className="text-sm text-neutral-500">
								No output yet. Approve the board to start execution.
							</p>
						)}
					{displayOutput && (
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
									{displayOutput}
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
				{displayThinking && (
					<div>
						<h4 className="text-xs font-medium text-neutral-600 mb-1">
							Thinking
						</h4>
						<div className="rounded-md border border-neutral-200 bg-neutral-100 p-3">
							<div className="text-sm text-neutral-700 leading-relaxed">
								<ReactMarkdown
									remarkPlugins={[remarkGfm]}
									components={{
										h1: ({ children }) => (
											<h1 className="text-lg font-semibold text-neutral-800 mt-3 mb-1.5 first:mt-0">
												{children}
											</h1>
										),
										h2: ({ children }) => (
											<h2 className="text-base font-semibold text-neutral-800 mt-3 mb-1.5 first:mt-0">
												{children}
											</h2>
										),
										h3: ({ children }) => (
											<h3 className="text-sm font-semibold text-neutral-800 mt-2 mb-1 first:mt-0">
												{children}
											</h3>
										),
										p: ({ children }) => (
											<p className="text-sm text-neutral-700 leading-relaxed mb-1.5 last:mb-0">
												{children}
											</p>
										),
										ul: ({ children }) => (
											<ul className="list-disc pl-5 mb-1.5 space-y-0.5 text-sm text-neutral-700">
												{children}
											</ul>
										),
										ol: ({ children }) => (
											<ol className="list-decimal pl-5 mb-1.5 space-y-0.5 text-sm text-neutral-700">
												{children}
											</ol>
										),
										li: ({ children }) => (
											<li className="text-sm text-neutral-700 leading-relaxed">
												{children}
											</li>
										),
										strong: ({ children }) => (
											<strong className="font-semibold text-neutral-800">
												{children}
											</strong>
										),
										em: ({ children }) => (
											<em className="italic text-neutral-600">{children}</em>
										),
										code: ({ children, className }) => {
											const isBlock = className?.includes("language-");
											if (isBlock) {
												return (
													<pre className="rounded-md bg-neutral-200/60 border border-neutral-200 p-2.5 mb-1.5 overflow-x-auto">
														<code className="text-xs font-mono text-neutral-700">
															{children}
														</code>
													</pre>
												);
											}
											return (
												<code className="rounded bg-neutral-200/60 px-1 py-0.5 text-xs font-mono text-neutral-700">
													{children}
												</code>
											);
										},
										blockquote: ({ children }) => (
											<blockquote className="border-l-2 border-neutral-300 pl-3 py-1 mb-1.5 text-sm text-neutral-600 italic">
												{children}
											</blockquote>
										),
										hr: () => <hr className="my-2 border-neutral-300" />,
									}}
								>
									{displayThinking}
								</ReactMarkdown>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
