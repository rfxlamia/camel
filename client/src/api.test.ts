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
