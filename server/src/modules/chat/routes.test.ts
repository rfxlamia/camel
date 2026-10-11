import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunChatTurn = vi.fn();
const mockCheckChatLimit = vi.fn();
const routeTestConfig = {
	AGENT_SPEND_KILL_SWITCH: undefined as string | undefined,
};
const mockService = {
	listThreads: vi.fn(),
	createThread: vi.fn(),
	findEmptyThread: vi.fn(),
	renameThread: vi.fn(),
	deleteThread: vi.fn(),
	getThread: vi.fn(),
	getMessages: vi.fn(),
	insertMessage: vi.fn(),
	deleteMessage: vi.fn(),
	updateMessage: vi.fn(),
	autoTitleThread: vi.fn(),
	getAttachment: vi.fn(),
	getMessage: vi.fn(),
	getAttachmentsForMessages: vi.fn(),
	insertAttachment: vi.fn(),
};

vi.mock("../../config.js", () => ({
	config: routeTestConfig,
}));

vi.mock("../../lib/chat-rate-limit.js", () => ({
	checkChatLimit: (...args: unknown[]) => mockCheckChatLimit(...args),
}));

vi.mock("../../auth.js", () => ({
	requireAuth: (
		req: express.Request,
		_res: express.Response,
		next: () => void,
	) => {
		(req as express.Request & { userId?: number }).userId = 1;
		next();
	},
}));

vi.mock("../../lib/llm/run-chat-turn.js", () => ({
	runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
	estimateContextTokens: vi.fn(() => 100),
}));

vi.mock("./service.js", () => ({
	createChatService: () => mockService,
}));

vi.mock("../../lib/helpers.js", () => ({
	lookupMembership: vi.fn().mockResolvedValue("member"),
}));

describe("resolveMessageAction (chat)", () => {
	it("maps send and retry actions", async () => {
		const { resolveChatMessageAction } = await import("./routes.js");
		expect(resolveChatMessageAction({ message: " hi " })).toEqual({
			kind: "send",
			message: "hi",
		});
		expect(
			resolveChatMessageAction({ action: "retry", messageId: 42 }),
		).toEqual({ kind: "retry", messageId: 42 });
	});
});

