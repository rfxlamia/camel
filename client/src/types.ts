export interface Card {
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  version: number;
  createdAt: string;
  startedAt: string | null;
  doneAt: string | null;
}

export interface User {
  id: number;
  username: string;
  displayName: string;
}

export interface PresenceUser extends User {
  lastSeen: string;
}

export interface ActivityEvent {
  id: number;
  type: "create" | "update" | "move" | "delete";
  cardId: number | null;
  cardTitle: string | null;
  fromColumn: string | null;
  toColumn: string | null;
  actor: { username: string; displayName: string } | null;
  createdAt: string;
}

export interface BoardEvent {
  type: string;
  actor: User;
  cardId?: number;
  at: string;
}

export function formatRelativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (ms < minute) return "just now";
  if (ms < hour) return `${Math.floor(ms / minute)}m ago`;
  if (ms < day) return `${Math.floor(ms / hour)}h ago`;
  return `${Math.floor(ms / day)}d ago`;
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

export interface MetricsHistoryBucket {
  weekStart: string;
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

export interface Setting {
  key: string;
  textValue: string | null;
  boolValue: boolean | null;
  version: number;
  updatedAt: string;
}

export interface SettingsMap {
  boardName: string;
  logoPath: string;
  version: number;
}
