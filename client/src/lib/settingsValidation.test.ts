import { describe, expect, it } from "vitest";
import {
  validateBoardName,
  validateResetAppConfirmation,
  validateUnsavedChanges,
} from "./settingsValidation";

describe("validateBoardName (client)", () => {
  it("rejects empty string", () => {
    expect(validateBoardName("")).toEqual({ valid: false, error: "Name is required" });
  });

  it("rejects whitespace-only string", () => {
    expect(validateBoardName("   ")).toEqual({ valid: false, error: "Name is required" });
  });

  it("rejects name over 15 characters", () => {
    expect(validateBoardName("Super Long Board Name")).toEqual({
      valid: false,
      error: "Max 15 characters",
    });
  });

  it("accepts valid name and trims whitespace", () => {
    expect(validateBoardName("  Dev Team  ")).toEqual({ valid: true, trimmed: "Dev Team" });
  });

  it("accepts single character", () => {
    expect(validateBoardName("A")).toEqual({ valid: true, trimmed: "A" });
  });

  it("accepts exactly 15 characters", () => {
    const name = "A".repeat(15);
    expect(validateBoardName(name)).toEqual({ valid: true, trimmed: name });
  });

  it("rejects 16 characters", () => {
    const name = "A".repeat(16);
    expect(validateBoardName(name)).toEqual({ valid: false, error: "Max 15 characters" });
  });
});

describe("validateResetAppConfirmation", () => {
  it("enables when DELETE typed and checkbox checked", () => {
    expect(validateResetAppConfirmation("DELETE", true)).toEqual({ enabled: true });
  });

  it("enables for lowercase delete", () => {
    expect(validateResetAppConfirmation("delete", true)).toEqual({ enabled: true });
  });

  it("enables for mixed case with spaces", () => {
    expect(validateResetAppConfirmation("  Delete  ", true)).toEqual({ enabled: true });
  });

  it("disables when DELETE typed but checkbox unchecked", () => {
    expect(validateResetAppConfirmation("DELETE", false)).toEqual({ enabled: false });
  });

  it("disables when checkbox checked but wrong text", () => {
    expect(validateResetAppConfirmation("WRONG", true)).toEqual({ enabled: false });
  });

  it("disables when both wrong", () => {
    expect(validateResetAppConfirmation("", false)).toEqual({ enabled: false });
  });
});

describe("validateUnsavedChanges", () => {
  it("detects changes", () => {
    expect(validateUnsavedChanges("Camel", "Dev Team")).toBe(true);
  });

  it("ignores whitespace-only changes", () => {
    expect(validateUnsavedChanges("Camel", "  Camel  ")).toBe(false);
  });

  it("detects actual content change", () => {
    expect(validateUnsavedChanges("Camel", "New Name")).toBe(true);
  });

  it("no change returns false", () => {
    expect(validateUnsavedChanges("Camel", "Camel")).toBe(false);
  });
});
