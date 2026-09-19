import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { MyWorkItem } from "../shared/myWorkTypes";
import type { WorkItem } from "../types";
import {
	markWorkItemDone,
	reorderWorkItem,
	updateWorkItem,
	updateWorkItemStatus,
} from "./workItemMutations";

vi.mock("../api", () => ({
	api: {
		updateCard: vi.fn(),
		updateWorkItem: vi.fn(),
		reorderWorkItem: vi.fn(),
		markMyWorkDone: vi.fn(),
	},
}));

const boardItem: WorkItem = {
	id: 7,
	key: "TE-9",
	source: "board",
	title: "ppo",
	description: "",
	status: {
		id: 1,
		kind: "status",
		name: "Backlog",
		position: 1024,
		colour: "blue",
		slot: "backlog",
	},
	priority: null,
	labels: [],
	assignees: [],
	version: 1,
	createdAt: "2026-08-31T00:00:00.000Z",
	updatedAt: "2026-08-31T00:00:00.000Z",
	columnId: 3,
	columnName: "Requested",
};

describe("workItemMutations", () => {
	it.each([
		"board",
		"tracker",
	] as const)("routes %s Mark done through the My Work command and preserves its source", async (source) => {
		const item: MyWorkItem = {
			...boardItem,
			source,
			key: source === "board" ? "TE-9" : "CA-9",
			workspace: { id: 12, name: "Atlas", timezone: "UTC" },
			workspaceId: 12,
			workspaceName: "Atlas",
			identity: {
				workspaceId: 12,
				source,
				key: source === "board" ? "TE-9" : "CA-9",
			},
			canMarkDone: true,
			markDoneReason: null,
		};
		const completed = { ...item, source, version: 2 };
		vi.mocked(api.markMyWorkDone).mockResolvedValueOnce(completed as never);

		const updated = await markWorkItemDone(12, item);

		expect(api.markMyWorkDone).toHaveBeenCalledWith(
			12,
			source,
			item.key,
			item.version,
		);
		expect(updated.source).toBe(source);
		expect(updated.version).toBe(2);
	});

	it("routes board field updates to updateCard", async () => {
		vi.mocked(api.updateCard).mockResolvedValue({
			...boardItem,
			title: "updated",
			version: 2,
			updatedAt: "2026-09-01T00:00:00.000Z",
		} as never);

		const updated = await updateWorkItem(1, boardItem, {
			title: "updated",
			version: 1,
		});

		expect(api.updateCard).toHaveBeenCalledWith(1, 7, {
			title: "updated",
			version: 1,
		});
		expect(updated.title).toBe("updated");
		expect(updated.source).toBe("board");
		expect(updated.updatedAt).toBe("2026-09-01T00:00:00.000Z");
	});

	it("routes board status changes through tracker PATCH", async () => {
		vi.mocked(api.updateWorkItem).mockResolvedValue({
			...boardItem,
			source: "board",
			status: { ...boardItem.status, id: 4, name: "Done", slot: "done" },
			version: 2,
		});

		await updateWorkItemStatus(1, boardItem, 4, 1);

		expect(api.updateWorkItem).toHaveBeenCalledWith(1, "TE-9", {
			statusId: 4,
			version: 1,
		});
	});

	it("routes reorder through tracker API and preserves source", async () => {
		const trackerItem: WorkItem = {
			...boardItem,
			source: "tracker",
			key: "CA-5",
		};
		vi.mocked(api.reorderWorkItem).mockResolvedValue({
			...trackerItem,
			position: 2048,
			version: 2,
		});

		const updated = await reorderWorkItem(1, trackerItem, {
			afterKey: "CA-3",
		});

		expect(api.reorderWorkItem).toHaveBeenCalledWith(1, "CA-5", {
			afterKey: "CA-3",
		});
		expect(updated.source).toBe("tracker");
		expect(updated.position).toBe(2048);
	});
});
