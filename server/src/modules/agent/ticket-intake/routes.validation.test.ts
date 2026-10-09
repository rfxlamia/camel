import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../auth.js", () => ({
	requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../../lib/helpers.js", () => ({
	lookupMembership: vi.fn().mockResolvedValue("member"),
	recordActivity: vi.fn(),
}));
vi.mock("../../../db/kysely.js", () => ({ db: {} }));
vi.mock("../../../realtime.js", () => ({ publishEvent: vi.fn() }));
vi.mock("./rate-limits.js", () => ({
	checkChatLimit: vi.fn(),
	peekChatLimit: vi.fn(),
	peekSubmitLimit: vi.fn(),
	recordSubmitSuccess: vi.fn(),
}));
vi.mock("./llm.js", () => ({ extractTicketFields: vi.fn() }));
vi.mock("./linear-client.js", () => ({
	isTicketIntakeConfigured: () => true,
	createLinearIssue: vi.fn(),
	createLinearComment: vi.fn(),
	getLabelId: vi.fn(),
}));
vi.mock("./history.js", () => ({
	getTicketHistory: vi.fn().mockResolvedValue([]),
}));

import { ticketIntakeRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
	next();
});
app.use("/api", ticketIntakeRouter);

const base = "/api/workspaces";

describe("ticket-intake validation response characterization", () => {
	it.each([
		"chat-limit",
		"history?cardId=abc",
	])("rejects invalid workspace before GET %s validation", async (route) => {
		const res = await request(app).get(`${base}/abc/ticket-intake/${route}`);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "workspaceId must be an integer" });
	});

	it.each([
		"chat",
		"submit",
		"resubmit",
	])("rejects invalid workspace before POST %s body validation", async (route) => {
		const res = await request(app)
			.post(`${base}/abc/ticket-intake/${route}`)
			.send({});
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "workspaceId must be an integer" });
	});

	it.each([
		{},
		{ message: "   " },
		{ message: 1 },
	])("rejects absent, blank or non-string chat message: %j", async (body) => {
		const res = await request(app)
			.post(`${base}/1/ticket-intake/chat`)
			.send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "message is required" });
	});

	it.each([
		"abc",
		"1.5",
		"1&cardId=2",
	])("rejects invalid history cardId=%s (including repeated query values)", async (cardId) => {
		const res = await request(app).get(
			`${base}/1/ticket-intake/history?cardId=${cardId}`,
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "cardId must be an integer" });
	});

	it.each([
		"submit",
		"resubmit",
	])("rejects malformed %s body", async (route) => {
		const res = await request(app)
			.post(`${base}/1/ticket-intake/${route}`)
			.send({ title: "", description: "desc", type: "Bug" });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Invalid submit body" });
	});
});
