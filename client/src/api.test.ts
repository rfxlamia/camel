import { describe, expect, it, vi } from "vitest";

// Mock fetch globally for API tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Settings API methods", () => {
  it("getSettings returns SettingsMap", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ boardName: "Dev Team", logoPath: "/uploads/logo.png", version: 1 }),
    });

    const { api } = await import("./api");
    const result = await api.getSettings();
    expect(result).toEqual({ boardName: "Dev Team", logoPath: "/uploads/logo.png", version: 1 });
  });

  it("updateSettings sends PATCH with body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ boardName: "New Name", logoPath: "/logo.png", version: 2 }),
    });

    const { api } = await import("./api");
    await api.updateSettings([{ key: "board_name", textValue: "New Name", version: 1 }]);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("resetSettings sends DELETE", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve(undefined),
    });

    const { api } = await import("./api");
    await api.resetSettings();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("resetApp sends POST", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve(undefined),
    });

    const { api } = await import("./api");
    await api.resetApp();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings/reset-app",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uploadLogo sends FormData via POST", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ boardName: "Camel", logoPath: "/uploads/new.png", version: 2 }),
    });

    const { api } = await import("./api");
    const file = new File(["test"], "logo.png", { type: "image/png" });
    const result = await api.uploadLogo(file);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings/logo",
      expect.objectContaining({ method: "POST" })
    );
    expect(result.logoPath).toBe("/uploads/new.png");
  });
});

describe("scoped board API paths", () => {
  it("prefixes board, metrics, activity, presence, and card methods with workspace id", async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
    const { api } = await import("./api");

    await api.getBoard(7);
    await api.getMetrics(7);
    await api.getMetricsHistory(7);
    await api.getActivity(7);
    await api.getPresence(7);
    await api.getCard(7, 42);
    await api.createCard(7, { columnId: 1, title: "New" });
    await api.moveCard(7, 42, { toColumnId: 2, index: 3, version: 3 });

    const paths = mockFetch.mock.calls.map(([path]) => path);
    expect(paths).toEqual([
      "/api/workspaces/7/board",
      "/api/workspaces/7/metrics",
      "/api/workspaces/7/metrics/history",
      "/api/workspaces/7/activity",
      "/api/workspaces/7/presence",
      "/api/workspaces/7/cards/42",
      "/api/workspaces/7/cards",
      "/api/workspaces/7/cards/42/move",
    ]);

    const moveCall = mockFetch.mock.calls.find(
      ([path]) => path === "/api/workspaces/7/cards/42/move",
    );
    expect(moveCall).toBeDefined();
    const moveBody = JSON.parse((moveCall![1] as RequestInit).body as string);
    expect(moveBody).toEqual({ toColumnId: 2, index: 3, version: 3 });
    expect(moveBody).not.toHaveProperty("position");
  });
});

describe("workspace API methods", () => {
  it("calls documented workspace and membership endpoints", async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });
    const { api } = await import("./api");

    await api.getWorkspaces();
    await api.createWorkspace({ name: "Launch" });
    await api.getWorkspaceMembers(7);
    await api.addWorkspaceMember(7, { username: "iris" });
    await api.acceptInvite(7, 12);
    await api.declineInvite(7, 12);
    await api.transferWorkspaceOwnership(7, { newOwnerId: 2, previousOwnerRole: "admin" });
    await api.deleteWorkspace(7);

    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces", expect.any(Object));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces", expect.objectContaining({ method: "POST" }));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/7/members", expect.any(Object));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/7/members", expect.objectContaining({ method: "POST" }));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/7/invites/12/accept", expect.objectContaining({ method: "POST" }));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/7/invites/12", expect.objectContaining({ method: "DELETE" }));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/7/transfer-ownership", expect.objectContaining({ method: "POST" }));
    expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/7", expect.objectContaining({ method: "DELETE" }));
  });
});
