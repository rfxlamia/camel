import {
	Bot,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	Send,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError, api } from "../api";
import AgentCardDetail from "../components/AgentCardDetail";
import LoadingCamel from "../components/LoadingCamel";
import SuccessAnimation from "../components/SuccessAnimation";
import { useBoard } from "../context/BoardContext";
import {
	initialQueue,
	type QueueState,
	submit as queueSubmit,
	routeNext,
	settle,
} from "../lib/agentQueue";
import type { AgentBoard, AgentColumn, AgentEvent } from "../types";
import { formatRelativeTime } from "../types";

// ---- Queue reducer ----

type QueueAction =
	| { type: "submit"; message: string }
	| { type: "settle" }
	| { type: "reset" };

function queueReducer(state: QueueState, action: QueueAction): QueueState {
	switch (action.type) {
		case "submit": {
			const result = queueSubmit(state, action.message);
			return result.state;
		}
		case "settle": {
			const result = settle(state);
			return result.state;
		}
		case "reset": {
			return initialQueue;
		}
	}
}

// ---- Helpers ----

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
		case "agent.card.failed":
			return (
				<p className="text-sm text-error-900">
					<XCircle size={14} className="inline mr-1" aria-hidden />
					{event.columnSlug ?? "Card"} failed
					{event.error ? `: ${event.error}` : ""}
				</p>
			);
		default:
			return <p className="text-xs text-neutral-500">{event.type}</p>;
	}
}

// ---- Read-only board visual ----

