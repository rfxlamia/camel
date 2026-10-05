import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyWorkListResponse } from "../../shared/myWorkTypes";

const { mockListMyWork, mockListActive } = vi.hoisted(() => ({
	mockListMyWork: vi.fn(),
	mockListActive: vi.fn(),
}));

vi.mock("../../api", () => ({
	api: {
		listMyWork: (...args: unknown[]) => mockListMyWork(...args),
		listActiveMyWorkCandidates: (...args: unknown[]) => mockListActive(...args),
	},
}));

import {
	type AllPageCache,
	activeLoadedPage,
	loadMyWorkRequest,
	myWorkLoadIdentity,
	myWorkRequestKey,
} from "./myWorkDataLoader";
import { sourceItem } from "./myWorkTestSupport";
import type { MyWorkViewState } from "./myWorkUtils";

function view(overrides: Partial<MyWorkViewState> = {}): MyWorkViewState {
	return {
		scope: "active",
		workspaceId: "",
		source: "",
		q: "",
		page: 1,
		...overrides,
	};
}

describe("myWorkRequestKey", () => {
	it("omits Active search query so query-only changes share a request", () => {
		expect(myWorkRequestKey(view({ q: "alpha" }))).toBe(
			myWorkRequestKey(view({ q: "beta" })),
		);
		expect(myWorkRequestKey(view({ q: "alpha" }))).toBe("active||");
	});

	it("includes All search query in the request key", () => {
		expect(myWorkRequestKey(view({ scope: "all", q: "alpha" }))).not.toBe(
			myWorkRequestKey(view({ scope: "all", q: "beta" })),
		);
		expect(myWorkRequestKey(view({ scope: "all", q: "alpha" }))).toBe(
			"all|alpha||",
		);
	});

	it("includes workspace and source in both scopes", () => {
		expect(myWorkRequestKey(view({ workspaceId: 7, source: "board" }))).toBe(
			"active|7|board",
		);
		expect(
			myWorkRequestKey(
				view({ scope: "all", workspaceId: 7, source: "board", q: "x" }),
			),
		).toBe("all|x|7|board");
	});
});

describe("myWorkLoadIdentity", () => {
	it("ignores Active page so paging stays client-side", () => {
		expect(myWorkLoadIdentity(view({ page: 1, q: "atlas" }))).toBe(
			myWorkLoadIdentity(view({ page: 2, q: "atlas" })),
		);
	});

	it("includes All page so a page change is a new request", () => {
		expect(myWorkLoadIdentity(view({ scope: "all", page: 1 }))).not.toBe(
			myWorkLoadIdentity(view({ scope: "all", page: 2 })),
		);
	});
});

describe("activeLoadedPage", () => {
	it("filters then paginates and keeps the incomplete-candidate flag", () => {
		const alpha = sourceItem(1, "board", "AT-1", { title: "Alpha task" });
		const beta = sourceItem(2, "board", "AT-2", { title: "Beta task" });
		const loaded = activeLoadedPage([alpha, beta], view({ q: "alpha" }), true);
		expect(loaded.items.map((entry) => entry.key)).toEqual(["AT-1"]);
		expect(loaded.candidateSetIncomplete).toBe(true);
		expect(loaded.total).toBe(1);
	});

	it("returns the full candidate set when the query is empty", () => {
		const items = [
			sourceItem(1, "board", "AT-1", { title: "Alpha task" }),
			sourceItem(2, "board", "AT-2", { title: "Beta task" }),
		];
		const loaded = activeLoadedPage(items, view(), true);
		expect(loaded.items.map((entry) => entry.key)).toEqual(["AT-1", "AT-2"]);
		expect(loaded.candidateSetIncomplete).toBe(true);
	});
});

