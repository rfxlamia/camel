import { describe, expect, it, vi } from "vitest";
import type { MyWorkItem } from "../types/myWork";
import { searchMyWorkItems } from "./myWorkSearch";

function item(
	id: number,
	key: string,
	title: string,
	description: string,
): MyWorkItem {
	return {
		id,
		key,
		title,
		description,
		source: "tracker",
		status: {
			id: 1,
			kind: "status",
			name: "Started",
			position: 1,
			colour: "#ccc",
			category: "started",
			slot: "in_progress",
		},
		priority: null,
		labels: [],
		assignees: [],
		version: 1,
		createdAt: "2026-09-11T00:00:00.000Z",
		updatedAt: "2026-09-11T00:00:00.000Z",
		workspace: { id: 1, name: "Atlas", timezone: "Asia/Jakarta" },
		workspaceId: 1,
		workspaceName: "Atlas",
		identity: { workspaceId: 1, source: "tracker", key },
		statusCategory: "started",
		canMarkDone: true,
		markDoneReason: null,
	};
}

describe("My Work Fuse search", () => {
	it("ranks typo-tolerant key/title/description matches without discovery", () => {
		const match = item(
			1,
			"OR-22",
			"Image upload retry",
			"Retry failed image uploads",
		);
		const unrelated = item(
			2,
			"OR-23",
			"Update billing settings",
			"Review invoices",
		);
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		try {
			const results = searchMyWorkItems([unrelated, match], "imgae uplod");

			expect(results[0]).toBe(match);
			expect(results).toContain(match);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("respects a bounded result limit with deterministic Fuse order", () => {
		const items = [
			item(1, "OR-22", "Image upload retry", "Retry failed image uploads"),
			item(2, "OR-23", "Image upload documentation", "Document the workflow"),
			item(3, "OR-24", "Image processing", "Resize uploaded images"),
		];

		const firstRun = searchMyWorkItems(items, "image upload", { limit: 2 });
		const secondRun = searchMyWorkItems(items, "image upload", { limit: 2 });

		expect(firstRun).toHaveLength(2);
		expect(firstRun.map((entry) => entry.id)).toEqual(
			secondRun.map((entry) => entry.id),
		);
	});

	it("ranks only the supplied candidate window", () => {
		const hiddenMatch = item(
			99,
			"OR-99",
			"Image upload retry",
			"Hidden historical item",
		);
		const candidate = item(4, "OR-25", "Unrelated task", "No matching text");

		const candidateWindow = [candidate];
		const results = searchMyWorkItems(candidateWindow, "image upload", {
			limit: 50,
		});

		expect(results).not.toContain(hiddenMatch);
		expect(results).toEqual([]);
	});
});
