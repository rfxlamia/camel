import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import { useBoard } from "../board";
import { type AgentBoardScope, useAgentBoardData } from "./useAgentBoardData";

export function useAgentBoard() {
	const { activeWorkspaceId } = useWorkspace();
	const showToast = useShowToast();
	const { agentEvents, connectionRevision, clearAgentEvents } = useBoard();
	const [searchParams, setSearchParams] = useSearchParams();
	const selectedId = searchParams.get("boardId");
	const boardId = selectedId ? Number(selectedId) : null;
	const scopeRef = useRef<AgentBoardScope>({
		workspaceId: activeWorkspaceId,
		boardId,
	});
	if (
		scopeRef.current.workspaceId !== activeWorkspaceId ||
		scopeRef.current.boardId !== boardId
	) {
		// A new object also distinguishes leaving and returning to the same board.
		scopeRef.current = { workspaceId: activeWorkspaceId, boardId };
	}
	const scope = scopeRef.current;
	const onLoadError = useCallback(() => {
		showToast("Couldn't load the board.", "error");
		setSearchParams({}, { replace: true });
	}, [showToast, setSearchParams]);
	const {
		board,
		setBoard,
		boardRef,
		loading,
		artifact,
		fetchBoard,
		adoptBoard,
	} = useAgentBoardData({
		scope,
		scopeRef,
		agentEvents,
		connectionRevision,
		clearAgentEvents,
		onLoadError,
	});
	const [creating, setCreating] = useState(false);
	const [approveBusy, setApproveBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const busyRef = useRef<{ scope: AgentBoardScope } | null>(null);
	const [actionScope, setActionScope] = useState(scope);
	if (actionScope !== scope) {
		setActionScope(scope);
		setCreating(false);
		setApproveBusy(false);
		setError(null);
		busyRef.current = null;
	}

	const createBoard = useCallback(
		async (intent: string) => {
			if (scope.workspaceId === null || busyRef.current) return;
			const action = { scope };
			busyRef.current = action;
			setCreating(true);
			setError(null);
			try {
				clearAgentEvents();
				const result = await api.createAgentBoard(scope.workspaceId, intent);
				if (scopeRef.current !== scope) return;
				const createdBoard = await api.getAgentBoard(
					scope.workspaceId,
					result.boardId,
				);
				if (scopeRef.current !== scope) return;
				// Chat queue settlement awaits this operation and then reads boardRef.
				// Adopt the target scope as well so navigation does not clear its board.
				const nextScope = {
					workspaceId: scope.workspaceId,
					boardId: result.boardId,
				};
				scopeRef.current = nextScope;
				adoptBoard(createdBoard, nextScope);
				setSearchParams({ boardId: String(result.boardId) }, { replace: true });
			} catch (err) {
				if (scopeRef.current !== scope) return;
				if (err instanceof ApiError && err.status === 422)
					setError(err.message);
				else showToast("Couldn't create the board. Try again.", "error");
			} finally {
				if (busyRef.current === action) {
					busyRef.current = null;
					setCreating(false);
				}
			}
		},
		[scope, setSearchParams, showToast, clearAgentEvents, adoptBoard],
	);

	// Approval remains pending-only. Retry creates a new attempt; never mutates the source.
	const handleApproveOrRetry = useCallback(
		async (mode?: "retry") => {
			if (
				scope.workspaceId === null ||
				!board ||
				board.id !== scope.boardId ||
				busyRef.current
			)
				return;
			const action = { scope };
			busyRef.current = action;
			setApproveBusy(true);
			setError(null);
			try {
				if (mode === "retry") {
					const result = await api.retryAgentBoard(scope.workspaceId, board.id);
					if (scopeRef.current !== scope) return;
					setSearchParams(
						{ boardId: String(result.boardId) },
						{ replace: true },
					);
				} else {
					await api.approveAgentBoard(scope.workspaceId, board.id);
					if (scopeRef.current !== scope) return;
					clearAgentEvents();
					await fetchBoard();
				}
			} catch (err) {
				if (scopeRef.current !== scope) return;
				if (err instanceof ApiError) setError(err.message);
				else
					showToast(
						mode === "retry"
							? "Couldn't retry. Try again."
							: "Couldn't approve the board. Try again.",
						"error",
					);
			} finally {
				if (busyRef.current === action) {
					busyRef.current = null;
					setApproveBusy(false);
				}
			}
		},
		[scope, board, clearAgentEvents, fetchBoard, setSearchParams, showToast],
	);

	const handleNewBoard = useCallback(() => {
		setBoard(null);
		setSearchParams({}, { replace: true });
		clearAgentEvents();
		setError(null);
	}, [setBoard, setSearchParams, clearAgentEvents]);

	return {
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
		searchParams,
		setSearchParams,
		activeWorkspaceId,
		clearAgentEvents,
		agentEvents,
		showToast,
	};
}
