import {
	CheckCircle,
	ChevronDown,
	ChevronRight,
	MessagesSquare,
	Play,
	RefreshCw,
	Send,
	XCircle,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FollowUpMessage } from "../../lib/agentFollowUp";
import type { QueueState } from "../../lib/agentQueue";
import type { AgentArtifact, AgentBoard, AgentEvent } from "../../types";
import ArtifactCard from "../ArtifactCard";

// ---- Chat markdown components ----

const chatMarkdownComponents = {
	h1: ({ children }: { children?: React.ReactNode }) => (
		<h1 className="text-base font-semibold text-neutral-900 mt-2 mb-1 first:mt-0">
			{children}
		</h1>
	),
	h2: ({ children }: { children?: React.ReactNode }) => (
		<h2 className="text-sm font-semibold text-neutral-900 mt-2 mb-1 first:mt-0">
			{children}
		</h2>
	),
	h3: ({ children }: { children?: React.ReactNode }) => (
		<h3 className="text-sm font-semibold text-neutral-800 mt-1.5 mb-0.5 first:mt-0">
			{children}
		</h3>
	),
	p: ({ children }: { children?: React.ReactNode }) => (
		<p className="text-sm text-neutral-800 leading-relaxed mb-1 last:mb-0">
			{children}
		</p>
	),
	ul: ({ children }: { children?: React.ReactNode }) => (
		<ul className="list-disc pl-4 mb-1 space-y-0.5 text-sm text-neutral-800">
			{children}
		</ul>
	),
	ol: ({ children }: { children?: React.ReactNode }) => (
		<ol className="list-decimal pl-4 mb-1 space-y-0.5 text-sm text-neutral-800">
			{children}
		</ol>
	),
	li: ({ children }: { children?: React.ReactNode }) => (
		<li className="text-sm text-neutral-800 leading-relaxed">{children}</li>
	),
	strong: ({ children }: { children?: React.ReactNode }) => (
		<strong className="font-semibold text-neutral-900">{children}</strong>
	),
	em: ({ children }: { children?: React.ReactNode }) => (
		<em className="italic text-neutral-600">{children}</em>
	),
	a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-primary-600 hover:text-primary-700 underline underline-offset-2"
		>
			{children}
		</a>
	),
	code: ({
		children,
		className,
	}: {
		children?: React.ReactNode;
		className?: string;
	}) => {
		const isBlock = className?.includes("language-");
		if (isBlock) {
			return (
				<pre className="rounded-md bg-neutral-100 border border-neutral-200 p-2 mb-1 overflow-x-auto">
					<code className="text-xs font-mono text-neutral-800">{children}</code>
				</pre>
			);
		}
		return (
			<code className="rounded bg-neutral-100 px-1 py-0.5 text-xs font-mono text-neutral-800">
				{children}
			</code>
		);
	},
	blockquote: ({ children }: { children?: React.ReactNode }) => (
		<blockquote className="border-l-2 border-primary-300 pl-2.5 py-0.5 mb-1 text-sm text-neutral-600 italic">
			{children}
		</blockquote>
	),
	hr: () => <hr className="my-1.5 border-neutral-200" />,
	table: ({ children }: { children?: React.ReactNode }) => (
		<div className="overflow-x-auto mb-1">
			<table className="w-full text-xs border-collapse">{children}</table>
		</div>
	),
	th: ({ children }: { children?: React.ReactNode }) => (
		<th className="border-b border-neutral-200 px-2 py-1 text-left text-xs font-semibold text-neutral-700">
			{children}
		</th>
	),
	td: ({ children }: { children?: React.ReactNode }) => (
		<td className="border-b border-neutral-200 px-2 py-1 text-sm text-neutral-800">
			{children}
		</td>
	),
};

// ---- Event log entry ----

