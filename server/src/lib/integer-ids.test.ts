import { describe, expect, it } from "vitest";
import { extractIntegerIds } from "./integer-ids.js";

// Lock-reference extraction is NOT validation: malformed input is silently filtered.
describe("extractIntegerIds", () => {
	it.each([
		{ value: [1, "x", 2.5, 3], expected: [1, 3] },
		{ value: null, expected: [] },
		{ value: "1,2", expected: [] },
		{ value: undefined, expected: [] },
		{ value: {}, expected: [] },
		{ value: [], expected: [] },
	])("extracts lock references from $value", ({ value, expected }) => {
		expect(extractIntegerIds(value)).toEqual(expected);
	});

	it("preserves retained order and duplicates without mutating input", () => {
		const value = Object.freeze([3, "x", 1, 3, 2.5, 1]);
		expect(extractIntegerIds(value)).toEqual([3, 1, 3, 1]);
		expect(value).toEqual([3, "x", 1, 3, 2.5, 1]);
	});

	it("retains unsafe integers, zero, and negatives like the existing lock plumbing", () => {
		const unsafe = Number.MAX_SAFE_INTEGER + 1;
		expect(extractIntegerIds([unsafe, 0, -2, unsafe])).toEqual([
			unsafe,
			0,
			-2,
			unsafe,
		]);
	});

	it("drops non-integer elements without coercion", () => {
		expect(
			extractIntegerIds([
				NaN,
				Infinity,
				-Infinity,
				true,
				null,
				undefined,
				{},
				"2",
				2,
			]),
		).toEqual([2]);
	});
});