describe("loadMyWorkRequest (All scope cursor pagination)", () => {
	const page1: MyWorkListResponse = {
		items: [sourceItem(1, "board", "AT-1")],
		nextCursor: "c1",
	};
	const page2: MyWorkListResponse = {
		items: [sourceItem(2, "board", "AT-2")],
		nextCursor: "c2",
	};
	const last: MyWorkListResponse = {
		items: [sourceItem(3, "board", "AT-3")],
		nextCursor: null,
	};

	function load(
		viewOverrides: Partial<MyWorkViewState>,
		options: {
			cache?: { current: AllPageCache };
			fresh?: boolean;
			isCurrent?: () => boolean;
		} = {},
	) {
		const requestView = view({ scope: "all", ...viewOverrides });
		const allCacheRef = options.cache ?? {
			current: { key: "", pages: new Map() },
		};
		return {
			allCacheRef,
			result: loadMyWorkRequest({
				requestView,
				requestViewKey: myWorkRequestKey(requestView),
				fresh: options.fresh ?? false,
				currentPage: () => requestView.page,
				allCacheRef,
				isCurrent: options.isCurrent ?? (() => true),
			}),
		};
	}

	beforeEach(() => {
		mockListMyWork.mockReset();
		mockListActive.mockReset();
	});

	it("requests page 1 without a cursor and derives paging from nextCursor", async () => {
		mockListMyWork.mockResolvedValueOnce(page1);
		const prepared = await load({ page: 1 }).result;
		expect(mockListMyWork).toHaveBeenCalledTimes(1);
		expect(mockListMyWork.mock.calls[0]?.[0]).not.toHaveProperty("cursor");
		expect(prepared?.loaded).toMatchObject({
			page: 1,
			pageCount: 2,
			hasPrevious: false,
			hasNext: true,
		});
	});

	it("walks nextCursor from earlier pages to reach the requested page", async () => {
		mockListMyWork
			.mockResolvedValueOnce(page1)
			.mockResolvedValueOnce(page2)
			.mockResolvedValueOnce(last);
		const prepared = await load({ page: 3 }).result;
		expect(mockListMyWork.mock.calls.map((call) => call[0].cursor)).toEqual([
			undefined,
			"c1",
			"c2",
		]);
		expect(prepared?.loaded.items.map((entry) => entry.key)).toEqual(["AT-3"]);
		expect(prepared?.loaded).toMatchObject({
			page: 3,
			pageCount: 3,
			hasPrevious: true,
			hasNext: false,
		});
	});

	it("stops at the last page when the requested page is past the end", async () => {
		mockListMyWork.mockResolvedValueOnce({ ...page1, nextCursor: null });
		const prepared = await load({ page: 4 }).result;
		expect(mockListMyWork).toHaveBeenCalledTimes(1);
		expect(prepared?.loaded.page).toBe(1);
		expect(prepared?.loaded.hasNext).toBe(false);
	});

	it("reuses cached pages for the same key and refetches on fresh", async () => {
		mockListMyWork.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
		const first = load({ page: 2 });
		await first.result;
		expect(mockListMyWork).toHaveBeenCalledTimes(2);

		await load({ page: 2 }, { cache: first.allCacheRef }).result;
		expect(mockListMyWork).toHaveBeenCalledTimes(2);

		mockListMyWork.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
		await load({ page: 2 }, { cache: first.allCacheRef, fresh: true }).result;
		expect(mockListMyWork).toHaveBeenCalledTimes(4);
	});

	it("drops the cache when the request key changes", async () => {
		mockListMyWork.mockResolvedValue(last);
		const first = load({ page: 1, q: "alpha" });
		await first.result;
		await load({ page: 1, q: "beta" }, { cache: first.allCacheRef }).result;
		expect(mockListMyWork).toHaveBeenCalledTimes(2);
	});

	it("forwards workspace, source and trimmed query to the server", async () => {
		mockListMyWork.mockResolvedValueOnce(last);
		await load({ workspaceId: 7, source: "board", q: "  atlas " }).result;
		expect(mockListMyWork).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: "all",
				workspaceId: 7,
				source: "board",
				q: "atlas",
			}),
		);
	});

	it("returns null when the request is superseded mid-flight", async () => {
		mockListMyWork.mockResolvedValueOnce(page1);
		let current = true;
		const { result } = load({ page: 2 }, { isCurrent: () => current });
		current = false;
		expect(await result).toBeNull();
		expect(mockListMyWork).toHaveBeenCalledTimes(1);
	});

	it("trusts server-side filtering instead of re-filtering rows client-side", async () => {
		const other = sourceItem(9, "tracker", "OR-9", { workspaceId: 12 });
		mockListMyWork.mockResolvedValueOnce({ items: [other], nextCursor: null });
		const prepared = await load({ workspaceId: 7, source: "board" }).result;
		expect(prepared?.loaded.items.map((entry) => entry.key)).toEqual(["OR-9"]);
	});
});
