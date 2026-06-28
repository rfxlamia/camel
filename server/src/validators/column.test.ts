import { describe, expect, it } from "vitest";
import { validateColumnBatch } from "./column.js";

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
