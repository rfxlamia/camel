import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { ApiError, api } from "./api";
import type {
  ActivityEvent,
  Card,
  Column,
  FlowMetrics,
  PresenceUser,
  User,
} from "./types";
import ActivityFeed from "./components/ActivityFeed";
import AuthPage from "./components/AuthPage";
import CardModal from "./components/CardModal";
import { CardBody } from "./components/CardView";
import ColumnView from "./components/ColumnView";
import MetricsBar from "./components/MetricsBar";
import PresenceBar from "./components/PresenceBar";
import Toast from "./components/Toast";

const HEARTBEAT_INTERVAL_MS = 25_000;
const PRESENCE_REFRESH_MS = 30_000;

function cardIdFrom(dndId: string | number): number | null {
  const s = String(dndId);
  return s.startsWith("card-") ? Number(s.slice(5)) : null;
}

function columnIdFrom(dndId: string | number): number | null {
  const s = String(dndId);
  return s.startsWith("col-") ? Number(s.slice(4)) : null;
}

function findColumnOfCard(columns: Column[], cardId: number): Column | undefined {
  return columns.find((col) => col.cards.some((c) => c.id === cardId));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [columns, setColumns] = useState<Column[] | null>(null);
  const [metrics, setMetrics] = useState<FlowMetrics | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [feedOpen, setFeedOpen] = useState(true);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [openCard, setOpenCard] = useState<Card | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const snapshotRef = useRef<Column[] | null>(null);
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
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        return;
      }
      setLoadError(true);
    }
  }, []);

  // Session check on first load.
  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  // Board + collaboration wiring, active only while signed in.
  useEffect(() => {
    if (!user) return;
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
  }, [user, refresh]);

  const onLogout = async () => {
    try {
      await api.logout();
    } catch {
      // session cookie is gone either way
    }
    setUser(null);
    setColumns(null);
    setPresence([]);
    setActivity([]);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const onDragStart = (event: DragStartEvent) => {
    if (!columns) return;
    snapshotRef.current = structuredClone(columns);
    const cardId = cardIdFrom(event.active.id);
    if (cardId === null) return;
    const col = findColumnOfCard(columns, cardId);
    setActiveCard(col?.cards.find((c) => c.id === cardId) ?? null);
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !columns) return;
    const cardId = cardIdFrom(active.id);
    if (cardId === null) return;

    const sourceCol = findColumnOfCard(columns, cardId);
    const targetColId =
      columnIdFrom(over.id) ??
      findColumnOfCard(columns, cardIdFrom(over.id) ?? -1)?.id;
    if (!sourceCol || targetColId === undefined || sourceCol.id === targetColId)
      return;

    // Move the card across columns in local state so the preview follows.
    setColumns((cols) => {
      if (!cols) return cols;
      const card = sourceCol.cards.find((c) => c.id === cardId);
      if (!card) return cols;
      const overCardId = cardIdFrom(over.id);
      return cols.map((col) => {
        if (col.id === sourceCol.id) {
          return { ...col, cards: col.cards.filter((c) => c.id !== cardId) };
        }
        if (col.id === targetColId) {
          const cards = col.cards.filter((c) => c.id !== cardId);
          const overIndex =
            overCardId === null
              ? cards.length
              : cards.findIndex((c) => c.id === overCardId);
          const insertAt = overIndex === -1 ? cards.length : overIndex;
          const moved = { ...card, columnId: col.id };
          return {
            ...col,
            cards: [...cards.slice(0, insertAt), moved, ...cards.slice(insertAt)],
          };
        }
        return col;
      });
    });
  };

  const revert = useCallback(() => {
    if (snapshotRef.current) setColumns(snapshotRef.current);
    snapshotRef.current = null;
  }, []);

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = event;
    if (!columns) return;
    const cardId = cardIdFrom(active.id);
    if (cardId === null || !over) {
      revert();
      return;
    }

    const col = findColumnOfCard(columns, cardId);
    if (!col) {
      revert();
      return;
    }

    // Same-column reorder: compute the final index from the over target.
    let finalColumns = columns;
    let index = col.cards.findIndex((c) => c.id === cardId);
    const overCardId = cardIdFrom(over.id);
    if (overCardId !== null && overCardId !== cardId) {
      const overCol = findColumnOfCard(columns, overCardId);
      if (overCol && overCol.id === col.id) {
        const from = index;
        const to = overCol.cards.findIndex((c) => c.id === overCardId);
        if (from !== to) {
          finalColumns = columns.map((c) =>
            c.id === col.id ? { ...c, cards: arrayMove(c.cards, from, to) } : c,
          );
          index = to;
          setColumns(finalColumns);
        }
      }
    }

    const before = snapshotRef.current;
    const movedAcross =
      before && findColumnOfCard(before, cardId)?.id !== col.id;
    const reordered = index !== before?.find((c) => c.id === col.id)?.cards
      .findIndex((c) => c.id === cardId);

    if (!movedAcross && !reordered) {
      snapshotRef.current = null;
      return;
    }

    // Version from the pre-drag snapshot: detects a concurrent move by a teammate.
    const version = before
      ? findColumnOfCard(before, cardId)?.cards.find((c) => c.id === cardId)?.version
      : undefined;

    try {
      await api.moveCard(cardId, col.id, index, version);
      snapshotRef.current = null;
      await refresh();
    } catch (err) {
      revert();
      if (err instanceof ApiError && err.code === "version_conflict") {
        showToast("Someone else moved this card first — board refreshed.");
        await refresh();
      } else if (err instanceof ApiError && err.status === 409) {
        showToast("WIP limit reached — finish something first.");
      } else {
        showToast("Couldn't move the card. Check your connection and try again.");
      }
    }
  };

  const onAddCard = async (columnId: number, title: string) => {
    try {
      await api.createCard(columnId, title);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showToast("WIP limit reached — finish something first.");
      } else {
        showToast("Couldn't add the card. Check your connection and try again.");
      }
    }
  };

  const onSaveCard = async (
    id: number,
    patch: { title?: string; description?: string },
  ) => {
    const current = columns
      ? findColumnOfCard(columns, id)?.cards.find((c) => c.id === id)
      : undefined;
    try {
      await api.updateCard(id, { ...patch, version: current?.version });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "version_conflict") {
        showToast("Someone else updated this card first — board refreshed.");
        await refresh();
      } else {
        showToast("Couldn't save the card. Check your connection and try again.");
      }
    }
  };

  const onDeleteCard = async (id: number) => {
    await api.deleteCard(id);
    await refresh();
  };

  const onUpdateColumn = async (
    id: number,
    patch: { title?: string; wipLimit?: number | null; policy?: string },
  ) => {
    try {
      await api.updateColumn(id, patch);
      await refresh();
    } catch {
      showToast("Couldn't update the column. Try again.");
    }
  };

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-neutral-500">Loading...</p>
      </div>
    );
  }
  if (!user) {
    return <AuthPage onAuth={setUser} />;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-md font-semibold text-primary-900">
            <img src="/logo.png" alt="Camel" className="mr-2 inline-block h-6 w-6" />
            Camel
          </h1>
          <p className="text-xs text-neutral-500">Kanban for dev teams</p>
        </div>
        <MetricsBar metrics={metrics} />
        <div className="flex items-center gap-3">
          <PresenceBar users={presence} self={user} />
          <button
            onClick={() => setFeedOpen((open) => !open)}
            className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            {feedOpen ? "Hide activity" : "Activity"}
          </button>
          <span className="text-sm text-neutral-700" title={`@${user.username}`}>
            {user.displayName}
          </span>
          <button
            onClick={() => void onLogout()}
            className="rounded-md px-2 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
      <main className="flex-1 overflow-x-auto p-6">
        {loadError && (
          <div className="mx-auto max-w-md rounded-md border border-error-500 bg-error-100 px-4 py-3 text-sm text-error-900">
            Couldn't load the board. Check that the server is running, then
            refresh.
          </div>
        )}
        {!loadError && columns === null && (
          <p className="text-sm text-neutral-500">Loading board...</p>
        )}
        {columns && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setActiveCard(null);
              revert();
            }}
          >
            <div className="flex h-full items-start gap-4">
              {columns.map((column) => (
                <ColumnView
                  key={column.id}
                  column={column}
                  onOpenCard={setOpenCard}
                  onAddCard={onAddCard}
                  onUpdateColumn={onUpdateColumn}
                />
              ))}
            </div>
            <DragOverlay>
              {activeCard && (
                <div className="rounded-md border border-primary-300 bg-white px-3 py-2.5 shadow-md">
                  <CardBody card={activeCard} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </main>
      {feedOpen && (
        <ActivityFeed events={activity} onClose={() => setFeedOpen(false)} />
      )}
      </div>

      {openCard && (
        <CardModal
          card={openCard}
          onSave={onSaveCard}
          onDelete={onDeleteCard}
          onClose={() => setOpenCard(null)}
        />
      )}
      {toast && <Toast message={toast} />}
    </div>
  );
}
