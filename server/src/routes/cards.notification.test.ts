import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { domainBus, EVENTS } from "../events.js";

const { mockClientQuery, mockConnect } = vi.hoisted(() => {
	const mockClientQuery = vi.fn();
	const mockConnect = vi.fn().mockResolvedValue({
		query: mockClientQuery,
		release: vi.fn(),
	});
	return { mockClientQuery, mockConnect };
});

vi.mock("../db/pool.js", () => ({
	pool: {
		query: vi.fn(),
		connect: mockConnect,
	},
}));
vi.mock("../realtime.js", () => ({ publishEvent: vi.fn() }));
vi.mock("./helpers.js", () => ({
	lookupMembership: vi.fn().mockResolvedValue("member"),
	parseWorkspaceId: vi.fn((id: string) => Number(id)),
	recordActivity: vi.fn().mockResolvedValue(undefined),
	createScopedBoardService: vi.fn(),
}));
vi.mock("./card-assignees.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./card-assignees.js")>();
	return {
		...actual,
		loadCardAssigneesForCards: vi.fn().mockResolvedValue(
			new Map([
				[
					10,
					[
						{
							id: 3,
							username: "alice",
							displayName: "Alice",
						},
					],
				],
			]),
		),
		getCardAssigneeIds: vi.fn(),
		syncCardAssignees: vi.fn(),
		addCardAssignee: vi.fn(),
	};
});
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
import {
	addCardAssignee,
	getCardAssigneeIds,
	syncCardAssignees,
} from "./card-assignees.js";
import { cardsRouter } from "./cards.js";

const mockQuery = vi.mocked(pool.query);
const mockGetCardAssigneeIds = vi.mocked(getCardAssigneeIds);
const mockSyncCardAssignees = vi.mocked(syncCardAssignees);
const mockAddCardAssignee = vi.mocked(addCardAssignee);

const cardRow = {
	id: 10,
	workspace_id: 1,
	column_id: 1,
	title: "Fix bug",
	description: "",
	position: 1024,
	version: 2,
	created_at: "2026-06-01T00:00:00Z",
	started_at: null,
	done_at: null,
	due_date: null as string | null,
};

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
	beforeEach(() => {
		mockQuery.mockReset();
		mockClientQuery.mockReset();
		mockGetCardAssigneeIds.mockReset();
		mockSyncCardAssignees.mockReset();
		mockAddCardAssignee.mockReset();
		mockConnect.mockReset();
		mockConnect.mockResolvedValue({
			query: mockClientQuery,
			release: vi.fn(),
		} as never);
	});

	it("emits CARD_ASSIGNED when card is PATCHed with a new assignee", async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
			.mockResolvedValueOnce({
				rows: [{ due_date: null }],
				rowCount: 1,
			} as never);
		mockGetCardAssigneeIds.mockResolvedValueOnce([]);
		mockClientQuery.mockResolvedValueOnce({
			rows: [cardRow],
			rowCount: 1,
		} as never);
		mockSyncCardAssignees.mockResolvedValueOnce({
			prev: [],
			added: [3],
			removed: [],
		});
		mockClientQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // recordActivity
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT

		const received: unknown[] = [];
		domainBus.once(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

		await request(app)
			.patch("/workspaces/1/cards/10")
			.send({ assigneeIds: [3], version: 1 });

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
		mockClientQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({
				rows: [{ due_date: null }],
				rowCount: 1,
			} as never);
		mockGetCardAssigneeIds.mockResolvedValueOnce([3]);
		mockClientQuery.mockResolvedValueOnce({
			rows: [cardRow],
			rowCount: 1,
		} as never);
		mockSyncCardAssignees.mockResolvedValueOnce({
			prev: [3],
			added: [],
			removed: [],
		});
		mockClientQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		const received: unknown[] = [];
		domainBus.on(EVENTS.CARD_ASSIGNED, (e) => received.push(e));

		await request(app)
			.patch("/workspaces/1/cards/10")
			.send({ assigneeIds: [3], version: 1 });

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
			.mockResolvedValueOnce({ rows: [{ n: 0 }], rowCount: 1 } as never);
		mockClientQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
			.mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 } as never); // INSERT
		mockAddCardAssignee.mockResolvedValueOnce(true);
		mockClientQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // recordActivity
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // COMMIT
		mockQuery.mockResolvedValueOnce({
			rows: [{ ...cardRow, version: 1 }],
			rowCount: 1,
		} as never);

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
	beforeEach(() => {
		mockQuery.mockReset();
	});

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
	beforeEach(() => {
		mockQuery.mockReset();
		mockClientQuery.mockReset();
		mockGetCardAssigneeIds.mockReset();
		mockSyncCardAssignees.mockReset();
		mockConnect.mockReset();
		mockConnect.mockResolvedValue({
			query: mockClientQuery,
			release: vi.fn(),
		} as never);
	});

	it("emits CARD_DUE_DATE_CHANGED when due_date is PATCHed on assigned card", async () => {
		mockClientQuery
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({
				rows: [{ due_date: null }],
				rowCount: 1,
			} as never);
		mockGetCardAssigneeIds.mockResolvedValueOnce([3]);
		mockClientQuery
			.mockResolvedValueOnce({
				rows: [{ ...cardRow, due_date: "2026-07-01" }],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

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
