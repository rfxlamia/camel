import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { domainBus, EVENTS } from "../events.js";

vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));
vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
vi.mock("./helpers.js", () => ({
	lookupMembership: vi.fn().mockResolvedValue("member"),
	parseWorkspaceId: vi.fn((id: string) => Number(id)),
	recordActivity: vi.fn().mockResolvedValue(undefined),
	createScopedBoardService: vi.fn(),
}));
vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: (_req: unknown, _res: unknown, next: () => void) =>
		next(),
}));
vi.mock("../validators/input-length.js", () => ({
	validateCardTitle: vi
		.fn()
		.mockReturnValue({ valid: true, trimmed: "Fix bug" }),
	validateCardDescription: vi
		.fn()
		.mockReturnValue({ valid: true, trimmed: "" }),
	validateDueDate: vi
		.fn()
		.mockReturnValue({ valid: true, trimmed: "2026-07-01" }),
}));

import { pool } from "../db/pool.js";
import { cardsRouter } from "./cards.js";

const mockQuery = vi.mocked(pool.query);

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
	(req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
	(req as Record<string, unknown>).workspace = {
		workspaceId: Number(
			(req.params as { workspaceId?: string }).workspaceId ?? 1,
		),
		role: "owner",
	};
	next();
});
app.use("/workspaces/:workspaceId", cardsRouter);

afterEach(() => {
	domainBus.removeAllListeners();
});

describe("cards route — CARD_ASSIGNED event emission", () => {
	beforeEach(() => vi.clearAllMocks());

	it("emits CARD_ASSIGNED when card is PATCHed with a new assignee", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ assignee_id: null, due_date: null }],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({
				rows: [
					{
						id: 10,
						workspace_id: 1,
						column_id: 1,
						title: "Fix bug",
						description: "",
						position: 1024,
						version: 2,
						assignee_id: 3,
						due_date: null,
					},
				],
				rowCount: 1,
			} as never)
			.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		const received: unknown[] = [];
		domainBus.once(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

		await request(app)
			.patch("/workspaces/1/cards/10")
			.send({ assigneeId: 3, version: 1 });

		expect(received).toHaveLength(1);
		expect(
			(received[0] as { payload: { assigneeId: number } }).payload.assigneeId,
		).toBe(3);
		expect(
			(received[0] as { payload: { actorDisplayName: string } }).payload
				.actorDisplayName,
		).toBe("Bob");
	});

	it("does NOT emit CARD_ASSIGNED when assignee is unchanged", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ assignee_id: 3, due_date: null }],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({
				rows: [
					{
						id: 10,
						column_id: 1,
						title: "Fix bug",
						description: "",
						position: 1024,
						version: 2,
						assignee_id: 3,
						due_date: null,
					},
				],
				rowCount: 1,
			} as never)
			.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		const received: unknown[] = [];
		domainBus.on(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

		await request(app)
			.patch("/workspaces/1/cards/10")
			.send({ assigneeId: 3, version: 1 });

		expect(received).toHaveLength(0);
	});

	it("emits CARD_ASSIGNED when card is created with an assignee", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						wip_limit: null,
						is_signable: true,
						signable_assignee_id: 3,
					},
				],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({ rows: [{ n: 0 }], rowCount: 1 } as never)
			.mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 } as never)
			.mockResolvedValueOnce({
				rows: [
					{
						id: 10,
						column_id: 1,
						title: "Fix bug",
						description: "",
						position: 1024,
						version: 1,
						created_at: "2026-06-01T00:00:00Z",
						started_at: null,
						done_at: null,
						assignee_id: 3,
						assignee_username: "alice",
						assignee_display_name: "Alice",
					},
				],
				rowCount: 1,
			} as never)
			.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		const received: unknown[] = [];
		domainBus.once(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

		await request(app)
			.post("/workspaces/1/cards")
			.send({ columnId: 1, title: "Fix bug" });

		expect(received).toHaveLength(1);
		expect(
			(received[0] as { payload: { assigneeId: number } }).payload.assigneeId,
		).toBe(3);
	});
});

describe("cards route — CARD_DELETED event emission", () => {
	beforeEach(() => vi.clearAllMocks());

	it("emits CARD_DELETED when card is soft-deleted", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ title: "Fix bug", column_id: 1 }],
				rowCount: 1,
			} as never)
			.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		const received: unknown[] = [];
		domainBus.once(EVENTS.CARD_DELETED, (e) => received.push(e));

		await request(app).delete("/workspaces/1/cards/10");

		expect(received).toHaveLength(1);
		expect((received[0] as { payload: { cardId: number } }).payload.cardId).toBe(
			10,
		);
	});
});

describe("cards route — CARD_DUE_DATE_CHANGED event emission", () => {
	beforeEach(() => vi.clearAllMocks());

	it("emits CARD_DUE_DATE_CHANGED when due_date is PATCHed on assigned card", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ assignee_id: 3, due_date: null }],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({
				rows: [
					{
						id: 10,
						column_id: 1,
						title: "Fix bug",
						description: "",
						position: 1024,
						version: 2,
						assignee_id: 3,
						due_date: "2026-07-01",
					},
				],
				rowCount: 1,
			} as never)
			.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		const received: unknown[] = [];
		domainBus.once(EVENTS.CARD_DUE_DATE_CHANGED, (e) => received.push(e));

		await request(app)
			.patch("/workspaces/1/cards/10")
			.send({ dueDate: "2026-07-01", version: 1 });

		expect(received).toHaveLength(1);
		expect(
			(received[0] as { payload: { newDueDate: string } }).payload.newDueDate,
		).toBe("2026-07-01");
	});
});
