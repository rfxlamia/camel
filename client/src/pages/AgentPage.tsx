import { useCallback, useRef, useState } from "react";
import { api } from "../api";
import AgentCardDetail from "../components/AgentCardDetail";
import AgentBoardHeader from "../components/agent/AgentBoardHeader";
import AgentBoardVisual from "../components/agent/AgentBoardVisual";
import AgentChatPanel from "../components/agent/AgentChatPanel";
import AgentComposer from "../components/agent/AgentComposer";
import LoadingCamel from "../components/LoadingCamel";
import { useBoard } from "../context/BoardContext";
import { useAgentBoard } from "../hooks/useAgentBoard";
import { useAgentChat } from "../hooks/useAgentChat";
import type { AgentColumn } from "../types";

export default function AgentPage() {
	const { clearFollowUpAgentEvents } = useBoard();

	// ---- Board domain hook ----
	const {
		board,
		setBoard,
		boardRef,
		loading,
		creating,
		error,
		setError,
		artifact,
		createBoard,
		approveBusy,
		handleApproveOrRetry,
		handleNewBoard,
		activeWorkspaceId,
		clearAgentEvents,
		agentEvents,
		showToast,
	} = useAgentBoard();

	// ---- Refs for stable access in effects/callbacks ----
	const agentEventsRef = useRef(agentEvents);
	agentEventsRef.current = agentEvents;

	// Stable error-clearing callback shared by the chat hook and reset handler.
	const clearError = useCallback(() => setError(null), [setError]);

	// ---- Chat domain hook (owns sendMessage + queue internally) ----
	const chat = useAgentChat({
		board,
		boardRef,
		createBoard,
		setBoard,
		activeWorkspaceId,
		showToast,
		clearError,
		clearAgentEvents,
		clearFollowUpAgentEvents,
		agentEvents,
		agentEventsRef,
	});

	// ---- Detail column state (slide-over drawer) ----
	const [detailColumn, setDetailColumn] = useState<AgentColumn | null>(null);

	// ---- Handlers ----
	const handleApprove = useCallback(() => {
		void handleApproveOrRetry();
	}, [handleApproveOrRetry]);

	const handleRetryExecution = useCallback(() => {
		void handleApproveOrRetry("retry");
	}, [handleApproveOrRetry]);

	const handleResetError = useCallback(() => {
		clearError();
		clearAgentEvents();
		chat.setLastIntent(null);
		chat.setBusy(false);
		chat.resetQueue();
		if (chat.lastIntent) {
			chat.setInput(chat.lastIntent);
		}
	}, [
		clearError,
		clearAgentEvents,
		chat.setLastIntent,
		chat.setBusy,
		chat.resetQueue,
		chat.setInput,
		chat.lastIntent,
	]);

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

	// ---- Empty / generating state — single focused surface, no split ----
	if (!board) {
		if (creating) {
			return (
				<div className="flex min-h-full items-center justify-center p-8">
					<div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
						<LoadingCamel size={88} />
						<div>
							<h2 className="text-lg font-semibold text-neutral-900">
								Designing your board…
							</h2>
							<p className="mt-1 text-sm text-neutral-500">
								Drafting specialist columns for your request.
							</p>
						</div>
						{chat.lastIntent && (
							<p className="max-w-sm rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm italic text-neutral-600 shadow-sm">
								“{chat.lastIntent}”
							</p>
						)}
					</div>
				</div>
			);
		}
		return (
			<AgentComposer
				input={chat.input}
				setInput={chat.setInput}
				onSend={chat.handleSend}
				inputDisabled={chat.inputDisabled}
				sendDisabled={chat.sendDisabled}
				error={error}
				onResetError={handleResetError}
			/>
		);
	}

	// ---- Working state — board pipeline + conversation rail ----
	return (
		<div className="flex h-full min-h-0 flex-col md:flex-row">
			{/* Board area */}
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<AgentBoardHeader board={board} onNewBoard={handleNewBoard} />
				<div className="animate-fade-in min-h-0 flex-1 overflow-auto">
					<AgentBoardVisual
						board={board}
						onCardClick={setDetailColumn}
						agentEvents={chat.columnAgentEvents}
					/>
				</div>
			</div>

			{/* Conversation rail */}
			<AgentChatPanel
				board={board}
				creating={creating}
				lastIntent={chat.lastIntent}
				followUpMessages={chat.followUpMessages}
				streamingFollowUpText={chat.streamingFollowUpText}
				pendingRegenerate={chat.pendingRegenerate}
				error={error}
				artifact={artifact}
				queueState={chat.queueState}
				input={chat.input}
				setInput={chat.setInput}
				busy={chat.busy || approveBusy}
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

			{/* Card detail drawer */}
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
