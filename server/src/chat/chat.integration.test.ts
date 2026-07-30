import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../db/kysely.js";

const { mockRunChatTurn } = vi.hoisted(() => ({
	mockRunChatTurn: vi.fn(),
}));

vi.mock("../auth.js", () => ({
	requireAuth: (req: express.Request, _res: express.Response, next: () => void) => {
		(req as express.Request & { userId?: number }).userId = (
			globalThis as { testUserId?: number }
		).testUserId;
		next();
	},
}));

vi.mock("./run-chat-turn.js", () => ({
	runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
	estimateContextTokens: vi.fn(() => 100),
}));

/**
 * RUN_INTEGRATION=1 npm run test -- server/src/chat/chat.integration.test.ts
 * Manual note: workspace clarification is LLM-driven via system prompt — not assertable without RUN_LLM_IT.
 */
describe.skipIf(!process.env.RUN_INTEGRATION)("chat end-to-end", () => {
	let app: express.Express;
	let userId: number;
	let workspaceId: number;
	let threadId: number;

	beforeAll(async () => {
		const { resetRateLimitsForTesting } = await import(
			"../agent/ticket-intake/rate-limits.js"
		);
		resetRateLimitsForTesting();

		const user = await db
			.insertInto("users")
			.values({
				username: `chat-e2e-${Date.now()}`,
				display_name: "E2E",
				password_hash: "h",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		userId = user.id;
		(globalThis as { testUserId?: number }).testUserId = userId;

		const workspace = await db
			.insertInto("workspaces")
			.values({
				name: "Chat E2E WS",
				owner_user_id: userId,
				is_personal: false,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		workspaceId = workspace.id;

		await db
			.insertInto("workspace_members")
			.values({
				workspace_id: workspaceId,
				user_id: userId,
				role: "owner",
			})
			.execute();

		const { createChatRouter } = await import("./routes.js");
		app = express();
		app.use(createChatRouter());
	});

	afterAll(async () => {
		await db.deleteFrom("workspaces").where("id", "=", workspaceId).execute();
		await db.deleteFrom("users").where("id", "=", userId).execute();
	});

	it("create thread → stream message → persist → reload → delete cascade", async () => {
		const createRes = await request(app).post("/api/chat/threads");
		expect(createRes.status).toBe(200);
		threadId = createRes.body.id;
		expect(createRes.body.title).toBe("Untitled");

		mockRunChatTurn.mockImplementation(async ({ onToken, onToolEvent }) => {
			onToolEvent?.({
				phase: "started",
				toolName: "web_search",
				query: "camel",
			});
			onToolEvent?.({
				phase: "result",
				toolName: "web_search",
				resultCount: 3,
			});
			onToken("Hello");
			return {
				output: "Hello",
				thinking: "thought",
				toolTrace: [{ toolName: "web_search", query: "camel", resultCount: 3 }],
			};
		});

		const streamRes = await request(app)
			.post(`/api/chat/threads/${threadId}/messages`)
			.send({ message: "Search camel kanban", workspaceId });
		expect(streamRes.status).toBe(200);
		expect(streamRes.text).toContain('"type":"token"');
		expect(streamRes.text).toContain('"type":"done"');

		const msgsRes = await request(app).get(`/api/chat/threads/${threadId}`);
		expect(msgsRes.status).toBe(200);
		expect(
			msgsRes.body.messages.some((m: { role: string }) => m.role === "assistant"),
		).toBe(true);
		const assistant = msgsRes.body.messages.find(
			(m: { role: string }) => m.role === "assistant",
		);
		expect(assistant.toolTrace).toBeDefined();
		expect(msgsRes.body.title).not.toBe("Untitled");

		if (assistant.attachments?.length) {
			const attRes = await request(app).get(
				`/api/chat/attachments/${assistant.attachments[0].id}`,
			);
			expect(attRes.status).toBe(200);
		}

		const delRes = await request(app).delete(`/api/chat/threads/${threadId}`);
		expect(delRes.status).toBe(204);
		const gone = await db
			.selectFrom("chat_threads")
			.where("id", "=", threadId)
			.selectAll()
			.execute();
		expect(gone).toHaveLength(0);
	});
});
