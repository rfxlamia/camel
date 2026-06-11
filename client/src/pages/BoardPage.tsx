import { useCallback, useRef, useState } from "react";
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
import { ApiError, api } from "../api";
import type { Card, Column } from "../types";
import { useBoard } from "../context/BoardContext";
import CardModal from "../components/CardModal";
import { CardBody } from "../components/CardView";
import ColumnView from "../components/ColumnView";

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

export default function BoardPage() {
  const { columns, setColumns, loadError, refresh, showToast } = useBoard();
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [openCard, setOpenCard] = useState<Card | null>(null);
  const snapshotRef = useRef<Column[] | null>(null);

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
  }, [setColumns]);

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

  return (
    <div className="h-full p-6">
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

      {openCard && (
        <CardModal
          card={openCard}
          onSave={onSaveCard}
          onDelete={onDeleteCard}
          onClose={() => setOpenCard(null)}
        />
      )}
    </div>
  );
}
