import { describe, expect, it } from "vitest";
import { resolveEventTitle } from "./event-title.js";

describe("resolveEventTitle", () => {
	it("returns cardTitle when it is a string", () => {
		expect(resolveEventTitle({ cardTitle: "A", title: "B" })).toBe("A");
	});

	it("falls back to title when cardTitle is missing or not a string", () => {
		expect(resolveEventTitle({ title: "B" })).toBe("B");
		expect(resolveEventTitle({ cardTitle: 5, title: "B" })).toBe("B");
	});

	it("returns null for non-string values", () => {
		expect(resolveEventTitle({ cardTitle: 5, title: {} })).toBeNull();
		expect(resolveEventTitle({})).toBeNull();
	});

	it("returns null for null, undefined and primitive payloads", () => {
		expect(resolveEventTitle(null)).toBeNull();
		expect(resolveEventTitle(undefined)).toBeNull();
		expect(resolveEventTitle("x")).toBeNull();
	});
});
