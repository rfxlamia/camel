import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { api } from "../api";
import type { FollowUpMessage } from "../lib/agentFollowUp";
import { conversationsToFollowUpMessages } from "../lib/agentFollowUp";
import {
	initialQueue,
	type QueueState,
	submit as queueSubmit,
	routeNext,
	settle,
} from "../lib/agentQueue";
import type { AgentBoard, AgentEvent } from "../types";

// ---- Queue reducer (owned by this hook) ----

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

const ROLE_ASSISTANT = "assistant" as const;

function isFollowUpSlug(slug: string | undefined): boolean {
	return slug === "__notfirst__";
}

export function getStreamingFollowUpText(
	events: AgentEvent[],
	boardId: number,
): string {
	return events
		.filter(
			(e) =>
				e.type === "agent.card.token" &&
				isFollowUpSlug(e.columnSlug) &&
				e.boardId === boardId,
		)
		.map((e) => e.token ?? "")
		.join("");
}

// ---- Config ----

export interface UseAgentChatConfig {
	board: AgentBoard | null;
	boardRef: MutableRefObject<AgentBoard | null>;
	createBoard: (intent: string) => Promise<void>;
	setBoard: Dispatch<SetStateAction<AgentBoard | null>>;
	activeWorkspaceId: number | null;
	showToast: (msg: string) => void;
	clearAgentEvents: () => void;
	clearFollowUpAgentEvents: () => void;
	agentEvents: AgentEvent[];
	agentEventsRef: MutableRefObject<AgentEvent[]>;
}

// ---- Hook ----

