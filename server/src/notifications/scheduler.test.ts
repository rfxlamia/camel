import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../db/pool.js", () => ({ pool: { query: vi.fn() } }));

import { pool } from "../db/pool.js";
import { runDueDateReminders } from "./scheduler.js";

const mockQuery = vi.mocked(pool.query);

describe("runDueDateReminders", () => {
	beforeEach(() => vi.clearAllMocks());

	it("inserts reminder for card due today in workspace timezone", async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [
				{ card_id: 10, assignee_id: 3, card_title: "Fix bug", workspace_id: 1 },
			],
			rowCount: 1,
		} as never);
		mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

		await runDueDateReminders();

		expect(mockQuery).toHaveBeenCalledTimes(2);
		const [selectSql] = mockQuery.mock.calls[0] as [string];
		expect(selectSql).toContain("COALESCE(ws.timezone, 'UTC')");
		const [insertSql, insertParams] = mockQuery.mock.calls[1] as [
			string,
			unknown[],
		];
		expect(insertSql).toContain("INSERT INTO notifications");
		expect(insertSql).toContain("due_date_reminder");
		expect(insertParams).toContain(3);
	});

	it("skips cards in done columns", async () => {
		mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
		await runDueDateReminders();
		expect(mockQuery).toHaveBeenCalledTimes(1);
		const [selectSql] = mockQuery.mock.calls[0] as [string];
		expect(selectSql).toContain("is_done = FALSE");
	});

	it("is idempotent — second run does not throw when partial index conflict fires", async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [
					{ card_id: 10, assignee_id: 3, card_title: "Fix bug", workspace_id: 1 },
				],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 1 } as never);

		await runDueDateReminders();

		mockQuery
			.mockResolvedValueOnce({
				rows: [
					{ card_id: 10, assignee_id: 3, card_title: "Fix bug", workspace_id: 1 },
				],
				rowCount: 1,
			} as never)
			.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

		await runDueDateReminders();

		expect(mockQuery).toHaveBeenCalledTimes(4);
		const insertCalls = mockQuery.mock.calls.filter(([sql]: [string]) =>
			sql.includes("INSERT INTO notifications"),
		);
		expect(insertCalls).toHaveLength(2);
		expect((insertCalls[0] as [string])[0]).toContain(
			"WHERE type = 'due_date_reminder' DO NOTHING",
		);
	});
});
