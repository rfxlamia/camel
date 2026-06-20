import { Bot } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api } from "../api";
import AgentCardDetail from "../components/AgentCardDetail";
import AgentBoardHeader from "../components/agent/AgentBoardHeader";
import AgentBoardVisual from "../components/agent/AgentBoardVisual";
import AgentChatPanel from "../components/agent/AgentChatPanel";
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

	// ---- Detail column state (third panel) ----
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

	return (
		<div className="flex h-full">
			{/* Left panel — board visual or empty state */}
			<div className="flex-1 overflow-auto border-r border-neutral-200">
				{!board ? (
					creating ? (
						<div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
							<LoadingCamel size={80} />
							<p className="text-sm text-neutral-500 animate-pulse">
								Generating board...
							</p>
						</div>
					) : (
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
					)
				) : (
					<div className="transition-opacity duration-300">
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
