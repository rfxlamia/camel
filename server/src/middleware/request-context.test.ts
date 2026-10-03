import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { requestContext } from "../lib/logger.js";
import { requestContextMiddleware } from "./request-context.js";

function run(inbound?: string) {
	const req = { get: vi.fn(() => inbound), method: "GET", path: "/x" } as any;
	const res = Object.assign(new EventEmitter(), {
		setHeader: vi.fn(),
		statusCode: 200,
	}) as any;
	let storeId: string | undefined;
	requestContextMiddleware()(req, res, () => {
		storeId = requestContext.getStore()?.requestId;
	});
	return { req, res, storeId };
}

describe("requestContextMiddleware", () => {
	it("honors a safe inbound x-request-id and binds it to the context", () => {
		const { req, res, storeId } = run("abc-123");
		expect(req.id).toBe("abc-123");
		expect(storeId).toBe("abc-123");
		expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", "abc-123");
	});

	it("replaces a malformed inbound id with a generated one", () => {
		const { req, res } = run("bad id\r\nX-Evil: 1");
		expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.id);
	});

	it("generates an id when none is supplied", () => {
		const { req } = run(undefined);
		expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
	});
});
