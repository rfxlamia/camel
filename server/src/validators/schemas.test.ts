import { describe, expect, it } from "vitest";
import { parseWith } from "./http.js";
import {
	optionalVersion,
	parsePositiveIntegerParam,
	workspaceIdParam,
} from "./schemas.js";

describe("workspaceIdParam", () => {
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
