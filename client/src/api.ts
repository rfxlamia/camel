import type {
  ActivityEvent,
  Board,
  Card,
  Column,
  FlowMetrics,
  PresenceUser,
  User,
} from "./types";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getBoard: () => request<Board>("/board"),
  getMetrics: () => request<FlowMetrics>("/metrics"),
  createCard: (columnId: number, title: string, description = "") =>
    request<Card>("/cards", {
      method: "POST",
      body: JSON.stringify({ columnId, title, description }),
    }),
  updateCard: (
    id: number,
    patch: { title?: string; description?: string; version?: number },
  ) =>
    request<Card>(`/cards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCard: (id: number) =>
    request<void>(`/cards/${id}`, { method: "DELETE" }),
  moveCard: (id: number, toColumnId: number, index: number, version?: number) =>
    request<Card>(`/cards/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ toColumnId, index, version }),
    }),
  updateColumn: (
    id: number,
    patch: { title?: string; wipLimit?: number | null; policy?: string },
  ) =>
    request<Column>(`/columns/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // ---- Auth ----
  register: (username: string, password: string, displayName: string) =>
    request<{ user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, displayName }),
    }),
  login: (username: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/auth/me"),

  // ---- Collaboration ----
  getActivity: (limit = 50) =>
    request<{ events: ActivityEvent[] }>(`/activity?limit=${limit}`),
  getPresence: () => request<{ users: PresenceUser[] }>("/presence"),
  heartbeat: () =>
    request<{ ok: boolean }>("/presence/heartbeat", { method: "POST" }),
};

export { ApiError };
