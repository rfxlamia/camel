import { describe, expect, it } from "vitest";
import {
	canEditWorkspaceSettings,
	getWorkspaceDangerZoneState,
	validateBoardName,
	validateUnsavedChanges,
} from "./settingsValidation";

describe("validateBoardName (client)", () => {
	it("rejects empty string", () => {
		expect(validateBoardName("")).toEqual({
			valid: false,
			error: "Name is required",
		});
	});

	it("rejects whitespace-only string", () => {
		expect(validateBoardName("   ")).toEqual({
			valid: false,
			error: "Name is required",
		});
	});

	it("rejects name over 15 characters", () => {
		expect(validateBoardName("Super Long Board Name")).toEqual({
			valid: false,
			error: "Max 15 characters",
		});
	});

	it("accepts valid name and trims whitespace", () => {
		expect(validateBoardName("  Dev Team  ")).toEqual({
			valid: true,
			trimmed: "Dev Team",
		});
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
		expect(validateBoardName(name)).toEqual({
			valid: false,
			error: "Max 15 characters",
		});
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

describe("workspace settings validation state", () => {
	it("allows owner/admin edits and blocks member edits", () => {
		expect(canEditWorkspaceSettings("owner")).toBe(true);
		expect(canEditWorkspaceSettings("admin")).toBe(true);
		expect(canEditWorkspaceSettings("member")).toBe(false);
	});

	it("uses workspace delete danger state instead of reset app", () => {
		expect(
			getWorkspaceDangerZoneState({
				role: "owner",
				memberCount: 1,
				isPersonal: false,
			}),
		).toEqual({ canDelete: true, reason: null, resetAppVisible: false });
		expect(
			getWorkspaceDangerZoneState({
				role: "owner",
				memberCount: 1,
				isPersonal: true,
			}),
		).toMatchObject({ canDelete: false, resetAppVisible: false });
	});
});
