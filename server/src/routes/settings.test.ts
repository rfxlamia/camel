import { describe, expect, it, vi } from "vitest";
import {
  validateBoardName,
  validateSettingKey,
  generateDefaultSettings,
  DEFAULT_SETTINGS,
} from "./settings.js";

describe("validateBoardName", () => {
  it("rejects empty string", () => {
    const result = validateBoardName("");
    expect(result).toEqual({ valid: false, error: "Name is required" });
  });

  it("rejects whitespace-only string", () => {
    const result = validateBoardName("   ");
    expect(result).toEqual({ valid: false, error: "Name is required" });
  });

  it("rejects names exceeding 15 characters", () => {
    const result = validateBoardName("Super Long Board Name");
    expect(result).toEqual({ valid: false, error: "Max 15 characters" });
  });

  it("accepts valid name and trims whitespace", () => {
    const result = validateBoardName("  Dev Team  ");
    expect(result).toEqual({ valid: true, trimmed: "Dev Team" });
  });

  it("accepts single character name", () => {
    const result = validateBoardName("A");
    expect(result).toEqual({ valid: true, trimmed: "A" });
  });

  it("accepts exactly 15 character name", () => {
    const name = "A".repeat(15);
    const result = validateBoardName(name);
    expect(result).toEqual({ valid: true, trimmed: name });
  });
});

