import type { ActivityEvent } from "../types";
import { formatRelativeTime } from "../types";
import { useBoard } from "../context/BoardContext";

export function describeEvent(e: ActivityEvent): string {
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

const TYPE_BADGE: Record<ActivityEvent["type"], { label: string; className: string }> = {
  create: { label: "Added", className: "bg-success-100 text-success-900" },
  move: { label: "Moved", className: "bg-info-100 text-info-900" },
  update: { label: "Updated", className: "bg-primary-100 text-primary-800" },
  delete: { label: "Deleted", className: "bg-error-100 text-error-900" },
};

export default function ActivityPage() {
  const { activity } = useBoard();

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="text-lg font-semibold text-neutral-900">Activity</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Everything your team changed on the board, newest first.
      </p>

      <ol className="mt-6 rounded-md border border-neutral-200 bg-white">
        {activity.length === 0 && (
          <li className="px-4 py-6 text-sm text-neutral-500">
            Nothing here yet. Changes your team makes will show up here.
          </li>
        )}
        {activity.map((e) => {
          const badge = TYPE_BADGE[e.type] ?? TYPE_BADGE.update;
          return (
            <li
              key={e.id}
              className="flex items-start gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0"
            >
              <span
                className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${badge.className}`}
              >
                {badge.label}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-neutral-800">
                  <span className="font-medium text-neutral-900">
                    {e.actor?.displayName ?? "Someone"}
                  </span>{" "}
                  {describeEvent(e)}
                </p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {formatRelativeTime(e.createdAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