function AgentBoardVisual({
	board,
	onCardClick,
	activeColumnSlug,
	doneColumnSlugs,
}: {
	board: AgentBoard;
	onCardClick: (column: AgentColumn) => void;
	activeColumnSlug: string | null;
	doneColumnSlugs: Set<string>;
}) {
	return (
		<div className="flex gap-4 overflow-x-auto p-4">
			{board.columns.map((col) => {
				// done takes priority over active (explicit mutual exclusivity).
				// board.executionStatus === "done" covers boards loaded from a prior session
				// where agentEvents is empty and doneColumnSlugs would otherwise be empty.
				const isDone =
					board.executionStatus === "done" || doneColumnSlugs.has(col.slug);
				const isActive = !isDone && col.slug === activeColumnSlug;

				// Done columns become interactive — the whole card opens AgentCardDetail.
				// Active and normal columns keep their original interaction model.
				const interactiveProps = isDone
					? {
							onClick: () => onCardClick(col),
							role: "button" as const,
							tabIndex: 0,
							onKeyDown: (e: React.KeyboardEvent) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault(); // prevent scroll on Space
									onCardClick(col);
								}
							},
						}
					: {};

				return (
					<div
						key={col.id}
						className={`w-64 shrink-0 rounded-lg border border-neutral-200 bg-white ${
							isDone
								? "cursor-pointer hover:border-primary-300 hover:shadow-sm transition-shadow"
								: ""
						}`}
						{...interactiveProps}
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
							{!isDone && !isActive && col.cards.length === 0 && (
								<p className="py-4 text-center text-xs text-neutral-400">
									No cards
								</p>
							)}
							{!isDone &&
								!isActive &&
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

// ---- Main page ----

export default function AgentPage() {
	const { activeWorkspaceId, showToast, agentEvents, clearAgentEvents } =
		useBoard();
	const [searchParams, setSearchParams] = useSearchParams();

	const [board, setBoard] = useState<AgentBoard | null>(null);
	// Always holds the latest board so synchronous queue handoffs (e.g.
	// createBoard's finally firing a queued refine message) read current
	// state instead of a stale closure captured while board was null.
	const boardRef = useRef<AgentBoard | null>(board);
	boardRef.current = board;
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [detailColumn, setDetailColumn] = useState<AgentColumn | null>(null);

	const [queueState, dispatch] = useReducer(queueReducer, initialQueue);
	const queueStateRef = useRef(queueState);
	queueStateRef.current = queueState;

	const logEndRef = useRef<HTMLDivElement>(null);
	const [lastIntent, setLastIntent] = useState<string | null>(null);
	const [isLogExpanded, setIsLogExpanded] = useState(false);

	// Load board from URL param on mount
	useEffect(() => {
		const boardId = searchParams.get("boardId");
		if (!boardId || !activeWorkspaceId) return;
		clearAgentEvents();
		let cancelled = false;
		setLoading(true);
		api
			.getAgentBoard(activeWorkspaceId, Number(boardId))
			.then((b) => {
				if (!cancelled) setBoard(b);
			})
			.catch(() => {
				if (!cancelled) {
					showToast("Couldn't load the board.");
					setSearchParams({}, { replace: true });
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId, searchParams, setSearchParams, showToast, clearAgentEvents]);

	// Re-fetch board when execution completes or fails so status and cards update.
	// BoardContext returns early on agent.* events and never calls refresh(), so
	// AgentPage must explicitly sync board state on terminal events.
	useEffect(() => {
		if (!agentEvents.length || !activeWorkspaceId || !board) return;
		const last = agentEvents[agentEvents.length - 1];
		if (last.type !== "agent.card.done" && last.type !== "agent.card.failed")
			return;
		api
			.getAgentBoard(activeWorkspaceId, board.id)
			.then(setBoard)
			// biome-ignore lint/suspicious/noEmptyBlockStatements: intentionally ignoring board fetch errors
			.catch(() => {});
	}, [agentEvents, activeWorkspaceId, board?.id, board]);

	// Auto-scroll event log
	useEffect(() => {
		logEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	// Actually handle the queue fire
	const sendMessage = useCallback(
		async (msg: string) => {
			// Resolve the board from the ref, not the captured `board` variable:
			// createBoard fires the first queued refine synchronously while its
			// own `board` closure is still null, so a captured value would be stale.
			const currentBoard = boardRef.current;
			if (!activeWorkspaceId || !currentBoard) return;
			try {
				const result = await api.sendAgentBoardMessage(
					activeWorkspaceId,
					currentBoard.id,
					msg,
				);
				if (result.boardUpdated) {
					const updated = await api.getAgentBoard(
						activeWorkspaceId,
						currentBoard.id,
					);
					setBoard(updated);
				}
				// Settle on success — fire next queued message if any
				const settleResult = settle(queueStateRef.current);
				dispatch({ type: "settle" });
				if (settleResult.fire) {
					void sendMessage(settleResult.fire);
				}
			} catch {
				showToast("Couldn't send message. Try again.");
				// Settle on error too — queue must continue
				const settleResult = settle(queueStateRef.current);
				dispatch({ type: "settle" });
				if (settleResult.fire) {
					void sendMessage(settleResult.fire);
				}
			}
		},
		[activeWorkspaceId, showToast],
	);

	// Holds the latest createBoard so its own finally can re-enter createBoard
	// (instead of sendMessage) when a create failed and the next queued item is
	// itself an intent. A ref avoids the self-reference / stale-closure problem.
	const createBoardRef = useRef<((intent: string) => Promise<void>) | null>(
		null,
	);

	// Create a new board (extracted for queue lifecycle)
	const createBoard = useCallback(
		async (intent: string) => {
			if (!activeWorkspaceId) return;
			try {
				clearAgentEvents();
				const result = await api.createAgentBoard(activeWorkspaceId, intent);
				const b = await api.getAgentBoard(activeWorkspaceId, result.boardId);
				setBoard(b);
				// Update the ref imperatively: the finally block below fires the
				// next queued message synchronously, before the setBoard re-render
				// commits, so sendMessage must see the new board now (not null).
				boardRef.current = b;
				setSearchParams({ boardId: String(result.boardId) }, { replace: true });
			} catch (err) {
				if (err instanceof ApiError && err.status === 422) {
					setError(err.message);
				} else {
					showToast("Couldn't create the board. Try again.");
				}
			} finally {
				// Settle queue — fire next if any.
				const settleResult = settle(queueStateRef.current);
				dispatch({ type: "settle" });
				if (settleResult.fire) {
					// On a successful create a board now exists, so the next item is a
					// refine message → sendMessage. On a FAILED create no board exists
					// yet, so the next item is itself an intent that must re-enter
					// createBoard; routing it to sendMessage would early-return and
					// strand the queue (isGenerating stuck true).
					const route = routeNext(settleResult.fire, boardRef.current !== null);
					if (route === "createBoard") {
						void createBoardRef.current?.(settleResult.fire);
					} else if (route === "sendMessage") {
						void sendMessage(settleResult.fire);
					}
				}
			}
		},
		[
			activeWorkspaceId,
			clearAgentEvents,
			setSearchParams,
			showToast,
			sendMessage,
		],
	);

	// Mirror the latest createBoard into the ref (same pattern as boardRef).
	createBoardRef.current = createBoard;

	// Submit handler — uses queue
	const handleSend = useCallback(async () => {
		const trimmed = input.trim();
		if (!trimmed || busy) return;
		setInput("");
		setBusy(true);
		setError(null);
		setLastIntent(trimmed);

		if (!board) {
			// Route through queue
			const qResult = queueSubmit(queueStateRef.current, trimmed);
			dispatch({ type: "submit", message: trimmed });
			setBusy(false);
			if (qResult.fire) {
				void createBoard(qResult.fire);
			}
			return;
		}

		// Queue the message
		const result = queueSubmit(queueStateRef.current, trimmed);
		dispatch({ type: "submit", message: trimmed });
		setBusy(false);

		if (result.fire) {
			// Fire immediately
			clearAgentEvents();
			void sendMessage(result.fire);
		}
	}, [input, busy, board, clearAgentEvents, sendMessage, createBoard]);

	// Settle → auto-fire effect (after queue reducer settles)
	// The settle effect in the agentEvents watcher handles firing the next queued message.

	// Approve handler
	const handleApprove = useCallback(async () => {
		if (!activeWorkspaceId || !board) return;
		setBusy(true);
		setError(null);
		try {
			clearAgentEvents();
			await api.approveAgentBoard(activeWorkspaceId, board.id);
			const updated = await api.getAgentBoard(activeWorkspaceId, board.id);
			setBoard(updated);
		} catch (err) {
			if (err instanceof ApiError) {
				setError(err.message);
			} else {
				showToast("Couldn't approve the board. Try again.");
			}
		} finally {
			setBusy(false);
		}
	}, [activeWorkspaceId, board, clearAgentEvents, showToast]);

	// Retry execution (re-approve after failure)
	const handleRetryExecution = useCallback(async () => {
		if (!activeWorkspaceId || !board) return;
		setBusy(true);
		setError(null);
		try {
			clearAgentEvents();
			await api.approveAgentBoard(activeWorkspaceId, board.id);
			const updated = await api.getAgentBoard(activeWorkspaceId, board.id);
			setBoard(updated);
		} catch (err) {
			if (err instanceof ApiError) {
				setError(err.message);
			} else {
				showToast("Couldn't retry. Try again.");
			}
		} finally {
			setBusy(false);
		}
	}, [activeWorkspaceId, board, clearAgentEvents, showToast]);

	// New board handler
	const handleNewBoard = useCallback(() => {
		setBoard(null);
		setSearchParams({}, { replace: true });
		clearAgentEvents();
		setError(null);
		setInput("");
	}, [setSearchParams, clearAgentEvents]);

	// Auto-expand log when execution starts
	useEffect(() => {
		if (board?.executionStatus === "running") setIsLogExpanded(true);
	}, [board?.executionStatus]);

	if (activeWorkspaceId === null) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<p className="text-sm text-neutral-500">
					Select a workspace to use the agent.
				</p>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<p className="text-sm text-neutral-500">Loading board...</p>
			</div>
		);
	}

	const isRunning = board?.executionStatus === "running";
	const isPending = board?.status === "pending";
	const isDone = board?.executionStatus === "done";
	const isFailed = board?.executionStatus === "failed";

	// Derive which column is currently being processed.
	// Walk agentEvents: set on `started`, clear on `done`/`failed`, ignore everything else.
	const activeColumnSlug: string | null = isRunning
		? agentEvents.reduce<string | null>((active, e) => {
				if (e.type === "agent.card.started") return e.columnSlug ?? null;
				if (e.type === "agent.card.done" || e.type === "agent.card.failed")
					return null;
				return active;
			}, null)
		: null;

	// Collect slugs of columns that have finished successfully.
	// Cleared naturally when clearAgentEvents() fires at the start of each run.
	const doneColumnSlugs = new Set(
		agentEvents
			.filter((e) => e.type === "agent.card.done" && e.columnSlug)
			.map((e) => e.columnSlug as string),
	);

	// Determine if any agent.card.token events are streaming
	const isStreaming =
		isRunning && agentEvents.some((e) => e.type === "agent.card.token");

	// Filter out raw token events for the log view — show them as a block
	const logEvents = agentEvents.filter((e) => e.type !== "agent.card.token");
	const tokenCount = agentEvents.filter(
		(e) => e.type === "agent.card.token",
	).length;

	return (
		<div className="flex h-full">
			{/* Left panel — board visual or empty state */}
			<div className="flex-1 overflow-auto border-r border-neutral-200">
				{!board ? (
					/* Empty state CTA */
					<div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
						<div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-100">
							<Bot size={32} className="text-primary-600" aria-hidden />
						</div>
						<div className="text-center">
							<h2 className="text-lg font-semibold text-neutral-900">
								Create an Agent Board
							</h2>
							<p className="mt-1 max-w-sm text-sm text-neutral-600">
								Describe what you want to research or analyze. The agent will
								generate a structured board with specialist columns.
							</p>
						</div>
					</div>
				) : (
					/* Board visual (read-only) */
					<div>
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
									onClick={handleNewBoard}
									className="rounded-md px-2.5 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								>
									New
								</button>
							</div>
						</div>
						<AgentBoardVisual
							board={board}
							onCardClick={setDetailColumn}
							activeColumnSlug={activeColumnSlug}
							doneColumnSlugs={doneColumnSlugs}
						/>
					</div>
				)}
			</div>

			{/* Right panel — chat + execution log */}
			<div className="flex w-96 flex-col bg-neutral-100">
				{/* Chat / explanation area */}
				<div className="flex-1 overflow-y-auto p-4 space-y-3">
					{/* The user's intent message. Once a board exists it survives via
					    board.originalIntent (persists across reloads); before the board
					    is created it falls back to the pending lastIntent. Gating this on
					    `!board` made the message vanish the moment the agent replied. */}
					{(() => {
						const userMessage = board?.originalIntent ?? lastIntent;
						if (!userMessage) {
							return (
								<p className="text-sm text-neutral-600">
									Describe what you want to build. The agent will generate a
									board structure you can review and approve.
								</p>
							);
						}
						return (
							<div className="flex justify-end">
								<div className="max-w-[80%] rounded-lg bg-primary-600 px-3 py-2">
									<p className="text-sm text-white break-words">
										{userMessage}
									</p>
								</div>
							</div>
						);
					})()}

					{board && (
						<div className="rounded-lg border border-neutral-200 bg-white p-3">
							<p className="text-xs font-medium text-neutral-500 mb-1">Agent</p>
							<p className="text-sm text-neutral-800 whitespace-pre-wrap">
								{board.columns.length > 0
									? `Created ${board.columns.length} columns. Review the structure and approve to start execution.`
									: "Board generated. Use the chat below to refine."}
							</p>
						</div>
					)}

					{/* Error message */}
					{error && (
						<div className="rounded-lg border border-error-200 bg-error-100 p-3 space-y-2">
							<p className="text-sm text-error-900">{error}</p>
							{!board && (
								<button
									onClick={() => {
										// Cleanup state and put intent back in input for user to review/edit
										setError(null);
										clearAgentEvents();
										setLastIntent(null);
										setBusy(false);
										// Reset queue to initial state
										dispatch({ type: "reset" });
										if (lastIntent) {
											setInput(lastIntent);
										}
									}}
									className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								>
									Retry
								</button>
							)}
						</div>
					)}

					{/* Approval section */}
					{board && isPending && (
						<div className="rounded-lg border border-primary-200 bg-primary-100/50 p-3 space-y-2">
							<p className="text-sm text-primary-800">
								Ready to start? Approve to begin execution.
							</p>
							<button
								onClick={handleApprove}
								disabled={busy}
								className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								{busy ? "Approving..." : "Approve"}
							</button>
						</div>
					)}

					{/* Execution log — collapsible */}
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
										<div className="space-y-2">
											<div className="flex items-center gap-1.5 text-sm text-error-900">
												<XCircle size={16} aria-hidden />
												Execution failed
											</div>
											<button
												onClick={handleRetryExecution}
												disabled={busy}
												className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
											>
												{busy ? "Retrying..." : "Retry Execution"}
											</button>
										</div>
									)}
									<div ref={logEndRef} />
								</div>
							)}
						</div>
					)}

					{/* Queue indicator */}
					{queueState.queue.length > 0 && (
						<div className="rounded-lg border border-warning-200 bg-warning-100/50 p-2">
							<p className="text-xs text-warning-900">
								{queueState.queue.length} message
								{queueState.queue.length !== 1 ? "s" : ""} queued
							</p>
						</div>
					)}
				</div>

				{/* Input area */}
				<div className="border-t border-neutral-200 p-3">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void handleSend();
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
										: "Refine the board..."
							}
							disabled={busy || isRunning || board?.status === "approved"}
							className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-400"
						/>
						<button
							type="submit"
							disabled={
								!input.trim() ||
								busy ||
								isRunning ||
								board?.status === "approved"
							}
							aria-label="Send"
							className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-600 text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<Send size={16} aria-hidden />
						</button>
					</form>
				</div>
			</div>

			{/* Card detail panel */}
			{detailColumn && board && (
				<AgentCardDetail
					column={detailColumn}
					boardId={board.id}
					toolTrace={board.toolTrace}
					onClose={() => setDetailColumn(null)}
				/>
			)}
		</div>
	);
}
