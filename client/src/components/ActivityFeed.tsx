import type { ActivityEvent } from "../types";
import { formatRelativeTime } from "../types";

interface Props {
  events: ActivityEvent[];
  onClose: () => void;
}

function describe(e: ActivityEvent): string {
  const card = e.cardTitle ? `“${e.cardTitle}”` : "a card";
  switch (e.type) {
    case "create":
      return `added ${card}${e.toColumn ? ` to ${e.toColumn}` : ""}`;
    case "move":
      return `moved ${card}${e.fromColumn ? ` from ${e.fromColumn}` : ""}${
        e.toColumn ? ` to ${e.toColumn}` : ""
      }`;
    case "update":
      return `updated ${card}`;
    case "delete":
      return `deleted ${card}`;
    default:
      return `changed ${card}`;
  }
}

export default function ActivityFeed({ events, onClose }: Props) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-900 uppercase">
          Activity
        </h2>
        <button
          onClick={onClose}
          aria-label="Close activity feed"
          className="rounded-md px-2 py-0.5 text-sm text-primary-600 hover:bg-primary-100 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        >
          Close
        </button>
      </div>
      <ol className="flex-1 overflow-y-auto px-4 py-3">
        {events.length === 0 && (
          <li className="text-sm text-neutral-500">
            Nothing here yet. Changes your team makes will show up here.
          </li>
        )}
        {events.map((e) => (
          <li key={e.id} className="border-b border-neutral-100 py-2.5 last:border-b-0">
            <p className="text-sm text-neutral-800">
              <span className="font-medium text-neutral-900">
                {e.actor?.displayName ?? "Someone"}
              </span>{" "}
              {describe(e)}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {formatRelativeTime(e.createdAt)}
            </p>
          </li>
        ))}
      </ol>
    </aside>
  );
}
