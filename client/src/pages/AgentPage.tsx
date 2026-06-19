import { Bot } from "lucide-react";
import { useCallback, useReducer, useRef, useState } from "react";
import { api } from "../api";
import AgentCardDetail from "../components/AgentCardDetail";
import AgentBoardHeader from "../components/agent/AgentBoardHeader";
import AgentBoardVisual from "../components/agent/AgentBoardVisual";
import AgentChatPanel from "../components/agent/AgentChatPanel";
import { useBoard } from "../context/BoardContext";
import { useAgentBoard } from "../hooks/useAgentBoard";
import { getStreamingFollowUpText, useAgentChat } from "../hooks/useAgentChat";
import type { FollowUpMessage } from "../lib/agentFollowUp";
import {
	initialQueue,
	type QueueState,
	submit as queueSubmit,
	routeNext,
	settle,
} from "../lib/agentQueue";
import type { AgentColumn } from "../types";

// ---- Agent board message helpers ----

type AgentBoardMessagePayload =
	| string
	| { action: "confirm_regenerate" | "cancel_regenerate" };

type AgentBoardMessageResult = {
	explanation: string;
	boardUpdated: boolean;
	streamed?: boolean;
	pendingRegenerate?: boolean;
};

const sendBoardMessage = api.sendAgentBoardMessage as (
	workspaceId: number,
	boardId: number,
	payload: AgentBoardMessagePayload,
) => Promise<AgentBoardMessageResult>;

// ---- Queue reducer (parent-owned) ----

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

// ---- Component ----

export default function AgentPage() {
	const { clearFollowUpAgentEvents } = useBoard();

	// ---- Queue state (parent-owned for cross-hook access) ----
	const [queueState, dispatch] = useReducer(queueReducer, initialQueue);
	const queueStateRef = useRef(queueState);
	queueStateRef.current = queueState;

	// ---- Board domain hook ----
	const {
		board,
		setBoard,
		boardRef,
		loading,
		error,
		setError,
		artifact,
		createBoard,
		handleApproveOrRetry,
		handleNewBoard,
		activeWorkspaceId,
		clearAgentEvents,
		agentEvents,
		showToast,
	} = useAgentBoard();

	// ---- Refs for cross-wiring ----
	const agentEventsRef = useRef(agentEvents);
	agentEventsRef.current = agentEvents;
	const setFollowUpMessagesRef =
		useRef<React.Dispatch<React.SetStateAction<FollowUpMessage[]>>>(undefined);
	const setPendingRegenerateRef =
		useRef<React.Dispatch<React.SetStateAction<boolean>>>(undefined);

	// ---- sendMessage (parent-owned, queue-aware) ----
	const sendMessageRef = useRef<((msg: string) => Promise<void>) | null>(null);
	const createBoardWithQueueRef = useRef<
		((intent: string) => Promise<void>) | null
	>(null);

	const sendMessage = useCallback(
		async (msg: string) => {
			const currentBoard = boardRef.current;
			if (!activeWorkspaceId || !currentBoard) return;
			try {
				const result = await sendBoardMessage(
					activeWorkspaceId,
					currentBoard.id,
					msg,
				);
				if (result.pendingRegenerate) {
					setPendingRegenerateRef.current?.(true);
					setFollowUpMessagesRef.current?.((prev) => [
						...prev,
						{
							role: "assistant" as const,
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
					setFollowUpMessagesRef.current?.((prev) => {
						if (
							prev.some(
								(m) => m.role === "assistant" && m.content === streamedText,
							)
						) {
							return prev;
						}
						return [
							...prev,
							{ role: "assistant" as const, content: streamedText },
						];
					});
					clearFollowUpAgentEvents();
				} else if (result.explanation) {
					setFollowUpMessagesRef.current?.((prev) => [
						...prev,
						{ role: "assistant" as const, content: result.explanation },
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
				// Settlement bridge
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
		],
	);

	sendMessageRef.current = sendMessage;

	// ---- createBoardWithQueue (settlement bridge over createBoard) ----
	const createBoardWithQueue = useCallback(
		async (intent: string) => {
			await createBoard(intent);
			// Settlement bridge
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

	// ---- Chat domain hook ----
	const chat = useAgentChat({
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
	});

	// Mirror chat functions to refs for sendMessage access
	setFollowUpMessagesRef.current = chat.setFollowUpMessages;
	setPendingRegenerateRef.current = chat.setPendingRegenerate;

	// ---- Detail column state (stays in parent — third panel) ----
	const [detailColumn, setDetailColumn] = useState<AgentColumn | null>(null);

	// ---- Handlers ----
	const handleApprove = useCallback(() => {
		chat.setBusy(true);
		setError(null);
		handleApproveOrRetry().finally(() => chat.setBusy(false));
	}, [handleApproveOrRetry, chat.setBusy, setError]);

	const handleRetryExecution = useCallback(() => {
		chat.setBusy(true);
		setError(null);
		handleApproveOrRetry("retry").finally(() => chat.setBusy(false));
	}, [handleApproveOrRetry, chat.setBusy, setError]);

	const handleResetError = useCallback(() => {
		setError(null);
		clearAgentEvents();
		chat.setLastIntent(null);
		chat.setBusy(false);
		dispatch({ type: "reset" });
		if (chat.lastIntent) {
			chat.setInput(chat.lastIntent);
		}
	}, [setError, clearAgentEvents, chat]);

	// ---- Early returns ----
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

	return (
		<div className="flex h-full">
			{/* Left panel — board visual or empty state */}
			<div className="flex-1 overflow-auto border-r border-neutral-200">
				{!board ? (
					<div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 translate-x-[48px] pt-32">
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
					<div>
						<AgentBoardHeader board={board} onNewBoard={handleNewBoard} />
						<AgentBoardVisual
							board={board}
							onCardClick={setDetailColumn}
							agentEvents={chat.columnAgentEvents}
						/>
					</div>
				)}
			</div>

			{/* Right panel — chat + execution log */}
			<AgentChatPanel
				board={board}
				lastIntent={chat.lastIntent}
				followUpMessages={chat.followUpMessages}
				streamingFollowUpText={chat.streamingFollowUpText}
				pendingRegenerate={chat.pendingRegenerate}
				error={error}
				artifact={artifact}
				queueState={queueState}
				input={chat.input}
				setInput={chat.setInput}
				busy={chat.busy}
				inputDisabled={chat.inputDisabled}
				sendDisabled={chat.sendDisabled}
				isRunning={chat.isRunning}
				isPending={chat.isPending}
				isDone={chat.isDone}
				isFailed={chat.isFailed}
				canFollowUp={chat.canFollowUp}
				isStreaming={chat.isStreaming}
				logEvents={chat.logEvents}
				tokenCount={chat.tokenCount}
				isLogExpanded={chat.isLogExpanded}
				setIsLogExpanded={chat.setIsLogExpanded}
				logEndRef={chat.logEndRef}
				activeWorkspaceId={activeWorkspaceId}
				onSend={chat.handleSend}
				onApprove={handleApprove}
				onRetryExecution={handleRetryExecution}
				onConfirmRegenerate={chat.handleConfirmRegenerate}
				onCancelRegenerate={chat.handleCancelRegenerate}
				onResetError={handleResetError}
				agentArtifactDownloadUrl={
					board && activeWorkspaceId
						? api.agentArtifactDownloadUrl(activeWorkspaceId, board.id)
						: ""
				}
			/>

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
