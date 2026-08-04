import { describe, expect, it } from "vitest";
import { derivePrefix, formatKey, parseKeyFromUrl } from "./tracker-key.js";

describe("tracker-key utilities", () => {
	it("derivePrefix matches workspaceInitials rules (keep in sync with client/src/lib/workspaceSwitcher.ts)", () => {
		expect(derivePrefix("Camel")).toBe("CA");
		expect(derivePrefix("My Workspace")).toBe("MW");
		expect(derivePrefix("Solo")).toBe("SO");
		expect(derivePrefix("")).toBe("?");
		expect(derivePrefix("Default Workspace")).toBe("DW");
	});

	it("formatKey and parseKeyFromUrl are inverse for valid keys", () => {
		expect(formatKey("CA", 42)).toBe("CA-42");
		expect(parseKeyFromUrl("CA-42")).toEqual({ prefix: "CA", keyNumber: 42 });
		expect(parseKeyFromUrl("bad")).toBeNull();
	});
});
