import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunChatTurn = vi.fn();
const mockCheckChatLimit = vi.fn();
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

vi.mock("../agent/ticket-intake/rate-limits.js", () => ({
	checkChatLimit: (...args: unknown[]) => mockCheckChatLimit(...args),
}));

vi.mock("../auth.js", () => ({
	requireAuth: (req: express.Request, _res: express.Response, next: () => void) => {
		(req as express.Request & { userId?: number }).userId = 1;
		next();
	},
}));

vi.mock("./run-chat-turn.js", () => ({
	runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
	estimateContextTokens: vi.fn(() => 100),
}));

vi.mock("./service.js", () => ({
	createChatService: () => mockService,
}));

vi.mock("../routes/helpers.js", () => ({
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
		const { estimateContextTokens } = await import("./run-chat-turn.js");
		vi.mocked(estimateContextTokens).mockReturnValue(999_999);
		const res = await request(app)
			.post("/api/chat/threads/1/messages")
			.send({ message: "overflow" });
		expect(res.status).toBe(413);
		expect(res.body.message).toContain("Thread too long");
		expect(mockService.insertMessage).not.toHaveBeenCalled();
	});
});
