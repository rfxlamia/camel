import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	api,
	configureRequestBoundaryForTests,
	resetRequestBoundaryForTests,
} from "./api";
import { searchMyWorkCandidates } from "./lib/myWorkSearch";
import type {
	MyWorkItem,
	MyWorkListResponse,
	MyWorkWorkspace,
} from "./types/myWork";

const fakeFetch = vi.fn<typeof fetch>();

const workspace: MyWorkWorkspace = {
	id: 7,
	name: "Atlas",
	timezone: "Asia/Jakarta",
};

const item: MyWorkItem = {
	id: 17,
	key: "AT-17",
	source: "board",
	title: "Image upload retry",
	description: "Retry the image upload.",
	projectId: null,
	phaseId: null,
	startDate: null,
	endDate: null,
	completedAt: null,
	position: 1,
	status: {
		id: 1,
		kind: "status",
		name: "In progress",
		position: 1,
		colour: "#2563eb",
		category: "started",
		slot: "in_progress",
	},
	priority: null,
	labels: [],
	assignees: [],
	version: 1,
	createdAt: "2026-09-11T00:00:00.000Z",
	updatedAt: "2026-09-11T00:00:00.000Z",
	columnId: 3,
	columnName: "In progress",
	dueDate: null,
	startedAt: null,
	doneAt: null,
	workspace,
	workspaceId: workspace.id,
	workspaceName: workspace.name,
	identity: { workspaceId: workspace.id, source: "board", key: "AT-17" },
	statusCategory: "started",
	canMarkDone: true,
	markDoneReason: null,
};

function jsonResponse(body: unknown): Response {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
	} as Response;
}

function activeItem(id: number, title = `Active item ${id}`): MyWorkItem {
	return {
		...item,
		id,
		key: `AT-${id}`,
		title,
		identity: { workspaceId: workspace.id, source: "board", key: `AT-${id}` },
	};
}

describe("My Work API", () => {
	beforeEach(() => {
		fakeFetch.mockReset();
		configureRequestBoundaryForTests({ fetchImpl: fakeFetch });
	});

	afterEach(() => {
		resetRequestBoundaryForTests();
	});

	it("lists authorized work with supplied filters through the shared request boundary", async () => {
		const envelope: MyWorkListResponse = {
			items: [item],
			nextCursor: null,
		};
		fakeFetch.mockResolvedValueOnce(jsonResponse(envelope));

		const result = await api.listMyWork({
			scope: "all",
			q: "imgae uplod",
			workspaceId: 7,
			source: "tracker",
			cursor: "cursor-1",
			limit: 50,
		});

		expect(result).toBe(envelope);
		expect(result.items[0]?.workspace).toEqual(workspace);
		expect(result.items[0]?.workspace.timezone).toBe("Asia/Jakarta");
		expect(fakeFetch).toHaveBeenCalledTimes(1);
		expect(fakeFetch).toHaveBeenCalledWith(
			"/api/my-work?scope=all&q=imgae+uplod&workspaceId=7&source=tracker&cursor=cursor-1&limit=50",
			expect.objectContaining({
				credentials: "include",
			}),
		);
		expect(fakeFetch.mock.calls[0]?.[0]).not.toMatch(/members|assignment/i);
	});

	it("omits empty and undefined optional filters for the default Active scope", async () => {
		const envelope: MyWorkListResponse = { items: [], nextCursor: null };
		fakeFetch.mockResolvedValueOnce(jsonResponse(envelope));

		await api.listMyWork({
			scope: "active",
			q: "",
			workspaceId: "",
			source: "",
			cursor: "",
		});

		expect(fakeFetch).toHaveBeenCalledWith(
			"/api/my-work?scope=active",
			expect.any(Object),
		);
		expect(fakeFetch.mock.calls[0]?.[0]).not.toMatch(
			/[?&](q|workspaceId|source|cursor|limit)=/,
		);
	});

	it("aggregates Active candidates before local typo search across cursor pages", async () => {
		const firstPage: MyWorkListResponse = {
			items: Array.from({ length: 50 }, (_, index) => activeItem(index + 1)),
			nextCursor: "cursor-1",
		};
		const match = activeItem(73, "Image upload retry");
		const secondPage: MyWorkListResponse = {
			items: [
				...Array.from({ length: 22 }, (_, index) => activeItem(index + 51)),
				match,
			],
			nextCursor: null,
		};
		fakeFetch
			.mockResolvedValueOnce(jsonResponse(firstPage))
			.mockResolvedValueOnce(jsonResponse(secondPage));

		const candidates = await api.listActiveMyWorkCandidates({
			q: "imgae uplod",
			workspaceId: workspace.id,
			source: "board",
			limit: 50,
		});
		const results = searchMyWorkCandidates(candidates.items, "imgae uplod");

		expect(results).toContain(match);
		expect(candidates.items).toHaveLength(73);
		expect(fakeFetch).toHaveBeenCalledTimes(2);
		expect(fakeFetch).toHaveBeenNthCalledWith(
			1,
			"/api/my-work?scope=active&workspaceId=7&source=board&limit=50",
			expect.objectContaining({ credentials: "include" }),
		);
		expect(fakeFetch).toHaveBeenNthCalledWith(
			2,
			"/api/my-work?scope=active&workspaceId=7&source=board&cursor=cursor-1&limit=50",
			expect.objectContaining({ credentials: "include" }),
		);
		for (const [url] of fakeFetch.mock.calls) {
			expect(url).not.toMatch(/[?&]q=/);
		}
	});

	it("stops Active candidate aggregation when the server repeats a cursor", async () => {
		fakeFetch
			.mockResolvedValueOnce(
				jsonResponse({ items: [activeItem(1)], nextCursor: "loop" }),
			)
			.mockResolvedValueOnce(
				jsonResponse({ items: [activeItem(2)], nextCursor: "loop" }),
			);

		const result = await api.listActiveMyWorkCandidates({
			workspaceId: workspace.id,
			source: "board",
		});

		expect(result.items.map((entry) => entry.id)).toEqual([1, 2]);
		expect(result.nextCursor).toBeNull();
		expect(fakeFetch).toHaveBeenCalledTimes(2);
	});

	it("uses composite identity and version for detail and Mark done", async () => {
		fakeFetch
			.mockResolvedValueOnce(jsonResponse({ item: null }))
			.mockResolvedValueOnce(jsonResponse({ item: null }));

		await api.getMyWorkItem(7, "board", "AT-17");
		await api.markMyWorkDone(7, "board", "AT-17", 4);

		expect(fakeFetch).toHaveBeenNthCalledWith(
			1,
			"/api/my-work/7/board/AT-17",
			expect.any(Object),
		);
		expect(fakeFetch).toHaveBeenNthCalledWith(
			2,
			"/api/my-work/7/board/AT-17/done",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ version: 4 }),
			}),
		);
	});
});
