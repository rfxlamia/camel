import { useState } from "react";
import type { Card } from "../types";

interface Props {
  card: Card;
  onSave: (id: number, patch: { title?: string; description?: string }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onClose: () => void;
}

export default function CardModal({ card, onSave, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);

  const save = async () => {
    if (title.trim() === "") return;
    await onSave(card.id, { title: title.trim(), description });
    onClose();
  };

  const inputClass =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-900/40 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit card"
      >
        <h3 className="text-md font-semibold text-neutral-900">Edit card</h3>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-neutral-700">Title</span>
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Card title"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-neutral-700">
              Description
            </span>
            <textarea
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="Add details..."
            />
          </label>
        </div>
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => void onDelete(card.id).then(onClose)}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-error-500 hover:bg-error-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            Delete card
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
