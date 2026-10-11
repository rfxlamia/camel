import { describe, expect, it, vi } from "vitest";
import type { DBExecutor } from "../../db/kysely.js";
import { recoverInterruptedAgentBoards } from "./startup-recovery.js";

describe("recoverInterruptedAgentBoards", () => {
	it("marks only running boards failed and returns recovered board/workspace IDs", async () => {
		const execute = vi.fn().mockResolvedValue([{ id: 17, workspace_id: 4 }]);
		const returning = vi.fn(() => ({ execute }));
		const where = vi.fn(() => ({ returning }));
		const set = vi.fn(() => ({ where }));
		const updateTable = vi.fn(() => ({ set }));
		const dbExecutor = { updateTable } as unknown as DBExecutor;

		await expect(recoverInterruptedAgentBoards(dbExecutor)).resolves.toEqual([
			{ boardId: 17, workspaceId: 4 },
		]);
		expect(updateTable).toHaveBeenCalledWith("agent_boards");
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({ execution_status: "failed" }),
		);
		const updatedColumns = Object.keys(set.mock.calls[0][0] as object);
		expect(updatedColumns).toEqual(["execution_status", "updated_at"]);
		expect(where).toHaveBeenCalledWith("execution_status", "=", "running");
		expect(returning).toHaveBeenCalledWith(["id", "workspace_id"]);
	});

	it("returns an empty list when there are no interrupted boards", async () => {
		const execute = vi.fn().mockResolvedValue([]);
		const returning = vi.fn(() => ({ execute }));
		const where = vi.fn(() => ({ returning }));
		const set = vi.fn(() => ({ where }));
		const updateTable = vi.fn(() => ({ set }));

		await expect(
			recoverInterruptedAgentBoards({ updateTable } as unknown as DBExecutor),
		).resolves.toEqual([]);
	});
});
