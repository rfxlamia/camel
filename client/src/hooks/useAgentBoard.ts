import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError, api } from "../api";
import { useBoard } from "../context/BoardContext";
import { shouldRefetchBoardOnTerminalEvent } from "../lib/agentBoardSync";
import type { AgentArtifact, AgentBoard } from "../types";

export function useAgentBoard() {
	const { activeWorkspaceId, showToast, agentEvents, clearAgentEvents } =
		useBoard();
	const [searchParams, setSearchParams] = useSearchParams();

	const [board, setBoard] = useState<AgentBoard | null>(null);
	const boardRef = useRef<AgentBoard | null>(board);
	boardRef.current = board;
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [artifact, setArtifact] = useState<AgentArtifact | null>(null);
	const lastSyncedTerminalIdxRef = useRef(-1);

	// Load board from URL param when workspace or boardId changes.
	useEffect(() => {
		const boardId = searchParams.get("boardId");
		if (!boardId || !activeWorkspaceId) {
			setBoard(null);
			return;
		}
		lastSyncedTerminalIdxRef.current = -1;
		clearAgentEvents();
		let cancelled = false;
		setLoading(true);
		api
			.getAgentBoard(activeWorkspaceId, Number(boardId))
			.then((b) => {
				if (!cancelled) {
					setBoard(b);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setBoard(null);
					showToast("Couldn't load the board.");
					setSearchParams({}, { replace: true });
				}
			})
			.finally(() => {
				setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [
		activeWorkspaceId,
		searchParams,
		setSearchParams,
		showToast,
		clearAgentEvents,
	]);

	// Re-fetch board once per terminal agent event (done/failed).
	useEffect(() => {
		if (!activeWorkspaceId) return;
		const boardId = boardRef.current?.id;
		if (!boardId) return;

		const { shouldFetch, eventIndex } = shouldRefetchBoardOnTerminalEvent(
			agentEvents,
			lastSyncedTerminalIdxRef.current,
		);
		if (!shouldFetch) return;

		lastSyncedTerminalIdxRef.current = eventIndex;
		api
			.getAgentBoard(activeWorkspaceId, boardId)
			.then((b) => {
				setBoard(b);
			})
			// biome-ignore lint/suspicious/noEmptyBlockStatements: intentionally ignoring board fetch errors
			.catch(() => {});
	}, [agentEvents, activeWorkspaceId]);

	// Fetch deliverable artifact when execution completes.
	useEffect(() => {
		if (!activeWorkspaceId || !board?.id || board.executionStatus !== "done") {
			setArtifact(null);
			return;
		}

		let cancelled = false;
		api
			.getAgentArtifact(activeWorkspaceId, board.id)
			.then((a) => {
				if (!cancelled) setArtifact(a);
			})
			.catch(() => {
				if (!cancelled) setArtifact(null);
			});

		return () => {
			cancelled = true;
		};
	}, [activeWorkspaceId, board?.id, board?.executionStatus]);

	// Create a new board (queue-agnostic — parent wraps with settlement).
	const createBoard = useCallback(
		async (intent: string) => {
			if (!activeWorkspaceId) return;
			try {
				clearAgentEvents();
				const result = await api.createAgentBoard(activeWorkspaceId, intent);
				const b = await api.getAgentBoard(activeWorkspaceId, result.boardId);
				setBoard(b);
				boardRef.current = b;
				setSearchParams({ boardId: String(result.boardId) }, { replace: true });
			} catch (err) {
				if (err instanceof ApiError && err.status === 422) {
					setError(err.message);
				} else {
					showToast("Couldn't create the board. Try again.");
				}
			}
		},
		[activeWorkspaceId, clearAgentEvents, setSearchParams, showToast],
	);

	// Approve or retry execution (merged — identical logic, different toast).
	// Manages busy state internally.
	const [approveBusy, setApproveBusy] = useState(false);
	const handleApproveOrRetry = useCallback(
		async (mode?: "retry") => {
			if (!activeWorkspaceId || !board) return;
			setApproveBusy(true);
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
					showToast(
						mode === "retry"
							? "Couldn't retry. Try again."
							: "Couldn't approve the board. Try again.",
					);
				}
			} finally {
				setApproveBusy(false);
			}
		},
		[activeWorkspaceId, board, clearAgentEvents, showToast],
	);

	// New board handler
	const handleNewBoard = useCallback(() => {
		setBoard(null);
		setSearchParams({}, { replace: true });
		clearAgentEvents();
		setError(null);
	}, [setSearchParams, clearAgentEvents]);

	return {
		board,
		setBoard,
		boardRef,
		loading,
		error,
		setError,
		artifact,
		createBoard,
		approveBusy,
		handleApproveOrRetry,
		handleNewBoard,
		searchParams,
		setSearchParams,
		activeWorkspaceId,
		clearAgentEvents,
		agentEvents,
		showToast,
	};
}
