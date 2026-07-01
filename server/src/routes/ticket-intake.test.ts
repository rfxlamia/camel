import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Single resettable factory for ./helpers.js — Tasks 6 and 7 extend THIS
// mock (vi.mock allows exactly one factory per module path per file; never
// redeclare it when those tasks add their describes to this file).
const mockLookupMembership = vi.fn();
const mockRecordActivity = vi.fn();
vi.mock("./helpers.js", () => ({
	lookupMembership: (...args: unknown[]) => mockLookupMembership(...args),
	recordActivity: (...args: unknown[]) => mockRecordActivity(...args),
}));
vi.mock("../auth.js", () => ({
	requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const mockCheckChatLimit = vi.fn().mockResolvedValue({ isLocked: false });
vi.mock("../agent/ticket-intake/rate-limits.js", () => ({
	checkChatLimit: (...args: unknown[]) => mockCheckChatLimit(...args),
}));
const mockExtractTicketFields = vi.fn();
vi.mock("../agent/ticket-intake/llm.js", () => ({
	extractTicketFields: (...args: unknown[]) =>
		mockExtractTicketFields(...args),
}));
vi.mock("../agent/ticket-intake/completeness.js", () => ({
	checkCompleteness: vi.fn(
		(extraction: { title: string; expected: string; actual: string }) => {
			if (!extraction.title) {
				return {
					ready: false,
					missingFields: ["title"],
					question: "What's a short title?",
				};
			}
			if (!extraction.expected || !extraction.actual) {
				return {
					ready: false,
					missingFields: ["expected", "actual"],
					question: "What did you expect vs. what actually happened?",
				};
			}
			return { ready: true };
		},
	),
}));

import { ticketIntakeRouter } from "./ticket-intake.js";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
	next();
});
app.use("/api", ticketIntakeRouter);

describe("POST /api/workspaces/:workspaceId/ticket-intake/chat", () => {
	beforeEach(() => {
		mockExtractTicketFields.mockReset();
		mockLookupMembership.mockReset().mockResolvedValue("member");
		mockCheckChatLimit.mockReset().mockResolvedValue({ isLocked: false });
	});

	it("asks a classifier-directing question on turn 1 for non-auto-error entry points", async () => {
		mockExtractTicketFields.mockResolvedValueOnce({
			title: "",
			description: "kanban-nya aneh",
			expected: "",
			actual: "",
			repro: "",
			type: null,
		});

		const res = await request(app)
			.post("/api/workspaces/1/ticket-intake/chat")
			.send({ message: "kanban-nya aneh", isFirstTurn: true, autoError: false });

		expect(res.status).toBe(200);
		expect(res.body.ready).toBe(false);
		expect(res.body.question).toMatch(/bug|feature|improvement/i);
	});

	it("returns ready:true with a draft when accumulated input is already detailed (fast path)", async () => {
		mockExtractTicketFields.mockResolvedValueOnce({
			title: "Drag-drop breaks",
			description: "desc",
			expected: "card moves",
			actual: "card snaps back",
			repro: "drag card X",
			type: "Bug",
		});

		const res = await request(app)
			.post("/api/workspaces/1/ticket-intake/chat")
			.send({
				message: "bug",
				conversationHistory: [{ role: "user", content: "kanban-nya aneh" }],
			});

		expect(res.status).toBe(200);
		expect(res.body.ready).toBe(true);
		expect(res.body.draft).toBeDefined();
		expect(res.body.question).toBeUndefined();
	});

	it("asks a specific clarifying question when accumulated input is still vague (guided path)", async () => {
		mockExtractTicketFields.mockResolvedValueOnce({
			title: "Kanban aneh",
			description: "desc",
			expected: "",
			actual: "",
			repro: "",
			type: "Bug",
		});

		const res = await request(app)
			.post("/api/workspaces/1/ticket-intake/chat")
			.send({
				message: "bug",
				conversationHistory: [{ role: "user", content: "kanban-nya aneh" }],
			});

		expect(res.status).toBe(200);
		expect(res.body.ready).toBe(false);
		expect(res.body.question).toMatch(/expect|actual/i);
	});

	it("returns 404 with no draft data for a user who is not a workspace member", async () => {
		mockLookupMembership.mockResolvedValueOnce(null);

		const res = await request(app)
			.post("/api/workspaces/1/ticket-intake/chat")
			.send({ message: "kanban-nya aneh", isFirstTurn: true, autoError: false });

		expect(res.status).toBe(404);
		expect(res.body.draft).toBeUndefined();
	});

	it("skips classifier and forces type Bug when autoError is true", async () => {
		mockExtractTicketFields.mockResolvedValueOnce({
			title: "Runtime error",
			description: "TypeError in console",
			expected: "Page loads",
			actual: "White screen",
			repro: "Open /board",
			type: null,
		});

		const res = await request(app)
			.post("/api/workspaces/1/ticket-intake/chat")
			.send({
				message: "TypeError: cannot read property",
				isFirstTurn: true,
				autoError: true,
			});

		expect(res.status).toBe(200);
		expect(res.body.ready).toBe(true);
		expect(res.body.question).toBeUndefined();
		expect(res.body.draft?.type).toBe("Bug");
	});
});
