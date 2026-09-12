import { describe, expect, it } from "vitest";
import {
	deriveMyWorkGroups,
	filterMyWorkItems,
	normalizeMyWorkStatus,
	paginateMyWorkItems,
	parseMyWorkViewState,
	serializeMyWorkViewState,
} from "./myWorkUtils";
import { item } from "./myWorkTestSupport";

describe("My Work status normalization and filtering", () => {
	it("maps known categories and keeps unknown categories in Other", () => {
		expect(normalizeMyWorkStatus(item(1, "backlog"))).toBe("backlog");
		expect(normalizeMyWorkStatus(item(2, "started"))).toBe("started");
		expect(normalizeMyWorkStatus(item(3, "completed"))).toBe("completed");
		expect(normalizeMyWorkStatus(item(4, "canceled"))).toBe("canceled");
		expect(normalizeMyWorkStatus(item(5, "mystery"))).toBe("other");
	});

	it("excludes terminal categories from Active but preserves them in All", () => {
		const items = [
			item(1, "backlog"),
			item(2, "started"),
			item(3, "completed"),
			item(4, "canceled"),
			item(5, "mystery"),
		];

		expect(filterMyWorkItems(items, "active").map((entry) => entry.id)).toEqual(
			[1, 2, 5],
		);
		expect(filterMyWorkItems(items, "all")).toEqual(items);
	});

	it("derives status groups without dropping unknown items", () => {
		const items = [
			item(1, "backlog"),
			item(2, "started"),
			item(3, "completed"),
			item(4, "canceled"),
			item(5, "mystery"),
		];
		const groups = deriveMyWorkGroups(items, "all");

		expect(groups.backlog.map((entry) => entry.id)).toEqual([1]);
		expect(groups.started.map((entry) => entry.id)).toEqual([2]);
		expect(groups.completed.map((entry) => entry.id)).toEqual([3]);
		expect(groups.canceled.map((entry) => entry.id)).toEqual([4]);
		expect(groups.other.map((entry) => entry.id)).toEqual([5]);
	});
});

describe("My Work pagination and URL state", () => {
	it("splits 73 items into stable 50-item pages without mutating the source", () => {
		const items = Array.from({ length: 73 }, (_, index) =>
			item(index + 1, "started"),
		);
		const original = [...items];

		const firstPage = paginateMyWorkItems(items, 1);
		const secondPage = paginateMyWorkItems(items, 2);

		expect(firstPage.items).toHaveLength(50);
		expect(secondPage.items).toHaveLength(23);
		expect(firstPage.items[0]?.id).toBe(1);
		expect(secondPage.items[0]?.id).toBe(51);
		expect(firstPage.pageCount).toBe(2);
		expect(items).toEqual(original);
	});

	it("parses valid view state and applies safe defaults to invalid values", () => {
		const parsed = parseMyWorkViewState(
			new URLSearchParams(
				"scope=all&workspaceId=17&source=tracker&q=imgae%20uplod&page=2",
			),
		);
		expect(parsed).toEqual({
			scope: "all",
			workspaceId: 17,
			source: "tracker",
			q: "imgae uplod",
			page: 2,
		});

		const invalid = parseMyWorkViewState(
			new URLSearchParams(
				"scope=unknown&workspaceId=abc&source=other&q=&page=0",
			),
		);
		expect(invalid).toEqual({
			scope: "active",
			workspaceId: "",
			source: "",
			q: "",
			page: 1,
		});
	});

	it("serializes view state in a form that round-trips through the parser", () => {
		const state = {
			scope: "all" as const,
			workspaceId: 17,
			source: "board" as const,
			q: "  retry  ",
			page: 2,
		};
		expect(parseMyWorkViewState(serializeMyWorkViewState(state))).toEqual({
			...state,
			q: "retry",
		});
	});
});
