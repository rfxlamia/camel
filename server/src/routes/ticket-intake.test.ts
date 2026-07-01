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
const mockPeekSubmitLimit = vi.fn();
const mockRecordSubmitSuccess = vi.fn();
vi.mock("../agent/ticket-intake/rate-limits.js", () => ({
	checkChatLimit: (...args: unknown[]) => mockCheckChatLimit(...args),
	peekSubmitLimit: (...args: unknown[]) => mockPeekSubmitLimit(...args),
	recordSubmitSuccess: (...args: unknown[]) => mockRecordSubmitSuccess(...args),
}));
vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn().mockResolvedValue(undefined),
}));
const mockCreateLinearIssue = vi.fn();
const mockCreateLinearComment = vi.fn();
vi.mock("../agent/ticket-intake/linear-client.js", () => ({
	createLinearIssue: (...args: unknown[]) => mockCreateLinearIssue(...args),
	createLinearComment: (...args: unknown[]) => mockCreateLinearComment(...args),
	getLabelId: vi.fn().mockResolvedValue("label-bug-id"),
}));
vi.mock("../agent/ticket-intake/retry.js", () => ({
	executeWithRetry: async (
		op: () => Promise<unknown>,
		opts: { maxAttempts: number },
	) => {
		let attempt = 0;
		for (;;) {
			attempt++;
			try {
				return await op();
			} catch (err: unknown) {
				const status = (err as { status?: number })?.status ?? 500;
				const retryable = status >= 500;
				if (!retryable) throw { retryable: false, cause: err };
				if (attempt >= opts.maxAttempts) throw { retryable: true, cause: err };
			}
		}
	},
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

import { publishEvent } from "../realtime.js";
import { ticketIntakeRouter } from "./ticket-intake.js";

const mockPublishEvent = vi.mocked(publishEvent);

async function flush() {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

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

describe("POST /api/workspaces/:workspaceId/ticket-intake/submit", () => {
	beforeEach(() => {
		mockLookupMembership.mockReset().mockResolvedValue("member");
		mockPeekSubmitLimit.mockReset().mockResolvedValue({ isLocked: false });
		mockRecordSubmitSuccess.mockReset();
		mockCreateLinearIssue.mockReset();
		mockCreateLinearComment.mockReset().mockResolvedValue(undefined);
		mockPublishEvent.mockReset();
		mockRecordActivity.mockReset().mockResolvedValue(undefined);
	});

	it("responds 202 immediately and eventually publishes success on first-try issueCreate", async () => {
		mockCreateLinearIssue.mockResolvedValueOnce({
			issueUrl: "https://linear.app/cam/issue/CAM-1",
			issueIdentifier: "CAM-1",
		});

		const res = await request(app)
			.post("/api/workspaces/1/ticket-intake/submit")
			.send({ title: "Bug title", description: "desc", type: "Bug" });

		expect(res.status).toBe(202);

		await flush();
		expect(mockPublishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({
				type: "ticket_intake.submit_result",
				success: true,
				issueUrl: "https://linear.app/cam/issue/CAM-1",
				issueIdentifier: "CAM-1",
			}),
		);
	});

	it("reports eventual success after transient 500-class failures, consuming quota exactly once", async () => {
		mockCreateLinearIssue
			.mockRejectedValueOnce({ status: 500 })
			.mockRejectedValueOnce({ status: 500 })
			.mockResolvedValueOnce({
				issueUrl: "https://linear.app/cam/issue/CAM-2",
				issueIdentifier: "CAM-2",
			});

		await request(app)
			.post("/api/workspaces/1/ticket-intake/submit")
			.send({ title: "Bug title", description: "desc", type: "Bug" });

		await flush();
		expect(mockPublishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ success: true }),
		);
		expect(mockRecordSubmitSuccess).toHaveBeenCalledTimes(1);
	});

	it("reports failure quickly on a 400-class error with no retry", async () => {
		mockCreateLinearIssue.mockRejectedValueOnce({ status: 422 });

		await request(app)
			.post("/api/workspaces/1/ticket-intake/submit")
			.send({ title: "Bug title", description: "desc", type: "Bug" });

		await flush();
		expect(mockCreateLinearIssue).toHaveBeenCalledTimes(1);
		expect(mockPublishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ success: false, retryable: false }),
		);
	});

	it("reports graceful failure after all 10 retries are exhausted on 500-class errors", async () => {
		mockCreateLinearIssue.mockRejectedValue({ status: 500 });

		await request(app)
			.post("/api/workspaces/1/ticket-intake/submit")
			.send({ title: "Bug title", description: "desc", type: "Bug" });

		await flush();
		expect(mockCreateLinearIssue).toHaveBeenCalledTimes(10);
		expect(mockPublishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ success: false, retryable: true }),
		);
		expect(mockRecordSubmitSuccess).not.toHaveBeenCalled();
	});

	it("still reports overall success when issueCreate succeeds but createLinearComment fails", async () => {
		mockCreateLinearIssue.mockResolvedValueOnce({
			issueUrl: "https://linear.app/cam/issue/CAM-3",
			issueIdentifier: "CAM-3",
		});
		mockCreateLinearComment.mockRejectedValueOnce(new Error("comment failed"));

		await request(app)
			.post("/api/workspaces/1/ticket-intake/submit")
			.send({ title: "Bug title", description: "desc", type: "Bug" });

		await flush();
		expect(mockPublishEvent).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ success: true }),
		);
	});

	it("returns 409 immediately without calling createLinearIssue when the submit rate limit is locked", async () => {
		mockPeekSubmitLimit.mockResolvedValueOnce({ isLocked: true });

		const res = await request(app)
			.post("/api/workspaces/1/ticket-intake/submit")
			.send({ title: "Bug title", description: "desc", type: "Bug" });

		expect(res.status).toBe(409);
		expect(mockCreateLinearIssue).not.toHaveBeenCalled();
	});
});
