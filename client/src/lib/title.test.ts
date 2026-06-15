import { describe, expect, it } from "vitest";
import { formatTitle, getFaviconLink } from "./title";

describe("formatTitle", () => {
	it("formats title with custom board name", () => {
		expect(formatTitle("Dev Team")).toBe("Dev Team — Kanban");
	});

	it("formats title with default board name", () => {
		expect(formatTitle("Camel")).toBe("Camel — Kanban");
	});

	it("handles empty board name", () => {
		expect(formatTitle("")).toBe(" — Kanban");
	});

	it("handles board name with special characters", () => {
		expect(formatTitle("Team #1")).toBe("Team #1 — Kanban");
	});
});

describe("getFaviconLink", () => {
	it("returns default logo path", () => {
		expect(getFaviconLink("/logo.png")).toBe("/logo.png");
	});

	it("returns custom uploaded logo path", () => {
		expect(getFaviconLink("/uploads/logo-123-abc.png")).toBe(
			"/uploads/logo-123-abc.png",
		);
	});
});
