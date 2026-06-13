import type {
  ActivityEvent,
  Board,
  Card,
  Column,
  FlowMetrics,
  MetricsHistoryBucket,
  PresenceUser,
  SettingsMap,
  User,
  Workspace,
  WorkspaceListResponse,
  WorkspaceMember,
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
  getMetricsHistory: (weeks = 8) =>
    request<{ weeks: MetricsHistoryBucket[] }>(`/metrics/history?weeks=${weeks}`),
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
  getCardActivity: (id: number) =>
    request<{ events: ActivityEvent[] }>(`/cards/${id}/activity`),
  moveCard: (id: number, toColumnId: number, index: number, version?: number) =>
    request<Card>(`/cards/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ toColumnId, index, version }),
    }),
  createColumn: (title: string) =>
    request<Column>("/columns", {
      method: "POST",
      body: JSON.stringify({ title }),
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

  // Settings
  getSettings: () => request<SettingsMap>("/settings"),
  updateSettings: (settings: Array<{ key: string; textValue?: string; boolValue?: boolean; version: number }>) =>
    request<SettingsMap>("/settings", { method: "PATCH", body: JSON.stringify(settings) }),
  resetSettings: () => request<void>("/settings", { method: "DELETE" }),
  resetApp: () => request<void>("/settings/reset-app", { method: "POST" }),
  uploadLogo: async (file: File): Promise<SettingsMap> => {
    const formData = new FormData();
    formData.append("logo", file);
    const res = await fetch("/api/settings/logo", { method: "POST", body: formData });
    if (!res.ok) {
      let message = `Upload failed (${res.status})`;
      try {
        const body = await res.json();
        if (body.error) message = body.error;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(message, res.status);
    }
    return res.json();
  },

  // ---- Workspaces ----
  getWorkspaces: () => request<WorkspaceListResponse>("/workspaces"),
  createWorkspace: (body: { name: string }) =>
    request<Workspace>("/workspaces", { method: "POST", body: JSON.stringify(body) }),
  getWorkspaceMembers: (workspaceId: number) =>
    request<{ members: WorkspaceMember[] }>(`/workspaces/${workspaceId}/members`),
  addWorkspaceMember: (workspaceId: number, body: { username: string; role?: WorkspaceMember["role"] }) =>
    request<WorkspaceMember | { id: number; workspaceId: number; username: string; role: string; pending: true }>(
      `/workspaces/${workspaceId}/members`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  acceptInvite: (workspaceId: number, inviteId: number) =>
    request<Workspace>(`/workspaces/${workspaceId}/invites/${inviteId}/accept`, { method: "POST" }),
  declineInvite: (workspaceId: number, inviteId: number) =>
    request<void>(`/workspaces/${workspaceId}/invites/${inviteId}`, { method: "DELETE" }),
  transferWorkspaceOwnership: (
    workspaceId: number,
    body: { newOwnerId: number; previousOwnerRole: WorkspaceMember["role"] },
  ) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}/transfer-ownership`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteWorkspace: (workspaceId: number) =>
    request<void>(`/workspaces/${workspaceId}`, { method: "DELETE" }),
};

export { ApiError };
