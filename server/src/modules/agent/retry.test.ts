import { describe, expect, it, vi } from "vitest";
import { validateRetryColumns } from "./retry-db.js";
import { createAgentBoardService } from "./service.js";

const column = {
	slug: "research",
	system_prompt: "Research",
	position: 0.5,
	tool_budget: null,
};
describe("retry configuration", () => {
	it("accepts null/default budgets and fractional ordering", () => {
		expect(() =>
			validateRetryColumns([
				column,
				{ ...column, slug: "write", position: 1.2, tool_budget: 0 },
			]),
		).not.toThrow();
	});
	it.each([
		[],
		[{ ...column, slug: " " }],
		[{ ...column, system_prompt: null }],
		[{ ...column, position: Number.NaN }],
		[{ ...column, position: Infinity }],
		[column, column],
		[column, { ...column, slug: "other", position: 0.1 }],
		[{ ...column, tool_budget: -1 }],
	])("rejects invalid configuration %#", (columns) => {
		expect(() => validateRetryColumns(columns)).toThrow();
	});
});
describe("retry launch failure", () => {
	it.each([
		true,
		false,
	])("emits terminal failure only on running transition (%s)", async (transitioned) => {
		const failRunningBoard = vi.fn(async () => transitioned);
		const publishEvent = vi.fn(async () => {});
		const service = createAgentBoardService({ failRunningBoard, publishEvent });
		await service.handleRetryLaunchFailure({ boardId: 42, workspaceId: 1 });
		expect(failRunningBoard).toHaveBeenCalledWith(42, 1);
		expect(publishEvent).toHaveBeenCalledTimes(transitioned ? 1 : 0);
		if (transitioned)
			expect(publishEvent).toHaveBeenCalledWith(1, {
				type: "agent.board.failed",
				boardId: 42,
			});
	});
});