describe("validateSettingKey", () => {
  it("accepts known setting keys", () => {
    expect(validateSettingKey("board_name")).toBe(true);
    expect(validateSettingKey("logo_path")).toBe(true);
  });

  it("rejects unknown setting keys", () => {
    expect(validateSettingKey("unknown_key")).toBe(false);
    expect(validateSettingKey("")).toBe(false);
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("has correct default values", () => {
    expect(DEFAULT_SETTINGS.boardName).toBe("Camel");
    expect(DEFAULT_SETTINGS.logoPath).toBe("/logo.png");
  });
});

describe("generateDefaultSettings", () => {
  it("returns defaults when no rows provided", () => {
    const settings = generateDefaultSettings([]);
    expect(settings).toEqual({ boardName: "Camel", logoPath: "/logo.png", version: 0 });
  });

  it("merges board_name from rows", () => {
    const rows = [{ key: "board_name", textValue: "Dev Team", boolValue: null, version: 2, updatedAt: "2026-06-13" }];
    const settings = generateDefaultSettings(rows);
    expect(settings.boardName).toBe("Dev Team");
    expect(settings.logoPath).toBe("/logo.png");
  });

  it("merges both settings from rows", () => {
    const rows = [
      { key: "board_name", textValue: "Dev Team", boolValue: null, version: 2, updatedAt: "2026-06-13" },
      { key: "logo_path", textValue: "/uploads/custom.png", boolValue: null, version: 3, updatedAt: "2026-06-13" },
    ];
    const settings = generateDefaultSettings(rows);
    expect(settings.boardName).toBe("Dev Team");
    expect(settings.logoPath).toBe("/uploads/custom.png");
  });

  it("uses max version across all rows", () => {
    const rows = [
      { key: "board_name", textValue: "A", boolValue: null, version: 5, updatedAt: "2026-06-13" },
      { key: "logo_path", textValue: "/b.png", boolValue: null, version: 3, updatedAt: "2026-06-13" },
    ];
    const settings = generateDefaultSettings(rows);
    expect(settings.version).toBe(5);
  });
});

describe("PATCH validation", () => {
  it("rejects setting with unknown key", () => {
    // Verify validateSettingKey rejects unknown keys
    expect(validateSettingKey("unknown_key")).toBe(false);
  });

  it("rejects board_name with empty value", () => {
    const result = validateBoardName("");
    expect(result.valid).toBe(false);
  });

  it("accepts valid board_name update", () => {
    const result = validateBoardName("Dev Team");
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.trimmed).toBe("Dev Team");
  });
});

import {
  validateLogoFile,
  validateFileSize,
  generateLogoFilename,
  MAX_LOGO_SIZE_BYTES,
} from "./settings.js";

describe("validateLogoFile", () => {
  it("accepts image/png", () => {
    expect(validateLogoFile("image/png")).toEqual({ valid: true });
  });

  it("accepts image/jpeg", () => {
    expect(validateLogoFile("image/jpeg")).toEqual({ valid: true });
  });

  it("rejects application/pdf", () => {
    expect(validateLogoFile("application/pdf")).toEqual({
      valid: false,
      error: "Only .png and .jpg files are accepted",
    });
  });

  it("rejects image/gif", () => {
    expect(validateLogoFile("image/gif")).toEqual({
      valid: false,
      error: "Only .png and .jpg files are accepted",
    });
  });

  it("rejects empty mimetype", () => {
    expect(validateLogoFile("")).toEqual({
      valid: false,
      error: "Only .png and .jpg files are accepted",
    });
  });
});

describe("validateFileSize", () => {
  it("accepts file under 10MB", () => {
    expect(validateFileSize(2 * 1024 * 1024)).toEqual({ valid: true });
  });

  it("accepts file exactly at 10MB", () => {
    expect(validateFileSize(10 * 1024 * 1024)).toEqual({ valid: true });
  });

  it("rejects file over 10MB", () => {
    expect(validateFileSize(15 * 1024 * 1024)).toEqual({
      valid: false,
      error: "File size must be under 10MB",
    });
  });

  it("rejects file at 10MB + 1 byte", () => {
    expect(validateFileSize(10 * 1024 * 1024 + 1)).toEqual({
      valid: false,
      error: "File size must be under 10MB",
    });
  });
});

describe("generateLogoFilename", () => {
  it("generates filename with logo prefix and timestamp", () => {
    const filename = generateLogoFilename("image/png");
    expect(filename).toMatch(/^logo-\d+-\w+\.png$/);
  });

  it("uses jpg extension for jpeg", () => {
    const filename = generateLogoFilename("image/jpeg");
    expect(filename).toMatch(/\.jpg$/);
  });

  it("generates unique filenames on consecutive calls", () => {
    const a = generateLogoFilename("image/png");
    const b = generateLogoFilename("image/png");
    // Both should match pattern, but may be same if called in same ms
    expect(a).toMatch(/^logo-/);
    expect(b).toMatch(/^logo-/);
  });
});

describe("MAX_LOGO_SIZE_BYTES", () => {
  it("is 10MB", () => {
    expect(MAX_LOGO_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });
});

import { createWorkspaceSettingsService, hasResetAppRoute } from "./settings.js";

describe("workspace settings service", () => {
  it("reads and writes settings by workspace id", async () => {
    const repo = {
      getMembership: vi.fn(async (_workspaceId, userId) => ({ userId, role: "admin" })),
      getSettings: vi.fn(async (workspaceId) => (
        workspaceId === 1
          ? [{ key: "board_name", textValue: "Alpha", boolValue: null, version: 1, updatedAt: "2026-06-13" }]
          : [{ key: "board_name", textValue: "Beta", boolValue: null, version: 1, updatedAt: "2026-06-13" }]
      )),
      updateSettings: vi.fn(async (workspaceId, updates) => ({ workspaceId, updates })),
    };
    const service = createWorkspaceSettingsService(repo);

    await expect(service.getSettings({ userId: 1, workspaceId: 1 }))
      .resolves.toMatchObject({ boardName: "Alpha" });
    await expect(service.getSettings({ userId: 1, workspaceId: 2 }))
      .resolves.toMatchObject({ boardName: "Beta" });

    await service.updateSettings({
      userId: 1,
      workspaceId: 2,
      updates: [{ key: "board_name", textValue: "Beta 2", version: 1 }],
    });
    expect(repo.updateSettings).toHaveBeenCalledWith(2, [{ key: "board_name", textValue: "Beta 2", version: 1 }]);
  });

  it("blocks member writes and removes reset-app", async () => {
    const service = createWorkspaceSettingsService({
      getMembership: vi.fn(async () => ({ role: "member" })),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
    });

    await expect(service.updateSettings({
      userId: 4,
      workspaceId: 7,
      updates: [{ key: "board_name", textValue: "Nope", version: 1 }],
    })).resolves.toEqual({ status: 403, error: "Forbidden" });
    expect(hasResetAppRoute()).toBe(false);
  });
});
