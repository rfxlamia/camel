import { useDroppable } from "@dnd-kit/core";
import { Trash2 } from "lucide-react";

/**
 * Drag-to-delete target. A small circle pinned to the bottom-center of the
 * board; it stays mounted (so the droppable is always registered) and only
 * becomes visible while a card is being dragged. Dropping a card here soft
 * deletes it — the drop is handled in BoardPage's onDragEnd via over.id.
 */
export default function TrashZone({ visible }: { visible: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "trash" });

  return (
    <div
      ref={setNodeRef}
      aria-hidden={!visible}
      className={`fixed bottom-8 left-1/2 z-50 -translate-x-1/2 transition-opacity duration-150 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-full border shadow-md transition-transform duration-150 ${
          isOver
            ? "scale-110 border-error-500 bg-error-100 text-error-900"
            : "border-neutral-300 bg-white text-neutral-500"
        }`}
      >
        <Trash2 size={24} aria-hidden />
      </div>
    </div>
  );
}
