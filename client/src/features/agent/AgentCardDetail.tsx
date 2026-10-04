import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../../api";
import { ToolTrace } from "../../shared/ToolTraceView";
import {
	deriveToolTrace,
	hasLiveToolActivityForColumn,
	pickToolTraceForColumn,
} from "../../shared/toolTrace";
import { useWorkspace } from "../../shared/WorkspaceContext";
import type { AgentCardOutput, AgentColumn, ToolTraceItem } from "../../types";
import { useBoard } from "../board";
import AgentThinkingSection from "./AgentThinkingSection";
import { outputMarkdownComponents } from "./agentMarkdown";
import {
	deriveColumnFailureMessage,
	deriveStreamedOutputForColumn,
	deriveThinkingForColumn,
	pickContent,
} from "./agentStream";
import { savedScrollPositions, saveScrollPosition } from "./scrollPositions";
import ThinkingBadge from "./ThinkingBadge";

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
	const { activeWorkspaceId } = useWorkspace();
	const { agentEvents } = useBoard();
	const [output, setOutput] = useState<AgentCardOutput | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const [isPromptOpen, setIsPromptOpen] = useState(false);
	const [isThinkingOpen, setIsThinkingOpen] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

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

	// Scroll position key frozen at mount — never changes for the lifetime of this panel.
	const scrollKeyRef = useRef(`${boardId}-${column.slug}`);

	// Auto-follow is enabled immediately if content is already streaming at mount;
	// otherwise starts false so historical content doesn't jump to the bottom.
	const autoFollowRef = useRef(hasLiveContent);

	// Guards the scroll restore so it only runs once per mount even if output refetches.
	const restoredRef = useRef(false);

	// Auto-open Thinking panel the first time live thinking arrives
	useEffect(() => {
		if (displayThinking) setIsThinkingOpen(true);
	}, [displayThinking]);

	// Enable auto-follow when live streaming begins (handles the case where streaming
	// starts after the panel is already open).
	useEffect(() => {
		if (hasLiveContent) autoFollowRef.current = true;
	}, [hasLiveContent]);

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

	// Restore saved scroll position after DB content loads (historical view only).
	// Runs once per mount thanks to restoredRef — ignores any subsequent refetches.
	useEffect(() => {
		if (!output || hasLiveContent || restoredRef.current) return;
		restoredRef.current = true;
		const el = scrollRef.current;
		if (!el) return;
		const saved = savedScrollPositions.get(scrollKeyRef.current);
		if (saved !== undefined) {
			el.scrollTop = saved;
		}
		// No saved position → stays at 0 (top), which is correct for a first open.
	}, [output, hasLiveContent]);

	// Save scroll position on unmount (for users who read without scrolling).
	// Capture el at effect-run time to avoid concurrent-mode ref nullification.
	useEffect(() => {
		const el = scrollRef.current;
		return () => {
			if (el) saveScrollPosition(scrollKeyRef.current, el.scrollTop);
		};
	}, []);

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
		// Reference deps to satisfy exhaustive-deps — these values changing
		// indicates new streamed content that should trigger auto-scroll.
		void displayThinking;
		void displayOutput;
		void traceSteps.length;
		el.scrollTop = el.scrollHeight;
	}, [displayThinking, displayOutput, traceSteps.length]);

	const handleScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom =
			el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
		autoFollowRef.current = atBottom;
		// Continuously save position so reopening the panel restores where user left off.
		saveScrollPosition(scrollKeyRef.current, el.scrollTop);
	};

	return (
		// Slide-over drawer. No backdrop scrim on purpose: during execution the
		// board keeps streaming/animating behind it, and clicking another column
		// must switch the detail (a scrim would intercept that and close instead).
		<div
			ref={scrollRef}
			onScroll={handleScroll}
			className="animate-panel-in fixed inset-y-0 right-0 z-30 w-full max-w-md overflow-y-auto border-l border-neutral-200 bg-white shadow-xl"
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
				<ThinkingBadge enabled={column.reasoning} />

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

				{/* Thinking */}
				{displayThinking && (
					<AgentThinkingSection
						thinking={displayThinking}
						isOpen={isThinkingOpen}
						onToggle={() => setIsThinkingOpen((v) => !v)}
					/>
				)}

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
					{!loading && !error && !displayOutput && !failureError && (
						<p className="text-sm text-neutral-500">
							No output yet. Approve the board to start execution.
						</p>
					)}
					{displayOutput && (
						<div className="rounded-md border border-neutral-200 bg-white p-3">
							<div className="text-sm text-neutral-800 leading-relaxed">
								<ReactMarkdown
									remarkPlugins={[remarkGfm]}
									components={outputMarkdownComponents}
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
			</div>
		</div>
	);
}
