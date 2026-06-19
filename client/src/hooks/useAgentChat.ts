import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { FollowUpMessage } from "../lib/agentFollowUp";
import { conversationsToFollowUpMessages } from "../lib/agentFollowUp";
import {
	type QueueState,
	submit as queueSubmit,
	settle,
} from "../lib/agentQueue";
import type { AgentBoard, AgentEvent } from "../types";

// ---- Queue action type ----

export type QueueAction =
	| { type: "submit"; message: string }
	| { type: "settle" }
	| { type: "reset" };

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
	createBoardWithQueue: (intent: string) => Promise<void>;
	sendMessage: (msg: string) => Promise<void>;
	setBoard: Dispatch<SetStateAction<AgentBoard | null>>;
	activeWorkspaceId: number | null;
	showToast: (msg: string) => void;
	clearAgentEvents: () => void;
	clearFollowUpAgentEvents: () => void;
	agentEvents: AgentEvent[];
	agentEventsRef: MutableRefObject<AgentEvent[]>;
	queueState: QueueState;
	dispatch: Dispatch<QueueAction>;
	queueStateRef: MutableRefObject<QueueState>;
}

// ---- Hook ----

export function useAgentChat(config: UseAgentChatConfig) {
	const {
		board,
		boardRef,
		createBoardWithQueue,
		sendMessage,
		setBoard,
		activeWorkspaceId,
		showToast,
		clearAgentEvents,
		clearFollowUpAgentEvents,
		agentEvents,
		agentEventsRef,
		queueState,
		dispatch,
		queueStateRef,
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

	// Auto-scroll event log.
	useEffect(() => {
		logEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, []);

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

	// Submit handler — uses queue.
	const handleSend = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed || busy) return;
		setInput("");
		setBusy(true);
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
			setBusy(false);
			if (qResult.fire) {
				void createBoardWithQueue(qResult.fire);
			}
			return;
		}

		const result = queueSubmit(queueStateRef.current, trimmed);
		dispatch({ type: "submit", message: trimmed });
		setBusy(false);

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
		queueStateRef,
		dispatch,
	]);

	// Compute log-related values.
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

	// Settle queue — returns the next message to fire, if any.
	const settleQueue = useCallback(() => {
		const settleResult = settle(queueStateRef.current);
		dispatch({ type: "settle" });
		return settleResult.fire;
	}, [queueStateRef, dispatch]);

	// Reset queue to initial state.
	const resetQueue = useCallback(() => {
		dispatch({ type: "reset" });
	}, [dispatch]);

	return {
		input,
		setInput,
		busy,
		setBusy,
		followUpMessages,
		setFollowUpMessages,
		pendingRegenerate,
		setPendingRegenerate,
		lastIntent,
		setLastIntent,
		error: null as string | null, // error state managed in parent
		queueState,
		dispatch,
		queueStateRef,
		isLogExpanded,
		setIsLogExpanded,
		logEndRef,
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
		settleQueue,
		resetQueue,
	};
}