export function useAgentChat(config: UseAgentChatConfig) {
	const {
		board,
		boardRef,
		createBoard,
		setBoard,
		activeWorkspaceId,
		showToast,
		clearAgentEvents,
		clearFollowUpAgentEvents,
		agentEvents,
		agentEventsRef,
	} = config;

	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [followUpMessages, setFollowUpMessages] = useState<FollowUpMessage[]>(
		[],
	);
	const [pendingRegenerate, setPendingRegenerate] = useState(false);
	const [lastIntent, setLastIntent] = useState<string | null>(null);
	const [isLogExpanded, setIsLogExpanded] = useState(false);
	const logEndRef = useRef<HTMLDivElement>(null);

	// Queue state — fully owned by this hook.
	const [queueState, dispatch] = useReducer(queueReducer, initialQueue);
	const queueStateRef = useRef(queueState);
	queueStateRef.current = queueState;

	// Refs for cross-wiring sendMessage ↔ createBoardWithQueue.
	const sendMessageRef = useRef<((msg: string) => Promise<void>) | null>(null);
	const createBoardWithQueueRef = useRef<
		((intent: string) => Promise<void>) | null
	>(null);

	// ---- sendMessage (API call + settlement) ----
	const sendMessage = useCallback(
		async (msg: string) => {
			const currentBoard = boardRef.current;
			if (!activeWorkspaceId || !currentBoard) return;
			try {
				const result = await api.sendAgentBoardMessage(
					activeWorkspaceId,
					currentBoard.id,
					msg,
				);
				if (result.pendingRegenerate) {
					setPendingRegenerate(true);
					setFollowUpMessages((prev) => [
						...prev,
						{
							role: ROLE_ASSISTANT,
							content: result.explanation,
							intent: "NEW_DIRECTION",
						},
					]);
				} else if (result.streamed && result.explanation) {
					const streamedText =
						getStreamingFollowUpText(
							agentEventsRef.current ?? [],
							currentBoard.id,
						) || result.explanation;
					setFollowUpMessages((prev) => {
						if (
							prev.some(
								(m) => m.role === ROLE_ASSISTANT && m.content === streamedText,
							)
						) {
							return prev;
						}
						return [...prev, { role: ROLE_ASSISTANT, content: streamedText }];
					});
					clearFollowUpAgentEvents();
				} else if (result.explanation) {
					setFollowUpMessages((prev) => [
						...prev,
						{ role: ROLE_ASSISTANT, content: result.explanation },
					]);
				}
				if (result.boardUpdated) {
					const updated = await api.getAgentBoard(
						activeWorkspaceId,
						currentBoard.id,
					);
					setBoard(updated);
				}
			} catch {
				showToast("Couldn't send message. Try again.");
			} finally {
				// Settlement bridge — fire next queued message if any.
				const settleResult = settle(queueStateRef.current);
				dispatch({ type: "settle" });
				if (settleResult.fire) {
					void createBoardWithQueueRef.current?.(settleResult.fire);
				}
			}
		},
		[
			activeWorkspaceId,
			boardRef,
			setBoard,
			showToast,
			clearFollowUpAgentEvents,
			agentEventsRef,
		],
	);

	sendMessageRef.current = sendMessage;

	// ---- createBoardWithQueue (settlement bridge over createBoard) ----
	const createBoardWithQueue = useCallback(
		async (intent: string) => {
			await createBoard(intent);
			// Settlement bridge — route next queued item.
			const settleResult = settle(queueStateRef.current);
			dispatch({ type: "settle" });
			if (settleResult.fire) {
				const route = routeNext(settleResult.fire, boardRef.current !== null);
				if (route === "createBoard")
					void createBoardWithQueueRef.current?.(settleResult.fire);
				else if (route === "sendMessage")
					void sendMessageRef.current?.(settleResult.fire);
			}
		},
		[createBoard, boardRef],
	);

	createBoardWithQueueRef.current = createBoardWithQueue;

	// ---- Effects ----

	// Load follow-up messages when board changes.
	useEffect(() => {
		if (board?.conversations) {
			setFollowUpMessages(conversationsToFollowUpMessages(board.conversations));
		}
	}, [board?.conversations]);

	// Reset follow-up state when board changes (new board loaded).
	useEffect(() => {
		if (!board) {
			setFollowUpMessages([]);
			setPendingRegenerate(false);
		}
	}, [board]);

	// Auto-expand log when execution starts.
	useEffect(() => {
		if (board?.executionStatus === "running") setIsLogExpanded(true);
	}, [board?.executionStatus]);

	// Auto-scroll event log when events change.
	useEffect(() => {
		logEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

	// ---- Actions ----

	// Confirm regenerate.
	const handleConfirmRegenerate = useCallback(async () => {
		const currentBoard = boardRef.current;
		const cannotRegenerate =
			!activeWorkspaceId || !currentBoard || !pendingRegenerate;
		if (cannotRegenerate) return;
		setBusy(true);
		try {
			clearAgentEvents();
			await api.sendAgentBoardMessage(activeWorkspaceId, currentBoard.id, {
				action: "confirm_regenerate",
			});
			setPendingRegenerate(false);
			const updated = await api.getAgentBoard(
				activeWorkspaceId,
				currentBoard.id,
			);
			setBoard(updated);
			setFollowUpMessages(
				conversationsToFollowUpMessages(updated.conversations),
			);
		} catch {
			showToast("Couldn't confirm regeneration. Try again.");
		} finally {
			setBusy(false);
		}
	}, [
		activeWorkspaceId,
		pendingRegenerate,
		showToast,
		clearAgentEvents,
		boardRef,
		setBoard,
	]);

	// Cancel regenerate.
	const handleCancelRegenerate = useCallback(async () => {
		const currentBoard = boardRef.current;
		const cannotRegenerate =
			!activeWorkspaceId || !currentBoard || !pendingRegenerate;
		if (cannotRegenerate) return;
		setBusy(true);
		try {
			const result = await api.sendAgentBoardMessage(
				activeWorkspaceId,
				currentBoard.id,
				{
					action: "cancel_regenerate",
				},
			);
			setPendingRegenerate(false);
			if (result.explanation) {
				setFollowUpMessages((prev) => [
					...prev,
					{ role: ROLE_ASSISTANT, content: result.explanation },
				]);
			}
		} catch {
			showToast("Couldn't cancel regeneration. Try again.");
		} finally {
			setBusy(false);
		}
	}, [activeWorkspaceId, pendingRegenerate, showToast, boardRef]);

	// Submit handler — routes through queue.
	const handleSend = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed || busy) return;
		setInput("");
		setLastIntent(trimmed);

		const isFollowUp = board?.executionStatus === "done";

		if (isFollowUp) {
			const streamed = board
				? getStreamingFollowUpText(agentEventsRef.current ?? [], board.id)
				: "";
			if (streamed) {
				setFollowUpMessages((prev) => [
					...prev,
					{ role: ROLE_ASSISTANT, content: streamed },
				]);
			}
			clearFollowUpAgentEvents();
			setFollowUpMessages((prev) => [
				...prev,
				{ role: "user", content: trimmed },
			]);
		}

		if (!board) {
			const qResult = queueSubmit(queueStateRef.current, trimmed);
			dispatch({ type: "submit", message: trimmed });
			if (qResult.fire) {
				void createBoardWithQueue(qResult.fire);
			}
			return;
		}

		const result = queueSubmit(queueStateRef.current, trimmed);
		dispatch({ type: "submit", message: trimmed });

		if (result.fire) {
			if (!isFollowUp) {
				clearAgentEvents();
			}
			void sendMessage(result.fire);
		}
	}, [
		input,
		busy,
		board,
		clearAgentEvents,
		clearFollowUpAgentEvents,
		sendMessage,
		createBoardWithQueue,
		agentEventsRef,
	]);

	// Reset queue and error state (used by parent on error retry).
	const resetQueue = useCallback(() => {
		dispatch({ type: "reset" });
	}, []);

	// ---- Computed values ----

	const isRunning = board?.executionStatus === "running";
	const isPending = board?.status === "pending";
	const isDone = board?.executionStatus === "done";
	const isFailed = board?.executionStatus === "failed";
	const canFollowUp = isDone;

	// Exclude follow-up stream events from column state + execution log metrics.
	const columnAgentEvents = useMemo(
		() => agentEvents.filter((e) => !isFollowUpSlug(e.columnSlug)),
		[agentEvents],
	);

	// Streaming follow-up text (live chat bubble).
	const streamingFollowUpText = useMemo(() => {
		if (!board) return "";
		const text = getStreamingFollowUpText(agentEvents, board.id);
		if (!text) return "";
		if (
			followUpMessages.some(
				(m) => m.role === ROLE_ASSISTANT && m.content === text,
			)
		) {
			return "";
		}
		return text;
	}, [agentEvents, board, followUpMessages]);

	// Streaming = output or thinking deltas.
	const isStreaming =
		isRunning &&
		columnAgentEvents.some(
			(e) => e.type === "agent.card.token" || e.type === "agent.card.thinking",
		);

	// Filter batched stream chunks from the log.
	const logEvents = columnAgentEvents.filter(
		(e) => e.type !== "agent.card.token" && e.type !== "agent.card.thinking",
	);
	const tokenCount = columnAgentEvents.filter(
		(e) => e.type === "agent.card.token",
	).length;

	const inputDisabled =
		busy ||
		isRunning ||
		pendingRegenerate ||
		(board !== null && !canFollowUp && !isPending);
	const sendDisabled = inputDisabled || !input.trim();

	return {
		// Input state
		input,
		setInput,
		// Chat state
		busy,
		setBusy,
		followUpMessages,
		pendingRegenerate,
		lastIntent,
		setLastIntent,
		// Queue state
		queueState,
		resetQueue,
		// Log state
		isLogExpanded,
		setIsLogExpanded,
		logEndRef,
		// Actions
		handleSend,
		handleConfirmRegenerate,
		handleCancelRegenerate,
		// Computed values for AgentChatPanel
		isRunning: !!isRunning,
		isPending: !!isPending,
		isDone: !!isDone,
		isFailed: !!isFailed,
		canFollowUp: !!canFollowUp,
		isStreaming,
		logEvents,
		tokenCount,
		columnAgentEvents,
		inputDisabled,
		sendDisabled,
		streamingFollowUpText,
	};
}
