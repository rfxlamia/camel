import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { api } from "../../api";
import type { AgentArtifact, AgentEvent } from "../../types";
import { shouldRefetchBoardOnSyncEvent } from "./agentBoardSync";
import type { AgentBoardAttempt } from "./agentBoardTypes";

export interface AgentBoardScope {
	workspaceId: number | null;
	boardId: number | null;
}

export function useAgentBoardData({
	scope,
	scopeRef,
	agentEvents,
	connectionRevision,
	clearAgentEvents,
	onLoadError,
}: {
	scope: AgentBoardScope;
	scopeRef: MutableRefObject<AgentBoardScope>;
	agentEvents: AgentEvent[];
	connectionRevision: number;
	clearAgentEvents: () => void;
	onLoadError: () => void;
}) {
	const [board, setBoard] = useState<AgentBoardAttempt | null>(null);
	const boardRef = useRef<AgentBoardAttempt | null>(board);
	boardRef.current = board;
	const [loading, setLoading] = useState(false);
	const [artifact, setArtifact] = useState<AgentArtifact | null>(null);
	const [dataScope, setDataScope] = useState(scope);
	const requestRevision = useRef(0);
	const syncRef = useRef({ scope, connectionRevision, eventIndex: -1 });
	if (dataScope !== scope) {
		setDataScope(scope);
		setBoard(null);
		boardRef.current = null;
		setArtifact(null);
		setLoading(false);
	}

	const adoptBoard = useCallback(
		(next: AgentBoardAttempt, nextScope: AgentBoardScope) => {
			setDataScope(nextScope);
			setBoard(next);
			boardRef.current = next;
			setArtifact(null);
		},
		[],
	);

	// Every fetch, including approval and reconnect, shares a latest-request guard.
	const fetchBoard = useCallback(
		async (initial = false) => {
			if (scope.workspaceId === null || scope.boardId === null) return;
			const request = ++requestRevision.current;
			const isCurrent = () =>
				scopeRef.current === scope && requestRevision.current === request;
			setLoading(true);
			try {
				const result = await api.getAgentBoard(
					scope.workspaceId,
					scope.boardId,
				);
				if (isCurrent()) setBoard(result);
			} catch (err) {
				if (!isCurrent()) return;
				if (initial) {
					setBoard(null);
					onLoadError();
				} else {
					console.debug("agent board fetch failed", err);
				}
			} finally {
				if (isCurrent()) setLoading(false);
			}
		},
		[scope, scopeRef, onLoadError],
	);

	useEffect(() => {
		clearAgentEvents();
		void fetchBoard(true);
		return () => {
			requestRevision.current++;
		};
	}, [fetchBoard, clearAgentEvents]);

	useEffect(() => {
		const previous = syncRef.current;
		if (previous.scope !== scope) {
			syncRef.current = { scope, connectionRevision, eventIndex: -1 };
			return;
		}
		if (agentEvents.length === 0) previous.eventIndex = -1;
		const { shouldFetch, eventIndex } = shouldRefetchBoardOnSyncEvent(
			agentEvents,
			previous.eventIndex,
			scope.boardId ?? undefined,
		);
		const reconnected = previous.connectionRevision !== connectionRevision;
		previous.connectionRevision = connectionRevision;
		previous.eventIndex = eventIndex;
		if (shouldFetch || reconnected) void fetchBoard();
	}, [agentEvents, connectionRevision, scope, fetchBoard]);

	useEffect(() => {
		if (
			scope.workspaceId === null ||
			board?.id !== scope.boardId ||
			board?.executionStatus !== "done"
		) {
			setArtifact(null);
			return;
		}
		let cancelled = false;
		api
			.getAgentArtifact(scope.workspaceId, board.id)
			.then((result) => {
				if (!cancelled && scopeRef.current === scope) setArtifact(result);
			})
			.catch(() => {
				if (!cancelled && scopeRef.current === scope) setArtifact(null);
			});
		return () => {
			cancelled = true;
		};
	}, [scope, scopeRef, board?.id, board?.executionStatus]);

	return {
		board,
		setBoard,
		boardRef,
		artifact,
		loading,
		fetchBoard,
		adoptBoard,
	};
}
