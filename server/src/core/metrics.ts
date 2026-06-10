/**
 * Flow metrics — the measurable outcomes kanban is meant to improve:
 * lead time, cycle time, and throughput.
 */

export interface CardTimestamps {
  createdAt: Date;
  /** First time the card left the backlog (work started). */
  startedAt: Date | null;
  /** Time the card entered a done column. */
  doneAt: Date | null;
}

export interface FlowMetrics {
  /** Cards completed within the window. */
  throughput: number;
  /** Average ms from creation to done; null when no cards are done. */
  avgLeadTimeMs: number | null;
  /** Average ms from work started to done; null when not measurable. */
  avgCycleTimeMs: number | null;
  /** Cards currently in progress (started but not done). */
  wipCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeFlowMetrics(
  cards: CardTimestamps[],
  options: { windowDays?: number; now?: Date } = {},
): FlowMetrics {
  const now = options.now ?? new Date();
  const windowStart =
    options.windowDays !== undefined
      ? new Date(now.getTime() - options.windowDays * DAY_MS)
      : null;

  // No upper bound on doneAt: DB and app clocks may differ by a few ms,
  // and a card with done_at set is done regardless.
  const doneInWindow = cards.filter(
    (c) =>
      c.doneAt !== null && (windowStart === null || c.doneAt >= windowStart),
  );

  const leadTimes = doneInWindow.map(
    (c) => (c.doneAt as Date).getTime() - c.createdAt.getTime(),
  );
  const cycleTimes = doneInWindow
    .filter((c) => c.startedAt !== null)
    .map((c) => (c.doneAt as Date).getTime() - (c.startedAt as Date).getTime());

  return {
    throughput: doneInWindow.length,
    avgLeadTimeMs: average(leadTimes),
    avgCycleTimeMs: average(cycleTimes),
    wipCount: cards.filter((c) => c.startedAt !== null && c.doneAt === null)
      .length,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Format a duration in ms as a human-friendly string, e.g. "2.5d" or "3h". */
export function formatDuration(ms: number): string {
  if (ms < 60 * 60 * 1000) {
    return `${Math.max(1, Math.round(ms / (60 * 1000)))}m`;
  }
  if (ms < DAY_MS) {
    return `${(ms / (60 * 60 * 1000)).toFixed(1).replace(/\.0$/, "")}h`;
  }
  return `${(ms / DAY_MS).toFixed(1).replace(/\.0$/, "")}d`;
}
