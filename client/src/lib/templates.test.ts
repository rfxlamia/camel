import { describe, expect, it } from "vitest";
import { WORKSPACE_TEMPLATES } from "./templates";

const PALETTE = [
	"powder-blue",
	"pale-sky",
	"light-cyan",
	"frozen-water",
	"turquoise",
];

describe("WORKSPACE_TEMPLATES", () => {
	it("has exactly 5 templates with unique ids and names", () => {
		expect(WORKSPACE_TEMPLATES).toHaveLength(5);
		expect(new Set(WORKSPACE_TEMPLATES.map((t) => t.id)).size).toBe(5);
		expect(new Set(WORKSPACE_TEMPLATES.map((t) => t.name)).size).toBe(5);
	});

	it("uses only the 5 palette colors", () => {
		for (const t of WORKSPACE_TEMPLATES) {
			for (const c of t.columns) {
				expect(PALETTE).toContain(c.color);
			}
		}
	});

	it("has exactly one done-column per template", () => {
		for (const t of WORKSPACE_TEMPLATES) {
			expect(t.columns.filter((c) => c.isDone)).toHaveLength(1);
		}
	});

	it("gives every column a non-empty title and a policy string", () => {
		for (const t of WORKSPACE_TEMPLATES) {
			for (const c of t.columns) {
				expect(c.title.trim().length).toBeGreaterThan(0);
				expect(typeof c.policy).toBe("string");
				expect(c.policy.length).toBeGreaterThan(0);
			}
		}
	});
});
