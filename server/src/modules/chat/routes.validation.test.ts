import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = {
	getThread: vi.fn(),
	renameThread: vi.fn(),
	deleteThread: vi.fn(),
	getAttachment: vi.fn(),
};
const writes = vi.fn();
const headers = vi.fn();
vi.mock("./service.js", () => ({ createChatService: () => service }));
vi.mock("../../auth.js", () => ({
	requireAuth: (
		req: express.Request,
		_res: express.Response,
		next: () => void,
	) => {
		(req as express.Request & { userId: number }).userId = 1;
		next();
	},
}));

describe("chat validation contracts", () => {
	let app: express.Express;
	beforeEach(async () => {
		vi.clearAllMocks();
		service.getThread.mockResolvedValue(null);
		service.renameThread.mockResolvedValue(null);
		service.deleteThread.mockResolvedValue(false);
		service.getAttachment.mockResolvedValue(null);
		const { createChatRouter } = await import("./routes.js");
		app = express();
		app.use((_req, res, next) => {
			const write = res.write.bind(res);
			res.write = ((...args: Parameters<typeof res.write>) => {
				writes();
				return write(...args);
			}) as typeof res.write;
			const setHeader = res.setHeader.bind(res);
			res.setHeader = ((
				name: string,
				value: string | number | readonly string[],
			) => {
				headers(name, value);
				return setHeader(name, value);
			}) as typeof res.setHeader;
			next();
		});
		app.use(createChatRouter());
	});

	for (const id of ["abc", "1.5"]) {
		for (const method of ["get", "patch", "delete", "post"] as const) {
			it(`${method} rejects thread id ${id} before invalid body`, async () => {
				const suffix = method === "post" ? "/messages" : "";
				const res = await request(app)
					[method](`/api/chat/threads/${id}${suffix}`)
					.send({});
				expect(res.status).toBe(400);
				expect(res.body).toEqual({ error: "thread id must be an integer" });
				if (method === "post") assertNoStream(res.headers["content-type"]);
			});
		}
		it(`rejects attachment id ${id}`, async () => {
			const res = await request(app).get(`/api/chat/attachments/${id}`);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "attachment id must be an integer" });
		});
	}
	for (const body of [
		{},
		{ title: "" },
		{ title: "  " },
		{ title: 3 },
		{ title: null },
	]) {
		it(`rejects title ${JSON.stringify(body)}`, async () => {
			const res = await request(app).patch("/api/chat/threads/1").send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "title is required" });
		});
	}
	for (const body of [
		{},
		{ message: " " },
		{ message: 3 },
		{ action: "unknown" },
		{ action: "retry" },
	]) {
		it(`rejects message/action ${JSON.stringify(body)} before stream`, async () => {
			const res = await request(app)
				.post("/api/chat/threads/1/messages")
				.send(body);
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "message or action is required" });
			assertNoStream(res.headers["content-type"]);
		});
	}
	for (const id of ["0", "1e2"]) {
		for (const method of ["get", "patch", "delete", "post"] as const) {
			it(`${method} preserves lenient thread id ${id}`, async () => {
				const suffix = method === "post" ? "/messages" : "";
				const res = await request(app)
					[method](`/api/chat/threads/${id}${suffix}`)
					.send({ title: "valid", message: "valid" });
				expect(res.status).toBe(404);
			});
		}
		it(`preserves lenient attachment id ${id}`, async () => {
			const res = await request(app).get(`/api/chat/attachments/${id}`);
			expect(res.status).toBe(404);
		});
	}
	function assertNoStream(contentType: string) {
		expect(contentType).not.toContain("text/event-stream");
		expect(contentType).not.toContain("application/x-ndjson");
		expect(writes).not.toHaveBeenCalled();
		expect(
			headers.mock.calls.some(
				([name, value]) =>
					name.toLowerCase() === "content-type" &&
					/event-stream|ndjson/.test(String(value)),
			),
		).toBe(false);
	}
});
