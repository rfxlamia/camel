import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DBExecutor } from "../../db/kysely.js";
import {
	createMyWorkDataSource,
	createMyWorkService,
	type MyWorkDataSource,
} from "./my-work.js";
import {
	expectOverdueItems,
	expectOverduePageShape,
	expectOverdueQueries,
	expectPrecisionCursors,
	expectPrecisionPages,
	expectPrecisionQueries,
} from "./my-work-pagination-assertions.js";
import {
	multiPageTrackerDb,
	overdueOtherRows,
	precisionRows,
	subMillisecondTrackerDb,
} from "./my-work-pagination-test-support.js";
import {
	decodeMyWorkCursor,
	type MyWorkListResponse,
} from "./my-work-response.js";
import {
	ALICE,
	capturedDb,
	hydrateRows,
	NOW,
	ORBIT,
	sourceDeps,
	trackerRow,
} from "./my-work-test-support.js";

vi.mock("../../db/kysely.js", () => ({ db: {} }));

type MyWorkPage = MyWorkListResponse;

function sqlBackedService(
	executor: DBExecutor,
	listTrackerRows: MyWorkDataSource["listTrackerRows"],
) {
	return createMyWorkService({
		executor,
		listAuthorizedWorkspaces: vi.fn(async () => [ORBIT]),
		listTrackerRows,
		listBoardRows: vi.fn(async () => []),
		hydrateRows,
	});
}

function deterministicPageRows() {
	return Array.from({ length: 5 }, (_, index) =>
		trackerRow({
			id: 120 + index,
			workspace_id: ORBIT.id,
			key_number: 20 + index,
			title: `Page item ${index}`,
			updated_at: new Date(
				`2026-09-${String(10 - index).padStart(2, "0")}T00:00:00.000Z`,
			),
		}),
	);
}

describe("My Work pagination and query boundary", () => {
	beforeEach(() => vi.clearAllMocks());

	it("RED 8: returns deterministic cursor pages without duplicates or gaps", async () => {
		const rows = deterministicPageRows();
		const service = createMyWorkService(
			sourceDeps({ tracker: rows, board: [] }),
		);
		const first = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 2,
			now: NOW,
		});
		const second = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 2,
			cursor: first.nextCursor,
			now: NOW,
		});
		const third = await service.list({
			userId: ALICE.id,
			scope: "all",
			limit: 2,
			cursor: second.nextCursor,
			now: NOW,
		});

		const ids = [...first.items, ...second.items, ...third.items].map(
			(item) => item.id,
		);
		expect(ids).toHaveLength(5);
		expect(new Set(ids).size).toBe(5);
		expect(third.nextCursor).toBeNull();
		expect(first.nextCursor).toBe(
			(
				await service.list({
					userId: ALICE.id,
					scope: "all",
					limit: 2,
					now: NOW,
				})
			).nextCursor,
		);
	});

	it("paginates overdue Other rows across bounded query and response pages", async () => {
		const rows = overdueOtherRows();
		const { executor, queries } = multiPageTrackerDb(rows);
		const source = createMyWorkDataSource(executor);
		const service = sqlBackedService(executor, source.listTrackerRows);

		const pages: MyWorkPage[] = [];
		let cursor: string | null = null;
		for (;;) {
			const page = await service.list({
				userId: ALICE.id,
				scope: "all",
				limit: 50,
				cursor,
				now: NOW,
			});
			pages.push(page);
			if (page.nextCursor === null) break;
			cursor = page.nextCursor;
			expect(pages.length).toBeLessThan(3);
		}

		expectOverduePageShape(pages);
		const firstCursor = decodeMyWorkCursor(pages[0]?.nextCursor ?? "");
		expect(firstCursor).toMatchObject({
			group: 4,
			overdue: true,
			dueDate: "2026-09-10",
			workspaceId: ORBIT.id,
			source: "tracker",
			key: "OR-47",
			keyNumber: 47,
			id: 4046,
		});
		expectOverdueItems(pages, rows);
		expectOverdueQueries(queries, firstCursor);
		await executor.destroy();
	});

	it("RED 8 query: captures deterministic cursor predicates and bounded limits", async () => {
		const { executor, queries } = capturedDb();
		const source = createMyWorkDataSource(executor);
		await source.listTrackerRows({
			userId: ALICE.id,
			workspaceIds: [ORBIT.id],
			scope: "all",
			q: "",
			limit: 2,
			cursor: {
				group: 1,
				overdue: false,
				dueDate: null,
				updatedAt: "2026-09-10T00:00:00.000Z",
				workspaceId: ORBIT.id,
				source: "tracker",
				key: "OR-4",
				id: 100,
			},
			workspaceLocalDates: new Map([[ORBIT.id, "2026-09-11"]]),
		});

		const query = queries.find((entry) =>
			entry.sql.includes('from "tracker_items"'),
		);
		expect(query).toBeDefined();
		expect(query?.sql).toContain('"ti"."updated_at"');
		expect(query?.sql).toContain('"ti"."id" asc');
		expect(query?.sql).toMatch(/limit \$\d+/i);
		expect(query?.parameters).toContain(3);
		expect(query?.parameters).toContain("2026-09-10T00:00:00.000Z");
		expect(query?.parameters).toContain(100);
		await executor.destroy();
	});

	it("normalizes SQL cursor timestamp precision across a sub-millisecond page boundary", async () => {
		const rows = precisionRows();
		const { executor, queries } = subMillisecondTrackerDb(rows);
		const source = createMyWorkDataSource(executor);
		const service = sqlBackedService(executor, source.listTrackerRows);

		const pages: MyWorkPage[] = [];
		let cursor: string | null = null;
		for (;;) {
			const page = await service.list({
				userId: ALICE.id,
				scope: "all",
				limit: 1,
				cursor,
				now: NOW,
			});
			pages.push(page);
			if (page.nextCursor === null) break;
			cursor = page.nextCursor;
			expect(pages.length).toBeLessThan(4);
		}

		expectPrecisionPages(pages, rows);
		expectPrecisionCursors(pages);
		expectPrecisionQueries(queries);
		await executor.destroy();
	});
});
