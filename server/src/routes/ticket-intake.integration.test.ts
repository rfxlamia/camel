import "dotenv/config";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockAnthropicCreate } = vi.hoisted(() => ({
	mockAnthropicCreate: vi.fn(),
}));

interface FakeRow {
	card_id: number | null;
	event_type: string;
	payload: Record<string, unknown>;
	workspace_id: number;
	created_at: string;
}

let cardEvents: FakeRow[] = [];

vi.mock("../config.js", () => ({
	config: {
		ANTHROPIC_API_KEY: "test-anthropic-key",
		ANTHROPIC_MODEL: "claude-sonnet-4-20250514",
		LINEAR_API_KEY: "test-linear-key",
		LINEAR_TEAM_ID: "team-123",
	},
}));

vi.mock("../db/pool.js", () => ({
	pool: {
		query: vi.fn(async (sql: string, params: unknown[]) => {
			if (/INSERT INTO card_events/i.test(sql)) {
				const [cardId, , , , eventType, payloadJson, workspaceId] = params as [
					number | null,
					unknown,
					unknown,
					unknown,
					string,
					string,
					number,
				];
				cardEvents.push({
					card_id: cardId,
					event_type: eventType,
					payload: JSON.parse(payloadJson),
					workspace_id: workspaceId,
					created_at: new Date().toISOString(),
				});
				return { rows: [], rowCount: 1 };
			}
			if (/SELECT payload, created_at FROM card_events/i.test(sql)) {
				const [workspaceId, cardId] = params as [number, number];
				const rows = cardEvents
					.filter(
						(r) =>
							r.workspace_id === workspaceId &&
							r.card_id === cardId &&
							r.event_type === "linear_ticket_created",
					)
					.sort((a, b) => b.created_at.localeCompare(a.created_at))
					.map((r) => ({ payload: r.payload, created_at: r.created_at }));
				return { rows, rowCount: rows.length };
			}
			return { rows: [], rowCount: 0 };
		}),
	},
}));

vi.mock("./helpers.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./helpers.js")>();
	return { ...actual, lookupMembership: vi.fn().mockResolvedValue("member") };
});

vi.mock("../auth.js", () => ({
	requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../realtime.js", () => ({
	publishEvent: vi.fn().mockResolvedValue(undefined),
	clearPresence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@anthropic-ai/sdk", () => ({
	default: class MockAnthropic {
		messages = { create: mockAnthropicCreate };
	},
}));

const mockLinearFetch = vi.fn();
vi.stubGlobal("fetch", mockLinearFetch);

async function flush() {
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

async function submitAndWaitForBackground(
	app: express.Express,
	body: Record<string, unknown>,
) {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	let submitRes: request.Response;
	try {
		submitRes = await request(app)
			.post("/api/workspaces/1/ticket-intake/submit")
			.send(body);
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(600_000);
	} finally {
		vi.useRealTimers();
	}
	await flush();
	return submitRes;
}

describe("ticket-intake end-to-end: card-context submit → history", () => {
	let app: express.Express;

	beforeEach(async () => {
		cardEvents = [];
		mockAnthropicCreate.mockReset();
		mockLinearFetch.mockReset();
		const { resetRateLimitsForTesting } = await import(
			"../agent/ticket-intake/rate-limits.js"
		);
		resetRateLimitsForTesting();
		const { ticketIntakeRouter } = await import("./ticket-intake.js");
		app = express();
		app.use(express.json());
		app.use((req, _res, next) => {
			(req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
			next();
		});
		app.use("/api", ticketIntakeRouter);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.resetModules();
	});

	it("records exactly 1 card_events row and reflects it in history after a transient-then-success submit", async () => {
		mockAnthropicCreate.mockResolvedValueOnce({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						title: "Fix login redirect",
						description: "Redirect loops on logout",
						expected: "user lands on dashboard",
						actual: "redirect loop",
						repro: "log out then log back in",
						type: "Bug",
					}),
				},
			],
		});

		await request(app)
			.post("/api/workspaces/1/ticket-intake/chat")
			.send({
				message: "Fix login redirect keeps looping",
				isFirstTurn: true,
				autoError: false,
				cardId: 42,
			});

		mockLinearFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({
						data: {
							team: { labels: { nodes: [{ id: "label-bug", name: "Bug" }] } },
						},
					}),
			})
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ errors: [{}] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({
						data: {
							issueCreate: {
								success: true,
								issue: {
									id: "issue-9",
									url: "https://linear.app/cam/issue/CAM-9",
									identifier: "CAM-9",
								},
							},
						},
					}),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ data: { commentCreate: { success: true } } }),
			});

		const submitRes = await submitAndWaitForBackground(app, {
			title: "Fix login redirect",
			description: "Redirect loops on logout",
			type: "Bug",
			cardId: 42,
		});
		expect(submitRes.status).toBe(202);

		const historyRes = await request(app).get(
			"/api/workspaces/1/ticket-intake/history?cardId=42",
		);

		expect(historyRes.body.tickets).toHaveLength(1);
		expect(historyRes.body.tickets[0].issueUrl).toBe(
			"https://linear.app/cam/issue/CAM-9",
		);
		expect(cardEvents).toHaveLength(1);
		expect(cardEvents[0]).toMatchObject({
			event_type: "linear_ticket_created",
			card_id: 42,
			workspace_id: 1,
		});
	});

	it("writes no card_events row and keeps history empty when all retries fail", async () => {
		mockLinearFetch
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({
						data: {
							team: { labels: { nodes: [{ id: "label-bug", name: "Bug" }] } },
						},
					}),
			})
			.mockResolvedValue({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ errors: [{}] }),
			});

		const submitRes = await submitAndWaitForBackground(app, {
			title: "Fix login redirect",
			description: "Redirect loops on logout",
			type: "Bug",
			cardId: 43,
		});
		expect(submitRes.status).toBe(202);

		const historyRes = await request(app).get(
			"/api/workspaces/1/ticket-intake/history?cardId=43",
		);
		expect(historyRes.body.tickets).toEqual([]);
		expect(cardEvents).toHaveLength(0);
	});
});
