import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { domainBus, EVENTS } from "../events.js";

vi.mock("../db/pool.js", () => ({
	pool: { query: vi.fn() },
}));

import { pool } from "../db/pool.js";
import { initNotificationService } from "./service.js";

const mockQuery = vi.mocked(pool.query);

describe("initNotificationService — card:assigned", () => {
	let cleanup: (() => void) | undefined;

	beforeEach(() => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
		cleanup = initNotificationService();
	});

	afterEach(() => {
		cleanup?.();
		vi.clearAllMocks();
	});

	it("inserts notification when actor != assignee", async () => {
		domainBus.emit(EVENTS.CARD_ASSIGNED, {
			type: EVENTS.CARD_ASSIGNED,
			workspaceId: 1,
			actorId: 7,
			payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix login bug" },
		});
		await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
		const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
		expect(sql).toContain("INSERT INTO notifications");
		expect(params).toContain(3); // user_id = assigneeId
		expect(params).toContain("card_assigned");
	});

	it("skips notification when actor === assignee (self-assign)", async () => {
		domainBus.emit(EVENTS.CARD_ASSIGNED, {
			type: EVENTS.CARD_ASSIGNED,
			workspaceId: 1,
			actorId: 3,
			payload: { cardId: 10, assigneeId: 3, cardTitle: "Fix login bug" },
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it("skips notification when assigneeId is null (unassigned)", async () => {
		domainBus.emit(EVENTS.CARD_ASSIGNED, {
			type: EVENTS.CARD_ASSIGNED,
			workspaceId: 1,
			actorId: 7,
			payload: { cardId: 10, assigneeId: null, cardTitle: "Fix login bug" },
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(mockQuery).not.toHaveBeenCalled();
	});
});

describe("initNotificationService — card:dueDateChanged", () => {
	let cleanup: (() => void) | undefined;

	beforeEach(() => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
		cleanup = initNotificationService();
	});

	afterEach(() => {
		cleanup?.();
		vi.clearAllMocks();
	});

	it("inserts notification when actor != assignee", async () => {
		domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
			type: EVENTS.CARD_DUE_DATE_CHANGED,
			workspaceId: 1,
			actorId: 7,
			payload: {
				cardId: 10,
				assigneeId: 3,
				cardTitle: "Fix login bug",
				oldDueDate: null,
				newDueDate: "2026-07-01",
			},
		});
		await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
		const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
		expect(sql).toContain("INSERT INTO notifications");
	});

	it("skips notification when actor === assignee", async () => {
		domainBus.emit(EVENTS.CARD_DUE_DATE_CHANGED, {
			type: EVENTS.CARD_DUE_DATE_CHANGED,
			workspaceId: 1,
			actorId: 3,
			payload: {
				cardId: 10,
				assigneeId: 3,
				cardTitle: "Fix login bug",
				oldDueDate: "2026-06-30",
				newDueDate: "2026-07-01",
			},
		});
		await new Promise((r) => setTimeout(r, 10));
		expect(mockQuery).not.toHaveBeenCalled();
	});
});

describe("initNotificationService — member:joined", () => {
	let cleanup: (() => void) | undefined;

	beforeEach(() => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
		cleanup = initNotificationService();
	});

	afterEach(() => {
		cleanup?.();
		vi.clearAllMocks();
	});

	it("inserts welcome notification for new member", async () => {
		domainBus.emit(EVENTS.MEMBER_JOINED, {
			type: EVENTS.MEMBER_JOINED,
			workspaceId: 1,
			actorId: 99,
			payload: {
				newMemberId: 5,
				newMemberDisplayName: "Charlie",
				workspaceName: "Team Alpha",
				existingMemberIds: [1, 2],
			},
		});
		await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
		const allCalls = mockQuery.mock.calls.map(([sql]: [string]) => sql);
		expect(allCalls.some((s) => s.includes("INSERT INTO notifications"))).toBe(
			true,
		);
	});
});

describe("initNotificationService — card:deleted (source_deleted)", () => {
	let cleanup: (() => void) | undefined;

	beforeEach(() => {
		mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as never);
		cleanup = initNotificationService();
	});

	afterEach(() => {
		cleanup?.();
		vi.clearAllMocks();
	});

	it("sets source_deleted=true on notifications when card is deleted", async () => {
		domainBus.emit(EVENTS.CARD_DELETED, {
			type: EVENTS.CARD_DELETED,
			workspaceId: 1,
			actorId: 7,
			payload: { cardId: 10 },
		});
		await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled());
		const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
		expect(sql).toContain("UPDATE notifications");
		expect(sql).toContain("source_deleted = true");
		expect(params).toContain(10); // cardId
	});
});

describe("initNotificationService — system:alert", () => {
	let cleanup: (() => void) | undefined;

	beforeEach(() => {
		// First query: fetch all workspace member IDs
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ user_id: 1 }, { user_id: 2 }],
				rowCount: 2,
			} as never)
			// Subsequent inserts
			.mockResolvedValue({ rows: [], rowCount: 0 } as never);
		cleanup = initNotificationService();
	});

	afterEach(() => {
		cleanup?.();
		vi.clearAllMocks();
	});

	it("inserts system_alert notification for all workspace members", async () => {
		domainBus.emit(EVENTS.SYSTEM_ALERT, {
			type: EVENTS.SYSTEM_ALERT,
			workspaceId: 1,
			actorId: 99,
			payload: { title: "Maintenance at midnight", body: "Server restart at 00:00 UTC" },
		});
		await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(3)); // 1 SELECT + 2 INSERTs
		const [selectSql] = mockQuery.mock.calls[0] as [string];
		expect(selectSql).toContain("workspace_members");
		const insertCalls = mockQuery.mock.calls.slice(1).map(([sql]: [string]) => sql);
		expect(insertCalls.every((s) => s.includes("INSERT INTO notifications"))).toBe(
			true,
		);
	});
});
