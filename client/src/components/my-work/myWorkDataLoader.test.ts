import { describe, expect, it } from "vitest";
import { sourceItem } from "../../lib/myWorkTestSupport";
import type { MyWorkViewState } from "../../lib/myWorkUtils";
import {
	activeLoadedPage,
	myWorkLoadIdentity,
	myWorkRequestKey,
} from "./myWorkDataLoader";

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
