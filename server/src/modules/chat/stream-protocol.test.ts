import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { safeEndStream, safeWriteStreamEvent } from "./stream-protocol.js";

function fakeRes(overrides: Partial<Response> = {}): Response {
	return {
		writableEnded: false,
		destroyed: false,
		write: vi.fn(),
		end: vi.fn(),
		...overrides,
	} as unknown as Response;
}

describe("safeWriteStreamEvent", () => {
	it("writes NDJSON and returns true on a live response", () => {
		const res = fakeRes();
		expect(safeWriteStreamEvent(res, { type: "token", text: "hi" })).toBe(true);
		expect(res.write).toHaveBeenCalledWith('{"type":"token","text":"hi"}\n');
	});

	it("returns false without writing when the client disconnected", () => {
		const res = fakeRes({ destroyed: true });
		expect(safeWriteStreamEvent(res, { type: "token", text: "hi" })).toBe(
			false,
		);
		expect(res.write).not.toHaveBeenCalled();
	});

	it("returns false instead of throwing when write throws", () => {
		const res = fakeRes({
			write: vi.fn(() => {
				throw new Error("ERR_STREAM_DESTROYED");
			}),
		} as Partial<Response>);
		expect(() =>
			safeWriteStreamEvent(res, { type: "error", message: "x" }),
		).not.toThrow();
		expect(safeWriteStreamEvent(res, { type: "error", message: "x" })).toBe(
			false,
		);
	});
});

describe("safeEndStream", () => {
	it("does not throw when end throws or the stream already ended", () => {
		const throwing = fakeRes({
			end: vi.fn(() => {
				throw new Error("closed");
			}),
		} as Partial<Response>);
		expect(() => safeEndStream(throwing)).not.toThrow();
		const ended = fakeRes({ writableEnded: true });
		safeEndStream(ended);
		expect(ended.end).not.toHaveBeenCalled();
	});
});