function EventEntry({ event }: { event: AgentEvent }) {
	switch (event.type) {
		case "agent.card.started":
			return (
				<p className="text-sm text-neutral-700">
					<span className="font-medium">Started</span>{" "}
					{event.columnSlug ?? "card"}
				</p>
			);
		case "agent.card.token":
			return (
				<p className="text-xs text-neutral-500 font-mono break-all">
					{event.token}
				</p>
			);
		case "agent.card.done":
			return (
				<p className="text-sm text-success-900">
					<CheckCircle size={14} className="inline mr-1" aria-hidden />
					{event.columnSlug ?? "Card"} complete
				</p>
			);
		case "agent.card.failed": {
			const failureText = event.error ?? event.reason;
			return (
				<p className="text-sm text-error-900">
					<XCircle size={14} className="inline mr-1" aria-hidden />
					{event.columnSlug ?? "Card"} failed
					{failureText ? `: ${failureText}` : ""}
				</p>
			);
		}
		default:
			return <p className="text-xs text-neutral-500">{event.type}</p>;
	}
}

// ---- Component ----

interface AgentChatPanelProps {
	board: AgentBoard | null;
	creating: boolean;
	lastIntent: string | null;
	followUpMessages: FollowUpMessage[];
	streamingFollowUpText: string;
	pendingRegenerate: boolean;
	error: string | null;
	artifact: AgentArtifact | null;
	queueState: QueueState;
	input: string;
	setInput: Dispatch<SetStateAction<string>>;
	busy: boolean;
	inputDisabled: boolean;
	sendDisabled: boolean;
	isRunning: boolean;
	isPending: boolean;
	isDone: boolean;
	isFailed: boolean;
	canFollowUp: boolean;
	isStreaming: boolean;
	logEvents: AgentEvent[];
	tokenCount: number;
	isLogExpanded: boolean;
	setIsLogExpanded: Dispatch<SetStateAction<boolean>>;
	logEndRef: React.RefObject<HTMLDivElement>;
	activeWorkspaceId: number | null;
	onSend: () => void;
	onApprove: () => void;
	onRetryExecution: () => void;
	onConfirmRegenerate: () => void;
	onCancelRegenerate: () => void;
	onResetError: () => void;
	agentArtifactDownloadUrl: string;
}