describe("chat routes (mocked service + LLM)", () => {
	let app: express.Express;

	beforeEach(async () => {
		vi.clearAllMocks();
		routeTestConfig.AGENT_SPEND_KILL_SWITCH = undefined;
		const { estimateContextTokens } = await import(
			"../../lib/llm/run-chat-turn.js"
		);
		vi.mocked(estimateContextTokens).mockReturnValue(100);
		mockCheckChatLimit.mockResolvedValue({ isLocked: false });
		mockService.listThreads.mockResolvedValue([{ id: 1, title: "Untitled" }]);
		mockService.createThread.mockResolvedValue({ id: 2, title: "Untitled" });
		mockService.getThread.mockResolvedValue({
			id: 1,
			title: "Untitled",
			userId: 1,
		});
		mockService.getMessages.mockResolvedValue([]);
		mockService.getAttachmentsForMessages.mockResolvedValue(new Map());
		mockService.updateMessage.mockImplementation(async (id, params) => ({
			id,
			threadId: 1,
			role: "assistant",
			content: params.content,
			thinking: params.thinking ?? null,
			toolTrace: params.toolTrace ?? null,
			createdAt: new Date(),
		}));
		const { createChatRouter } = await import("./routes.js");
		app = express();
		app.use(createChatRouter());
	});

	it("GET /api/chat/threads lists user threads", async () => {
		const res = await request(app).get("/api/chat/threads");
		expect(res.status).toBe(200);
		expect(res.body).toEqual([{ id: 1, title: "Untitled" }]);
	});

	it("POST /api/chat/threads/:id/messages streams NDJSON token events", async () => {
		mockRunChatTurn.mockImplementation(async ({ onToken }) => {
			onToken("Hello");
			return { output: "Hello", thinking: "", toolTrace: [] };
		});
		mockService.insertMessage
			.mockResolvedValueOnce({ id: 10, role: "user", content: "Hi" })
			.mockResolvedValueOnce({ id: 11, role: "assistant", content: "" })
			.mockResolvedValueOnce({
				id: 11,
				role: "assistant",
				content: "Hello",
			});
		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "Hi", workspaceId: 7 });
		expect(res.status).toBe(200);
		expect(res.text).toContain('"type":"token"');
		expect(res.text).toContain('"type":"done"');
	});

	it("streams a user-safe error event and never leaks the raw error", async () => {
		mockService.insertMessage.mockReset();
		mockRunChatTurn.mockRejectedValueOnce(new Error("sk-secret driver detail"));
		mockService.insertMessage
			.mockResolvedValueOnce({ id: 10, role: "user", content: "Hi" })
			.mockResolvedValueOnce({ id: 11, role: "assistant", content: "" });
		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "Hi" });
		expect(res.status).toBe(200);
		expect(res.text).toContain('"type":"error"');
		expect(res.text).toContain("Failed to generate response");
		expect(res.text).not.toContain("sk-secret");
		expect(mockService.deleteMessage).toHaveBeenCalledWith(11);
	});

	it("still ends the response when error cleanup throws", async () => {
		mockService.insertMessage.mockReset();
		mockRunChatTurn.mockRejectedValueOnce(new Error("boom"));
		mockService.deleteMessage.mockRejectedValueOnce(new Error("db down"));
		mockService.insertMessage
			.mockResolvedValueOnce({ id: 10, role: "user", content: "Hi" })
			.mockResolvedValueOnce({ id: 11, role: "assistant", content: "" });
		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "Hi" });
		expect(res.status).toBe(200);
		expect(res.text).toContain('"type":"error"');
		expect(res.text).not.toContain("db down");
		expect(mockService.deleteMessage).toHaveBeenCalledWith(11);
	});

	it("marks the error non-retryable when the thread vanished mid-request", async () => {
		mockService.insertMessage.mockReset();
		mockService.insertMessage.mockResolvedValueOnce(null);
		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "Hi" });
		expect(res.status).toBe(200);
		expect(res.text).toContain('"type":"error"');
		expect(res.text).toContain('"retryable":false');
		expect(mockRunChatTurn).not.toHaveBeenCalled();
	});

	it("POST retry action regenerates without duplicate user message", async () => {
		mockRunChatTurn.mockImplementation(async ({ onToken }) => {
			onToken("Retry ok");
			return { output: "Retry ok", thinking: "", toolTrace: [] };
		});
		mockService.getMessage.mockResolvedValue({
			id: 11,
			threadId: 1,
			role: "assistant",
			content: "old",
		});
		mockService.getMessages.mockResolvedValue([
			{ id: 10, threadId: 1, role: "user", content: "Hi" },
			{ id: 11, threadId: 1, role: "assistant", content: "old" },
		]);
		mockService.insertMessage.mockResolvedValueOnce({
			id: 12,
			role: "assistant",
			content: "",
		});
		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ action: "retry", messageId: 11 });
		expect(res.status).toBe(200);
		expect(res.text).toContain('"type":"done"');
		expect(mockService.insertMessage).toHaveBeenCalledTimes(1);
	});

	it("GET /api/chat/attachments/:id returns file for owner", async () => {
		mockService.getAttachment.mockResolvedValue({
			id: 5,
			filename: "report.md",
			format: "md",
			content: "# Report",
		});
		const res = await request(app).get("/api/chat/attachments/5");
		expect(res.status).toBe(200);
		expect(res.headers["content-disposition"]).toMatch(/report\.md/);
	});

	it("GET /api/chat/attachments/:id returns 404 for non-owner", async () => {
		mockService.getAttachment.mockResolvedValue(null);
		const res = await request(app).get("/api/chat/attachments/99");
		expect(res.status).toBe(404);
	});

	it("returns 429 when chat rate limit exceeded", async () => {
		mockCheckChatLimit.mockResolvedValue({
			isLocked: true,
			retryAfterMs: 5000,
		});
		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "Hi" });
		expect(res.status).toBe(429);
		expect(mockRunChatTurn).not.toHaveBeenCalled();
	});

	it("returns 404 for other user's thread", async () => {
		mockService.getThread.mockResolvedValue(null);
		const res = await request(app).get("/api/chat/threads/99");
		expect(res.status).toBe(404);
	});

	it("returns 413 on context overflow without persisting user message", async () => {
		const { estimateContextTokens } = await import(
			"../../lib/llm/run-chat-turn.js"
		);
		vi.mocked(estimateContextTokens).mockReturnValue(999_999);
		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "overflow" });
		expect(res.status).toBe(413);
		expect(res.body.message).toContain("Thread too long");
		expect(mockService.insertMessage).not.toHaveBeenCalled();
	});

	it("keeps thread read/list/create/rename/delete available with spend disabled", async () => {
		routeTestConfig.AGENT_SPEND_KILL_SWITCH = "true";
		mockService.renameThread.mockResolvedValue({ id: 1, title: "Renamed" });
		mockService.deleteThread.mockResolvedValue(true);

		const list = await request(app).get("/api/chat/threads");
		const created = await request(app).post("/api/chat/threads");
		const read = await request(app).get("/api/chat/threads/1");
		const renamed = await request(app)
			.patch("/api/chat/threads/1")
			.send({ title: "Renamed" });
		const deleted = await request(app).delete("/api/chat/threads/1");

		expect(list.status).toBe(200);
		expect(created.status).toBe(200);
		expect(read.status).toBe(200);
		expect(renamed.status).toBe(200);
		expect(deleted.status).toBe(204);
		expect(mockService.listThreads).toHaveBeenCalled();
		expect(mockService.createThread).toHaveBeenCalled();
		expect(mockService.getMessages).toHaveBeenCalledTimes(1);
		expect(mockService.renameThread).toHaveBeenCalled();
		expect(mockService.deleteThread).toHaveBeenCalled();
		expect(mockRunChatTurn).not.toHaveBeenCalled();
		expect(mockService.insertMessage).not.toHaveBeenCalled();
	});

	it("keeps valid default-off send and retry streaming with persistence", async () => {
		mockRunChatTurn.mockResolvedValue({
			output: "ok",
			thinking: "",
			toolTrace: [],
		});
		mockService.insertMessage
			.mockResolvedValueOnce({ id: 20, role: "user", content: "Hi" })
			.mockResolvedValueOnce({ id: 21, role: "assistant", content: "" })
			.mockResolvedValueOnce({ id: 21, role: "assistant", content: "ok" })
			.mockResolvedValueOnce({ id: 22, role: "assistant", content: "" })
			.mockResolvedValueOnce({ id: 22, role: "assistant", content: "ok" });
		mockService.getMessage.mockResolvedValue({
			id: 11,
			threadId: 1,
			role: "assistant",
			content: "old",
		});

		const send = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "Hi" });
		const retry = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ action: "retry", messageId: 11 });

		expect(send.status).toBe(200);
		expect(send.headers["content-type"]).toMatch(/application\/x-ndjson/);
		expect(send.text).toContain('"type":"done"');
		expect(retry.status).toBe(200);
		expect(retry.headers["content-type"]).toMatch(/application\/x-ndjson/);
		expect(retry.text).toContain('"type":"done"');
		expect(mockRunChatTurn).toHaveBeenCalledTimes(2);
		expect(mockService.insertMessage).toHaveBeenCalledTimes(3);
		expect(mockService.deleteMessage).toHaveBeenCalledWith(11);
	});

	it("rejects enabled valid send with exact JSON before stream or persistence", async () => {
		routeTestConfig.AGENT_SPEND_KILL_SWITCH = "true";
		mockRunChatTurn.mockResolvedValue({
			output: "ok",
			thinking: "",
			toolTrace: [],
		});
		mockService.insertMessage
			.mockResolvedValueOnce({ id: 30, role: "user", content: "Hi" })
			.mockResolvedValueOnce({ id: 31, role: "assistant", content: "" });

		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "Hi", workspaceId: 7 });

		expect(res.status).toBe(503);
		expect(res.body).toEqual({
			error: "Agent spend is disabled by kill switch",
			code: "AGENT_SPEND_KILL_SWITCH",
		});
		expect(res.headers["content-type"]).not.toMatch(/application\/x-ndjson/);
		expect(mockService.getThread).toHaveBeenCalled();
		expect(mockCheckChatLimit).toHaveBeenCalled();
		expect(mockService.getMessages).toHaveBeenCalled();
		expect(mockService.insertMessage).not.toHaveBeenCalled();
		expect(mockService.deleteMessage).not.toHaveBeenCalled();
		expect(mockRunChatTurn).not.toHaveBeenCalled();
	});

	it("rejects enabled valid retry with exact JSON before stream or persistence", async () => {
		routeTestConfig.AGENT_SPEND_KILL_SWITCH = "true";
		mockService.getMessages.mockResolvedValue([
			{ id: 10, threadId: 1, role: "user", content: "Hi" },
			{ id: 11, threadId: 1, role: "assistant", content: "old" },
		]);
		mockService.getMessage.mockResolvedValue({
			id: 11,
			threadId: 1,
			role: "assistant",
			content: "old",
		});
		mockService.insertMessage.mockResolvedValue({
			id: 31,
			role: "assistant",
			content: "",
		});
		mockRunChatTurn.mockResolvedValue({
			output: "ok",
			thinking: "",
			toolTrace: [],
		});

		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ action: "retry", messageId: 11 });

		expect(res.status).toBe(503);
		expect(res.body).toEqual({
			error: "Agent spend is disabled by kill switch",
			code: "AGENT_SPEND_KILL_SWITCH",
		});
		expect(res.headers["content-type"]).not.toMatch(/application\/x-ndjson/);
		expect(mockService.getThread).toHaveBeenCalled();
		expect(mockCheckChatLimit).toHaveBeenCalled();
		expect(mockService.getMessages).toHaveBeenCalled();
		expect(mockService.getMessage).toHaveBeenCalledWith(1, 11);
		expect(mockService.insertMessage).not.toHaveBeenCalled();
		expect(mockService.deleteMessage).not.toHaveBeenCalled();
		expect(mockRunChatTurn).not.toHaveBeenCalled();
	});

	describe("enabled retry precedence baseline", () => {
		beforeEach(() => {
			routeTestConfig.AGENT_SPEND_KILL_SWITCH = "true";
			mockService.getMessages.mockResolvedValue([
				{ id: 10, threadId: 1, role: "user", content: "Hi" },
				{ id: 11, threadId: 1, role: "assistant", content: "old" },
			]);
			mockService.getMessage.mockResolvedValue({
				id: 11,
				threadId: 1,
				role: "assistant",
				content: "old",
			});
		});

		async function retry() {
			return request(app)
				.post("/api/chat/threads/1/messages")
				.send({ action: "retry", messageId: 11 });
		}

		function expectNoStart(response: request.Response) {
			expect(response.headers["content-type"]).not.toMatch(
				/application\/x-ndjson/,
			);
			expect(mockService.insertMessage).not.toHaveBeenCalled();
			expect(mockService.deleteMessage).not.toHaveBeenCalled();
			expect(mockRunChatTurn).not.toHaveBeenCalled();
		}

		it("returns retry-target 404 before spend denial", async () => {
			mockService.getMessage.mockResolvedValue(null);
			const res = await retry();
			expect(res.status).toBe(404);
			expect(res.body).toEqual({ error: "Not found" });
			expectNoStart(res);
		});

		it("returns inaccessible-thread 404 before spend denial", async () => {
			mockService.getThread.mockResolvedValue(null);
			const res = await retry();
			expect(res.status).toBe(404);
			expect(res.body).toEqual({ error: "Not found" });
			expectNoStart(res);
		});

		it("returns locked-rate-limit 429 before spend denial", async () => {
			mockCheckChatLimit.mockResolvedValue({
				isLocked: true,
				retryAfterMs: 5000,
			});
			const res = await retry();
			expect(res.status).toBe(429);
			expect(res.body).toEqual({
				error: "Too many chat messages",
				retryAfterMs: 5000,
			});
			expectNoStart(res);
		});

		it("returns oversized-context 413 before spend denial", async () => {
			const { estimateContextTokens } = await import(
				"../../lib/llm/run-chat-turn.js"
			);
			vi.mocked(estimateContextTokens).mockReturnValue(999_999);
			const res = await retry();
			expect(res.status).toBe(413);
			expect(res.body).toEqual({
				message: "Thread too long, start a new chat",
			});
			expectNoStart(res);
		});
	});
});
