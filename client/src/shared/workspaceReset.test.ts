import { describe, expect, it } from "vitest";
import { shouldClearOnWorkspaceChange } from "./workspaceReset";

describe("shouldClearOnWorkspaceChange", () => {
	it("returns true when the workspace id changed", () => {
		expect(shouldClearOnWorkspaceChange(1, 2)).toBe(true);
	});

	it("returns false when the workspace id is unchanged", () => {
		expect(shouldClearOnWorkspaceChange(2, 2)).toBe(false);
	});

	it("returns false on the initial set (no previous id)", () => {
		expect(shouldClearOnWorkspaceChange(null, 1)).toBe(false);
	});

	it("returns false when the next workspace is cleared", () => {
		expect(shouldClearOnWorkspaceChange(1, null)).toBe(false);
	});
});
