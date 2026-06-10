export interface Card {
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  createdAt: string;
  startedAt: string | null;
  doneAt: string | null;
}

export interface Column {
  id: number;
  title: string;
  position: number;
  wipLimit: number | null;
  policy: string;
  isDone: boolean;
  cards: Card[];
}

export interface Board {
  columns: Column[];
}

export interface FlowMetrics {
  throughput: number;
  avgLeadTimeMs: number | null;
  avgCycleTimeMs: number | null;
  wipCount: number;
}

export type WipStatus = "unlimited" | "under" | "at" | "over";

export function wipStatus(count: number, wipLimit: number | null): WipStatus {
  if (wipLimit === null) return "unlimited";
  if (count < wipLimit) return "under";
  if (count === wipLimit) return "at";
  return "over";
}

export function formatDuration(ms: number): string {
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  if (ms < hour) return `${Math.max(1, Math.round(ms / (60 * 1000)))}m`;
  if (ms < day) return `${(ms / hour).toFixed(1).replace(/\.0$/, "")}h`;
  return `${(ms / day).toFixed(1).replace(/\.0$/, "")}d`;
}
