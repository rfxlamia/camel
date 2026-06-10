import type { Board, Card, Column, FlowMetrics } from "./types";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
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
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, res.status);
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
  updateCard: (id: number, patch: { title?: string; description?: string }) =>
    request<Card>(`/cards/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCard: (id: number) =>
    request<void>(`/cards/${id}`, { method: "DELETE" }),
  moveCard: (id: number, toColumnId: number, index: number) =>
    request<Card>(`/cards/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ toColumnId, index }),
    }),
  updateColumn: (
    id: number,
    patch: { title?: string; wipLimit?: number | null; policy?: string },
  ) =>
    request<Column>(`/columns/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

export { ApiError };
