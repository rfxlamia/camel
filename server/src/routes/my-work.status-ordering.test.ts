import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMyWorkDataSource, createMyWorkService } from "./my-work.js";
import { decodeMyWorkCursor } from "./my-work-response.js";
import {
	ALICE,
	ATLAS,
	NOW,
	ORBIT,
	capturedDb,
	hydrateRows,
	sourceDeps,
} from "./my-work-test-support.js";
import {
	numericKeyRows,
	statusScopeRows,
	unknownCategoryRows,
} from "./my-work-status-test-support.js";
import { pagedTrackerDb } from "./my-work-pagination-test-support.js";

vi.mock("../db/kysely.js", () => ({ db: {} }));

describe("My Work status and ordering boundary", () => {
	beforeEach(() => vi.clearAllMocks());

	it("RED 4: filters terminal Active rows and keeps unknown categories as Other in All", async () => {
		const deps = sourceDeps({ tracker: statusScopeRows(), board: [] });
		const service = createMyWorkService(deps);

		const active = await service.list({
			userId: ALICE.id,
			scope: "active",
			now: NOW,
		});
		const all = await service.list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});

		expect(active.items.map((item) => item.id)).toEqual([105, 106, 109]);
		expect(all.items.map((item) => item.id)).toEqual(
			expect.arrayContaining([105, 106, 107, 108, 109]),
		);
		expect(
			all.items.find((item) => item.id === 109)?.statusCategory,
		).toBeNull();
	});

	it("keeps unknown non-null categories in Other despite terminal slots", async () => {
		const { started, unknownTerminal, nullTerminal } = unknownCategoryRows();
		const service = createMyWorkService(
			sourceDeps({
				tracker: [started, unknownTerminal, nullTerminal],
				board: [],
			}),
		);

		const active = await service.list({
			userId: ALICE.id,
			scope: "active",
			now: NOW,
		});
		const all = await service.list({
			userId: ALICE.id,
			scope: "all",
			now: NOW,
		});

		expect(active.items.map((item) => item.id)).toEqual([
			started.id,
			unknownTerminal.id,
		]);
		const activeUnknown = active.items.find(
			(item) => item.id === unknownTerminal.id,
		);
		expect(activeUnknown?.statusCategory).toBeNull();
		expect(activeUnknown?.status.category).toBe("mystery");
		expect(activeUnknown?.status.slot).toBe("done");

		expect(all.items.map((item) => item.id)).toEqual([
			started.id,
			nullTerminal.id,
			unknownTerminal.id,
		]);
		expect(
			all.items.find((item) => item.id === unknownTerminal.id)?.statusCategory,
		).toBeNull();
		expect(
			all.items.find((item) => item.id === nullTerminal.id)?.statusCategory,
		).toBe("completed");
	});

	it("keeps numeric key ordering across SQL, cursor, and response pages", async () => {
		const { keyTwo, keyTen } = numericKeyRows();
		const { executor, queries } = pagedTrackerDb([keyTwo, keyTen], [keyTen]);
		const source = createMyWorkDataSource(executor);
		const service = createMyWorkService({
			executor,
			listAuthorizedWorkspaces: vi.fn(async () => [ORBIT]),
			listTrackerRows: source.listTrackerRows,
			listBoardRows: vi.fn(async () => []),
			hydrateRows,
		});

		const first = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 1,
			now: NOW,
		});
		const second = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 1,
			cursor: first.nextCursor,
			now: NOW,
		});

		const keys = [...first.items, ...second.items].map((item) => item.key);
		expect(keys).toEqual(["OR-2", "OR-10"]);
		expect(new Set(keys).size).toBe(2);
		expect(first.nextCursor).not.toBeNull();
		expect(second.nextCursor).toBeNull();

		const trackerQueries = queries.filter((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(trackerQueries).toHaveLength(2);
		expect(trackerQueries[0]?.sql).toContain('"ti"."key_number" asc');
		expect(trackerQueries[1]?.sql).toContain('"ti"."key_number" =');
		expect(trackerQueries[1]?.parameters).toContain(2);
		await executor.destroy();
	});

	it("keeps unknown non-null categories active at the SQL boundary", async () => {
		const { executor, queries } = capturedDb();
		const source = createMyWorkDataSource(executor);
		await source.listTrackerRows({
			userId: ALICE.id,
			workspaceIds: [ORBIT.id],
			q: "",
			scope: "active",
			limit: 2,
			workspaceLocalDates: new Map([[ORBIT.id, "2026-09-11"]]),
		});

		const query = queries.find((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(query).toBeDefined();
		const sqlText = query?.sql ?? "";
		const fallbackGuard = sqlText.indexOf("st.category IS NULL");
		const slotFallback = sqlText.indexOf("st.slot IN");
		expect(fallbackGuard).toBeGreaterThanOrEqual(0);
		expect(slotFallback).toBeGreaterThan(fallbackGuard);
		expect(sqlText).toContain("st.category = 'completed'");
		expect(sqlText).toMatch(/CASE[\s\S]*st.category IS NULL[\s\S]*st.slot IN/);
		expect(sqlText).toMatch(/NOT IN \(2, 3\)/);
		await executor.destroy();
	});

	it("RED 6 query: captures canonical All-scope key predicates", async () => {
		const { executor, queries } = capturedDb();
		const source = createMyWorkDataSource(executor);
		await source.listTrackerRows({
			userId: ALICE.id,
			workspaceIds: [ATLAS.id, ORBIT.id],
			q: "AT-17",
			scope: "all",
			limit: 2,
			workspacePrefixes: new Map([
				[ATLAS.id, "AT"],
				[ORBIT.id, "OR"],
			]),
			workspaceLocalDates: new Map([
				[ATLAS.id, "2026-09-11"],
				[ORBIT.id, "2026-09-11"],
			]),
		});

		const query = queries.find((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(query).toBeDefined();
		expect(query?.sql).toContain('"ti"."key_number"');
		expect(query?.sql).toContain('"ti"."workspace_id"');
		expect(query?.parameters).toContain("%AT-17%");
		expect(query?.parameters).toContain(17);
		expect(query?.parameters).toContain(7);
		await executor.destroy();
	});

	it("RED 7 query: captures workspace/source filters at the DB boundary", async () => {
		const { executor, queries } = capturedDb();
		const service = createMyWorkService({
			executor,
			listAuthorizedWorkspaces: vi.fn(async () => [ATLAS, ORBIT]),
		});

		await service.list({
			userId: ALICE.id,
			scope: "all",
			workspaceId: ATLAS.id,
			source: "board",
			limit: 3,
			now: NOW,
		});

		const boardQuery = queries.find((entry) =>
			entry.sql.includes('from "cards"'),
		);
		expect(boardQuery).toBeDefined();
		expect(boardQuery?.sql).toContain('"c"."workspace_id" in');
		expect(boardQuery?.sql).toContain('"c"."workspace_id" =');
		expect(boardQuery?.sql).toContain('"c"."deleted_at" is null');
		expect(boardQuery?.sql).toContain('"card_assignees"');
		expect(boardQuery?.parameters).toContain(ATLAS.id);
		expect(boardQuery?.parameters).toContain(4);
		expect(
			queries.some((entry) => entry.sql.includes('from "tracker_items"')),
		).toBe(false);
		await executor.destroy();
	});
});
