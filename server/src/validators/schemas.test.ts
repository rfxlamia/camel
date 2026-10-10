import { describe, expect, it } from "vitest";
import { parseWith } from "./http.js";
import {
	finiteNumber,
	integerIdArray,
	intField,
	intOrNullField,
	legacyIntegerParam,
	optionalVersion,
	parsePositiveIntegerParam,
	positiveIdParam,
	requiredVersion,
	trimmedRequired,
	workspaceIdParam,
} from "./schemas.js";

describe("legacyIntegerParam", () => {
	const samples: unknown[] = [
		"5",
		"0",
		"-1",
		"1e2",
		"",
		" 1",
		// Pin legacy leniency reachable only through query or JSON-sourced values.
		null,
		[],
		true,
		["1"],
		"abc",
		"1.5",
		undefined,
		{},
	];

	it.each(
		samples.map((raw) => ({ raw })),
	)("matches Number.isInteger(Number($raw))", ({ raw }) => {
		const value = Number(raw);
		const result = parseWith(legacyIntegerParam("m"), raw);
		expect(result.ok).toBe(Number.isInteger(value));
		expect(result).toEqual(
			Number.isInteger(value)
				? { ok: true, data: value }
				: { ok: false, body: { error: "m" } },
		);
	});
});

describe("integerIdArray", () => {
	const schema = integerIdArray("labelIds");
	const error = {
		ok: false,
		body: { error: "labelIds must be an array of integers" },
	};

	it.each(
		[[], [1, 2], [1, 1]].map((value) => ({ value })),
	)("accepts $value unchanged", ({ value }) => {
		expect(parseWith(schema, value)).toEqual({ ok: true, data: value });
	});

	it.each(
		[null, "1,2", {}, [1, "x"], [1.5], [null]].map((value) => ({ value })),
	)("rejects $value with the field error", ({ value }) => {
		expect(parseWith(schema, value)).toEqual(error);
	});

	it("rejects undefined", () => {
		expect(parseWith(schema, undefined)).toEqual(error);
	});

	it.each(
		[[-1], [0], [Number.MAX_SAFE_INTEGER + 1]].map((value) => ({ value })),
	)("matches Number.isInteger acceptance for $value", ({ value }) => {
		expect(parseWith(schema, value)).toEqual({ ok: true, data: value });
	});

	it.each(
		[[Number.NaN], [Number.POSITIVE_INFINITY]].map((value) => ({ value })),
	)("rejects non-integer number arrays $value", ({ value }) => {
		expect(parseWith(schema, value)).toEqual(error);
	});

	it("rejects sparse arrays like the Number.isInteger loop", () => {
		const sparse: unknown[] = [];
		sparse.length = 1;
		expect(parseWith(schema, sparse)).toEqual(error);
	});
});

describe("workspaceIdParam", () => {
	it("keeps strict positive digit-string behavior", () => {
		for (const raw of ["1", "01"]) {
			expect(parseWith(workspaceIdParam, raw)).toEqual({ ok: true, data: 1 });
		}
		for (const raw of ["0", "-1", "1e2", "", " 1", "abc", "9007199254740993"]) {
			expect(parseWith(workspaceIdParam, raw)).toEqual({
				ok: false,
				body: { error: "workspaceId must be an integer" },
			});
		}
		expect(parseWith(workspaceIdParam, undefined).ok).toBe(false);
	});

	it("coerces positive integer strings", () => {
		expect(parseWith(workspaceIdParam, "42")).toEqual({ ok: true, data: 42 });
	});

	it.each([
		"",
		"  ",
		"0",
		"-5",
		"1.5",
		"1e3",
		"0x10",
		"abc",
		"NaN",
		"Infinity",
		"9007199254740993",
	])("rejects %j", (raw) => {
		expect(parseWith(workspaceIdParam, raw)).toEqual({
			ok: false,
			body: { error: "workspaceId must be an integer" },
		});
	});

	it("rejects non-strings", () => {
		expect(parseWith(workspaceIdParam, undefined).ok).toBe(false);
	});
});

describe("optionalVersion", () => {
	it("accepts undefined and integers", () => {
		expect(parseWith(optionalVersion, undefined).ok).toBe(true);
		expect(parseWith(optionalVersion, 3)).toEqual({ ok: true, data: 3 });
	});

	it.each([
		1.5,
		"3",
		null,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects %j", (value) => {
		expect(parseWith(optionalVersion, value)).toEqual({
			ok: false,
			body: { error: "version must be an integer" },
		});
	});
});

describe("parsePositiveIntegerParam", () => {
	it("parses digit-only positive integers", () => {
		expect(parsePositiveIntegerParam("7")).toBe(7);
	});

	it.each([
		undefined,
		"",
		"0",
		"-1",
		"1.5",
		"1e3",
		"abc",
	])("returns null for %j", (value) => {
		expect(parsePositiveIntegerParam(value)).toBeNull();
	});
});

describe("requiredVersion", () => {
	it("accepts integers", () => {
		expect(parseWith(requiredVersion, 4)).toEqual({ ok: true, data: 4 });
	});

	it.each([undefined, null, "1", 1.5, Number.NaN])("rejects %j", (value) => {
		expect(parseWith(requiredVersion, value)).toEqual({
			ok: false,
			body: { error: "version must be an integer" },
		});
	});
});

describe("positiveIdParam", () => {
	const schema = positiveIdParam("invalid thing id");

	it("coerces digit strings", () => {
		expect(parseWith(schema, "12")).toEqual({ ok: true, data: 12 });
	});

	it.each([
		"",
		"0",
		"-1",
		"1.5",
		"1e2",
		"0x10",
		" 5 ",
		"abc",
		"9007199254740993",
	])("rejects %j with the caller's message", (raw) => {
		expect(parseWith(schema, raw)).toEqual({
			ok: false,
			body: { error: "invalid thing id" },
		});
	});
});

describe("trimmedRequired", () => {
	const schema = trimmedRequired("name is required");

	it("returns the trimmed value", () => {
		expect(parseWith(schema, "  hi  ")).toEqual({ ok: true, data: "hi" });
	});

	it.each(["", "   ", undefined, null, 5])("rejects %j", (value) => {
		expect(parseWith(schema, value)).toEqual({
			ok: false,
			body: { error: "name is required" },
		});
	});
});

describe("intField / intOrNullField / finiteNumber", () => {
	it("intField accepts integers only", () => {
		expect(parseWith(intField("bad"), 3).ok).toBe(true);
		for (const value of [1.5, "3", null, undefined]) {
			expect(parseWith(intField("bad"), value)).toEqual({
				ok: false,
				body: { error: "bad" },
			});
		}
	});

	it("intOrNullField also accepts null", () => {
		expect(parseWith(intOrNullField("bad"), null)).toEqual({
			ok: true,
			data: null,
		});
		expect(parseWith(intOrNullField("bad"), "x").ok).toBe(false);
	});

	it("finiteNumber rejects NaN, Infinity and strings", () => {
		expect(parseWith(finiteNumber("bad"), 0.5).ok).toBe(true);
		for (const value of [
			Number.NaN,
			Number.POSITIVE_INFINITY,
			"1",
			undefined,
		]) {
			expect(parseWith(finiteNumber("bad"), value).ok).toBe(false);
		}
	});
});
