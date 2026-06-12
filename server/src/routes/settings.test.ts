import { describe, expect, it } from "vitest";
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
