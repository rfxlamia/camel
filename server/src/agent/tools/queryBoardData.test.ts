import { describe, expect, it, vi } from "vitest";
import type { CardTimestamps } from "../../core/metrics.js";
import { makeQueryBoardData } from "./queryBoardData.js";

// Fixed clock so windowed metrics + weekly buckets are deterministic.
const NOW = new Date("2026-06-20T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

// One completed card (done 1 day ago) → throughput>0 under any default window.
const doneCards: CardTimestamps[] = [
	{
		createdAt: new Date(NOW.getTime() - 3 * DAY),
		startedAt: new Date(NOW.getTime() - 2 * DAY),
		doneAt: new Date(NOW.getTime() - 1 * DAY),
	},
];

function buildCtx(overrides: Record<string, unknown> = {}) {
	const fetchCardTimestamps = vi.fn(async (_wid: number) => doneCards);
	const fetchActivityEvents = vi.fn(
		async (_wid: number, _limit: number) =>
			[{ id: 1, type: "card.moved" }] as Record<string, unknown>[],
	);
	const ctx = {
		workspaceId: 7,
		fetchCardTimestamps,
		fetchActivityEvents,
		now: NOW,
		...overrides,
	};
	return { ctx, fetchCardTimestamps, fetchActivityEvents };
}

describe("query_board_data tool factory", () => {
	it("has read-only shape with no workspace/board id field in the schema", () => {
		const { ctx } = buildCtx();
		const tool = makeQueryBoardData(ctx as never);
		expect(tool.name).toBe("query_board_data");
		expect(tool.riskTier).toBe("read-only");
		expect(tool.inputSchema.type).toBe("object");
		const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
		expect(props).not.toHaveProperty("workspaceId");
		expect(props).not.toHaveProperty("boardId");
	});

	it("metrics+history selection returns flow metrics + 8 weekly buckets", async () => {
		const { ctx } = buildCtx();
		const tool = makeQueryBoardData(ctx as never);
		const result = await tool.execute({ data_types: ["metrics", "history"] });

		expect(result.ok).toBe(true);
		const payload = JSON.parse(result.content);
		expect(payload.metrics).toMatchObject({
			throughput: expect.any(Number),
			wipCount: expect.any(Number),
		});
		expect(payload.metrics).toHaveProperty("avgLeadTimeMs");
		expect(payload.metrics).toHaveProperty("avgCycleTimeMs");
		expect(payload.history).toHaveLength(8);
		// Section not requested must be absent.
		expect(payload.activity).toBeUndefined();
	});

	it("omitted data_types returns all three sections", async () => {
		const { ctx } = buildCtx();
		const tool = makeQueryBoardData(ctx as never);
		const payload = JSON.parse((await tool.execute({})).content);
		expect(payload).toHaveProperty("metrics");
		expect(payload).toHaveProperty("history");
		expect(payload).toHaveProperty("activity");
	});

	it("ignores any id-like arg and fetches only with ctx.workspaceId", async () => {
		const { ctx, fetchCardTimestamps } = buildCtx();
		const tool = makeQueryBoardData(ctx as never);
		await tool.execute({
			data_types: ["metrics"],
			workspaceId: 99,
			boardId: 99,
		});
		expect(fetchCardTimestamps).toHaveBeenCalledWith(7);
		expect(fetchCardTimestamps).not.toHaveBeenCalledWith(99);
	});

	it("empty workspace → ok:true, completedCount:0, hasData:false, null averages, activity:[]", async () => {
		const { ctx } = buildCtx({
			fetchCardTimestamps: vi.fn(async () => [] as CardTimestamps[]),
			fetchActivityEvents: vi.fn(async () => [] as Record<string, unknown>[]),
		});
		const tool = makeQueryBoardData(ctx as never);
		const result = await tool.execute({ data_types: ["metrics", "activity"] });

		expect(result.ok).toBe(true);
		const payload = JSON.parse(result.content);
		expect(payload.metrics.completedCount).toBe(0);
		expect(payload.metrics.hasData).toBe(false);
		// null must survive JSON.stringify (distinguishable from 0).
		expect(payload.metrics.avgLeadTimeMs).toBeNull();
		expect(payload.metrics.avgCycleTimeMs).toBeNull();
		expect(payload.activity).toEqual([]);
	});

	it("clamps weeks=500 to 26 buckets and returns ok:true", async () => {
		const { ctx } = buildCtx();
		const tool = makeQueryBoardData(ctx as never);
		const result = await tool.execute({ data_types: ["history"], weeks: 500 });
		expect(result.ok).toBe(true);
		expect(JSON.parse(result.content).history).toHaveLength(26);
	});

	it("injected fetcher throws → ok:false, errorCode:DB_ERROR", async () => {
		const { ctx } = buildCtx({
			fetchCardTimestamps: vi.fn(async () => {
				throw new Error("connection refused");
			}),
		});
		const tool = makeQueryBoardData(ctx as never);
		const result = await tool.execute({ data_types: ["metrics"] });
		expect(result).toMatchObject({ ok: false, errorCode: "DB_ERROR" });
	});
});
