import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseWith, sendValidationError, validateOrReply } from "./http.js";

const schema = z.object({
	title: z.string({ error: "title is required" }),
	count: z.number({ error: "count must be a number" }),
});

describe("parseWith", () => {
	it("returns parsed data on success", () => {
		expect(parseWith(schema, { title: "a", count: 1 })).toEqual({
			ok: true,
			data: { title: "a", count: 1 },
		});
	});

	it("uses the first issue message as error", () => {
		expect(parseWith(schema, {})).toEqual({
			ok: false,
			body: { error: "title is required" },
		});
	});

	it("lets the caller override the message", () => {
		expect(parseWith(schema, {}, { message: "Invalid request body" })).toEqual({
			ok: false,
			body: { error: "Invalid request body" },
		});
	});

	it("builds fieldErrors from the first path segment when requested", () => {
		expect(
			parseWith(
				schema,
				{},
				{ message: "Some fields are invalid", fieldErrors: true },
			),
		).toEqual({
			ok: false,
			body: {
				error: "Some fields are invalid",
				fieldErrors: {
					title: "title is required",
					count: "count must be a number",
				},
			},
		});
	});

	it("omits fieldErrors when issues have no field path", () => {
		const result = parseWith(z.string({ error: "bad" }), 1, {
			fieldErrors: true,
		});
		expect(result).toEqual({ ok: false, body: { error: "bad" } });
	});
});

function mockRes() {
	const json = vi.fn();
	const status = vi.fn(() => ({ json }));
	return { res: { status } as never, status, json };
}

describe("sendValidationError", () => {
	it("replies 400 with the body", () => {
		const { res, status, json } = mockRes();
		sendValidationError(res, { error: "x" });
		expect(status).toHaveBeenCalledWith(400);
		expect(json).toHaveBeenCalledWith({ error: "x" });
	});
});

describe("validateOrReply", () => {
	it("returns data without replying on success", () => {
		const { res, status } = mockRes();
		expect(validateOrReply(res, z.string(), "ok")).toBe("ok");
		expect(status).not.toHaveBeenCalled();
	});

	it("replies 400 and returns undefined on failure", () => {
		const { res, status, json } = mockRes();
		expect(validateOrReply(res, schema, {})).toBeUndefined();
		expect(status).toHaveBeenCalledWith(400);
		expect(json).toHaveBeenCalledWith({ error: "title is required" });
	});
});
