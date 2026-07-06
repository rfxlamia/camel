import { describe, expect, it } from "vitest";
import { isValidColumnColor, validateColumnBatch } from "./column.js";

function col(overrides: Record<string, unknown> = {}) {
	return {
		title: "Backlog",
		color: "powder-blue",
		wipLimit: null,
		policy: "Ideas not yet scheduled.",
		isDone: false,
		...overrides,
	};
}

const validFive = [
	col({ title: "Backlog", color: "powder-blue" }),
	col({ title: "To Do", color: "pale-sky" }),
	col({ title: "In Progress", color: "light-cyan", wipLimit: 3 }),
	col({ title: "In Review", color: "frozen-water", wipLimit: 2 }),
	col({ title: "Done", color: "turquoise", isDone: true }),
];

describe("isValidColumnColor — dual legacy + OKLCH", () => {
	it("accepts legacy names and null", () => {
		expect(isValidColumnColor(null)).toBe(true);
		expect(isValidColumnColor("powder-blue")).toBe(true);
		expect(isValidColumnColor("turquoise")).toBe(true);
	});

	it("accepts well-formed OKLCH in sanity range", () => {
		expect(isValidColumnColor("oklch(88% 0.09 47.3)")).toBe(true);
	});

	it("rejects values outside sanity range or unknown strings", () => {
		expect(isValidColumnColor("oklch(2 0.5 400)")).toBe(false);
		expect(isValidColumnColor("hot-pink")).toBe(false);
		expect(isValidColumnColor("")).toBe(false);
	});
});

describe("validateColumnBatch — OKLCH mixed with legacy", () => {
	it("accepts batch with one OKLCH color", () => {
		const result = validateColumnBatch([
			{
				title: "A",
				color: "oklch(88% 0.09 47.3)",
				wipLimit: null,
				policy: "",
				isDone: false,
			},
		]);
		expect(result.valid).toBe(true);
	});

	it("normalizes a batch with both legacy names and OKLCH strings", () => {
		const result = validateColumnBatch([
			{
				title: "Backlog",
				color: "powder-blue",
				wipLimit: null,
				policy: "p",
				isDone: false,
			},
			{
				title: "Done",
				color: "oklch(88% 0.09 47.3)",
				wipLimit: null,
				policy: "p",
				isDone: true,
			},
		]);
		expect(result.valid).toBe(true);
		expect(result.normalized?.[1].color).toBe("oklch(88% 0.09 47.3)");
	});
});

describe("validateColumnBatch", () => {
	it("rejects a non-array or empty columns array", () => {
		expect(validateColumnBatch(undefined).valid).toBe(false);
		expect(validateColumnBatch(null).valid).toBe(false);
		expect(validateColumnBatch({}).valid).toBe(false);
		const empty = validateColumnBatch([]);
		expect(empty.valid).toBe(false);
		expect(empty.error).toBeTruthy();
	});

	it("rejects a color outside the 5-name palette", () => {
		const result = validateColumnBatch([col({ color: "hot-pink" })]);
		expect(result.valid).toBe(false);
		expect(result.error).toBeTruthy();
	});

	it("rejects more than one done-column", () => {
		const result = validateColumnBatch([
			col({ title: "A", isDone: true }),
			col({ title: "B", isDone: true }),
		]);
		expect(result.valid).toBe(false);
	});

	it("rejects a title that fails validateColumnName (blank)", () => {
		expect(validateColumnBatch([col({ title: "   " })]).valid).toBe(false);
	});

	it("rejects a wipLimit that is 0 or non-integer", () => {
		expect(validateColumnBatch([col({ wipLimit: 0 })]).valid).toBe(false);
		expect(validateColumnBatch([col({ wipLimit: 1.5 })]).valid).toBe(false);
	});

	it("accepts a valid 5-column template payload", () => {
		const result = validateColumnBatch(validFive);
		expect(result.valid).toBe(true);
		expect(result.normalized).toHaveLength(5);
		expect(result.normalized?.filter((c) => c.isDone)).toHaveLength(1);
	});
});
