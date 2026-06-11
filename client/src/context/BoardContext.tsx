import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ApiError, api } from "../api";
import type {
  ActivityEvent,
  Column,
  FlowMetrics,
  PresenceUser,
  User,
} from "../types";

const HEARTBEAT_INTERVAL_MS = 25_000;
const PRESENCE_REFRESH_MS = 30_000;

/** Outcome of a save, so callers (e.g. the context panel) can react to a 409. */
export type SaveCardResult = "saved" | "conflict" | "error";

interface BoardContextValue {
  user: User;
  columns: Column[] | null;
  setColumns: Dispatch<SetStateAction<Column[] | null>>;
  metrics: FlowMetrics | null;
  activity: ActivityEvent[];
  presence: PresenceUser[];
  loadError: boolean;
  /** Bumped after every successful refresh so pages can refetch derived data. */
  refreshTick: number;
  refresh: () => Promise<void>;
  saveCard: (
    id: number,
    patch: { title?: string; description?: string; version?: number },
  ) => Promise<SaveCardResult>;
  deleteCard: (id: number) => Promise<void>;
  toast: string | null;
  showToast: (message: string) => void;
  logout: () => Promise<void>;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard must be used within BoardProvider");
  return ctx;
}

interface Props {
  user: User;
  onSignedOut: () => void;
  children: ReactNode;
}

/**
 * Holds board data and the real-time wiring (SSE, heartbeat, presence) at the
 * app root, above the router, so navigation never drops the connection and
 * board state persists across pages.
 */
export function BoardProvider({ user, onSignedOut, children }: Props) {
  const [columns, setColumns] = useState<Column[] | null>(null);
  const [metrics, setMetrics] = useState<FlowMetrics | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [board, m, a] = await Promise.all([
        api.getBoard(),
        api.getMetrics(),
        api.getActivity(),
      ]);
      setColumns(board.columns);
      setMetrics(m);
      setActivity(a.events);
      setLoadError(false);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSignedOut();
        return;
      }
      setLoadError(true);
    }
  }, [onSignedOut]);

  // Board + collaboration wiring, active for the signed-in session.
  useEffect(() => {
    void refresh();

    const beat = () => {
      void api.heartbeat().catch(() => {});
      void api.getPresence().then(({ users }) => setPresence(users)).catch(() => {});
    };
    beat();
    const heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    const presenceTimer = setInterval(
      () => void api.getPresence().then(({ users }) => setPresence(users)).catch(() => {}),
      PRESENCE_REFRESH_MS,
    );

    // Live updates: server pushes board events over SSE; EventSource
    // reconnects on its own after a dropped connection.
    const stream = new EventSource("/api/events/stream");
    stream.onmessage = () => void refresh();

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(presenceTimer);
      stream.close();
    };
  }, [refresh]);

  // Card mutations live here (not in BoardPage) so the route-sibling context
  // panel can call them. Logic ported verbatim from BoardPage, including the
  // optimistic-locking version + 409 conflict flow.
  const saveCard = useCallback(
    async (
      id: number,
      patch: { title?: string; description?: string; version?: number },
    ): Promise<SaveCardResult> => {
      // Callers editing a draft pass the version their draft is based on, so
      // a teammate's concurrent change still 409s even though SSE already
      // refreshed columns. Without it, fall back to the live version.
      const current = columns
        ?.flatMap((col) => col.cards)
        .find((c) => c.id === id);
      try {
        await api.updateCard(id, { ...patch, version: patch.version ?? current?.version });
        await refresh();
        return "saved";
      } catch (err) {
        if (err instanceof ApiError && err.code === "version_conflict") {
          showToast("Someone else updated this card first — board refreshed.");
          await refresh();
          return "conflict";
        }
        showToast("Couldn't save the card. Check your connection and try again.");
        return "error";
      }
    },
    [columns, refresh, showToast],
  );

  const deleteCard = useCallback(
    async (id: number) => {
      await api.deleteCard(id);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // session cookie is gone either way
    }
    onSignedOut();
  }, [onSignedOut]);

  return (
    <BoardContext.Provider
      value={{
        user,
        columns,
        setColumns,
        metrics,
        activity,
        presence,
        loadError,
        refreshTick,
        refresh,
        saveCard,
        deleteCard,
        toast,
        showToast,
        logout,
      }}
    >
      {children}
    </BoardContext.Provider>
  );
}