export default function AgentChatPanel({
	board,
	creating,
	lastIntent,
	followUpMessages,
	streamingFollowUpText,
	pendingRegenerate,
	error,
	artifact,
	queueState,
	input,
	setInput,
	busy,
	inputDisabled,
	sendDisabled,
	isRunning,
	isPending,
	isDone,
	isFailed,
	canFollowUp,
	isStreaming,
	logEvents,
	tokenCount,
	isLogExpanded,
	setIsLogExpanded,
	logEndRef,
	activeWorkspaceId,
	onSend,
	onApprove,
	onRetryExecution,
	onConfirmRegenerate,
	onCancelRegenerate,
	onResetError,
	agentArtifactDownloadUrl,
}: AgentChatPanelProps) {
	// The single most important next action, surfaced in the docked bar so it is
	// never lost in the scrolling transcript.
	const showApprove = board != null && isPending;
	const showRegenerate = board != null && pendingRegenerate;
	const showRetry = board != null && isFailed;

	return (
		<div className="flex h-[50vh] w-full shrink-0 flex-col border-t border-neutral-200 bg-neutral-100 md:h-auto md:w-96 md:border-l md:border-t-0">
			{/* Rail header — gives the panel a clear identity */}
			<div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-4 py-3">
				<MessagesSquare size={15} className="text-primary-600" aria-hidden />
				<p className="text-sm font-semibold text-neutral-800">Conversation</p>
				{isRunning && (
					<span className="ml-auto flex items-center gap-1.5 text-xs text-info-700">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info-500" />
						Running
					</span>
				)}
			</div>

			{/* Transcript */}
			<div className="flex-1 overflow-y-auto p-4 space-y-3">
				{(() => {
					const userMessage = board?.originalIntent ?? lastIntent;
					if (!userMessage) {
						return (
							<p className="text-sm text-neutral-600">
								Describe what you want to build. The agent will generate a board
								structure you can review and approve.
							</p>
						);
					}
					return (
						<div className="flex justify-end">
							<div className="max-w-[80%] rounded-lg rounded-br-sm bg-primary-600 px-3 py-2 shadow-sm">
								<p className="text-sm text-white break-words">{userMessage}</p>
							</div>
						</div>
					);
				})()}

				{creating && !board && (
					<div className="flex justify-start">
						<div className="max-w-[80%] rounded-lg border border-neutral-200 bg-white px-3 py-2">
							<p className="text-xs font-medium text-neutral-500 mb-1">Agent</p>
							<div className="flex items-center gap-1.5" aria-hidden="true">
								<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary-600" />
								<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary-600 [animation-delay:150ms]" />
								<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary-600 [animation-delay:300ms]" />
							</div>
							<span className="sr-only">Agent is thinking</span>
						</div>
					</div>
				)}

				{board && (
					<div className="rounded-lg rounded-tl-sm border border-neutral-200 bg-white p-3 shadow-sm">
						<p className="text-xs font-medium text-neutral-500 mb-1">Agent</p>
						<p className="text-sm text-neutral-800 whitespace-pre-wrap">
							{board.columns.length > 0
								? `Created ${board.columns.length} columns. Review the structure and approve to start execution.`
								: "Board generated. Use the chat below to refine."}
						</p>
					</div>
				)}

				{followUpMessages.map((msg, i) => (
					<div
						key={`follow-up-${i}`}
						className={
							msg.role === "user" ? "flex justify-end" : "flex justify-start"
						}
					>
						<div
							className={
								msg.role === "user"
									? "max-w-[80%] rounded-lg rounded-br-sm bg-primary-600 px-3 py-2 shadow-sm"
									: "max-w-[80%] rounded-lg rounded-tl-sm border border-neutral-200 bg-white px-3 py-2 shadow-sm"
							}
						>
							{msg.role === "assistant" && (
								<p className="text-xs font-medium text-neutral-500 mb-1">
									Agent
								</p>
							)}
							{msg.role === "user" ? (
								<p className="text-sm text-white break-words">{msg.content}</p>
							) : (
								<div className="text-sm text-neutral-800 break-words">
									<ReactMarkdown
										remarkPlugins={[remarkGfm]}
										components={chatMarkdownComponents}
									>
										{msg.content}
									</ReactMarkdown>
								</div>
							)}
						</div>
					</div>
				))}

				{streamingFollowUpText && (
					<div className="flex justify-start">
						<div className="max-w-[80%] rounded-lg rounded-tl-sm border border-neutral-200 bg-white px-3 py-2 shadow-sm">
							<p className="text-xs font-medium text-neutral-500 mb-1">Agent</p>
							<div className="text-sm text-neutral-800 break-words">
								<ReactMarkdown
									remarkPlugins={[remarkGfm]}
									components={chatMarkdownComponents}
								>
									{streamingFollowUpText}
								</ReactMarkdown>
							</div>
						</div>
					</div>
				)}

				{/* Error message */}
				{error && (
					<div className="rounded-lg border border-error-500/30 bg-error-100 p-3 space-y-2">
						<p className="text-sm text-error-900">{error}</p>
						{!board && (
							<button
								type="button"
								onClick={onResetError}
								className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								Retry
							</button>
						)}
					</div>
				)}

				{/* Execution log — collapsible telemetry */}
				{board && (isRunning || isDone || isFailed) && (
					<div className="rounded-lg border border-neutral-200 bg-white">
						<button
							type="button"
							onClick={() => setIsLogExpanded((prev) => !prev)}
							className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
							aria-expanded={isLogExpanded}
						>
							{isLogExpanded ? (
								<ChevronDown size={14} aria-hidden />
							) : (
								<ChevronRight size={14} aria-hidden />
							)}
							Execution Log
							{isRunning && !isLogExpanded && (
								<span className="ml-auto text-info-700">Running…</span>
							)}
						</button>
						{isLogExpanded && (
							<div className="space-y-2 border-t border-neutral-200 p-3">
								{isRunning && (
									<p className="text-xs text-info-700">
										Running...{" "}
										{tokenCount > 0 && `(${tokenCount} tokens received)`}
									</p>
								)}
								{logEvents.map((event, i) => (
									<EventEntry key={i} event={event} />
								))}
								{isStreaming && (
									<div className="flex items-center gap-1.5 text-xs text-neutral-500">
										<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary-600" />
										Streaming...
									</div>
								)}
								{isDone && (
									<div className="flex items-center gap-1.5 text-sm text-success-900">
										<CheckCircle size={16} aria-hidden />
										Execution complete
									</div>
								)}
								{isFailed && (
									<div className="flex items-center gap-1.5 text-sm text-error-900">
										<XCircle size={16} aria-hidden />
										Execution failed
									</div>
								)}
								<div ref={logEndRef} />
							</div>
						)}
					</div>
				)}

				{isDone && artifact && activeWorkspaceId !== null && board && (
					<ArtifactCard
						artifact={artifact}
						downloadUrl={agentArtifactDownloadUrl}
					/>
				)}

				{/* Queue indicator */}
				{queueState.queue.length > 0 && (
					<div className="rounded-lg border border-warning-500/30 bg-warning-100/60 p-2">
						<p className="text-xs text-warning-900">
							{queueState.queue.length} message
							{queueState.queue.length !== 1 ? "s" : ""} queued
						</p>
					</div>
				)}
			</div>

			{/* Docked action + input */}
			<div className="border-t border-neutral-200 bg-neutral-100">
				{/* Contextual primary action — at most one shows at a time */}
				{showApprove && (
					<div className="animate-rise-in border-b border-neutral-200 bg-primary-100/60 px-3 py-3">
						<p className="mb-2 text-sm text-primary-900">
							Looks good? Approve to start the run.
						</p>
						<button
							type="button"
							onClick={onApprove}
							disabled={busy}
							className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<Play size={15} aria-hidden />
							{busy ? "Approving..." : "Approve & run"}
						</button>
					</div>
				)}

				{showRegenerate && (
					<div className="animate-rise-in border-b border-neutral-200 bg-warning-100/60 px-3 py-3">
						<p className="mb-2 text-sm text-warning-900">
							That looks like a new topic. Regenerate the board?
						</p>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => void onConfirmRegenerate()}
								disabled={busy}
								className="flex-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								Yes, Regenerate
							</button>
							<button
								type="button"
								onClick={() => void onCancelRegenerate()}
								disabled={busy}
								className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								Cancel
							</button>
						</div>
					</div>
				)}

				{showRetry && (
					<div className="animate-rise-in border-b border-neutral-200 bg-error-100/60 px-3 py-3">
						<p className="mb-2 flex items-center gap-1.5 text-sm text-error-900">
							<XCircle size={15} aria-hidden />
							Execution failed.
						</p>
						<button
							type="button"
							onClick={onRetryExecution}
							disabled={busy}
							className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<RefreshCw size={14} aria-hidden />
							{busy ? "Retrying..." : "Retry execution"}
						</button>
					</div>
				)}

				{/* Input */}
				<div className="p-3">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							if (!sendDisabled) void onSend();
						}}
						className="flex gap-2"
					>
						<input
							type="text"
							value={input}
							onChange={(e) => setInput(e.target.value)}
							placeholder={
								!board
									? "Describe what you want to research..."
									: isRunning
										? "Execution in progress..."
										: pendingRegenerate
											? "Waiting for confirmation..."
											: canFollowUp
												? "Follow up about this board..."
												: "Refine the board..."
							}
							disabled={inputDisabled}
							className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-400"
						/>
						<button
							type="submit"
							disabled={sendDisabled}
							aria-label="Send"
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-600 text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<Send size={16} aria-hidden />
						</button>
					</form>
				</div>
			</div>
		</div>
	);
}
