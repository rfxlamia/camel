import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const sampleVocab = {
	id: 1,
	kind: "status" as const,
	name: "Backlog",
	position: 1024,
	colour: "oklch(0.89 0.07 250)",
};

const sampleItem = {
	id: 10,
	key: "CA-1",
	title: "Fix realtime",
	description: "",
	status: sampleVocab,
	priority: null,
	labels: [],
	assignees: [],
	version: 1,
	createdAt: "2026-08-03T00:00:00.000Z",
	updatedAt: "2026-08-03T00:00:00.000Z",
};

describe("tracker item API methods", () => {
	beforeEach(() => mockFetch.mockReset());

	it("createTrackerItem POSTs to /tracker/items", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 201,
			json: () => Promise.resolve(sampleItem),
		});
		const { api } = await import("./api");

		const result = await api.createTrackerItem(7, { title: "Fix realtime" });
		expect(result).toEqual(sampleItem);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items",
			expect.objectContaining({ method: "POST" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ title: "Fix realtime" });
	});

	it("listTrackerItems GETs /tracker/items", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve([sampleItem]),
		});
		const { api } = await import("./api");

		const result = await api.listTrackerItems(7);
		expect(result).toEqual([sampleItem]);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items",
			expect.any(Object),
		);
	});

	it("listTrackerItems passes optional q search param", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve([sampleItem]),
		});
		const { api } = await import("./api");

		await api.listTrackerItems(7, { q: "realtime" });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items?q=realtime",
			expect.any(Object),
		);
	});

	it("getTrackerItem GETs /tracker/items/:key", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve(sampleItem),
		});
		const { api } = await import("./api");

		const result = await api.getTrackerItem(7, "CA-1");
		expect(result).toEqual(sampleItem);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items/CA-1",
			expect.any(Object),
		);
	});

	it("updateTrackerItem PATCHes with version", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ ...sampleItem, title: "Updated", version: 2 }),
		});
		const { api } = await import("./api");

		await api.updateTrackerItem(7, "CA-1", { title: "Updated", version: 1 });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items/CA-1",
			expect.objectContaining({ method: "PATCH" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ title: "Updated", version: 1 });
	});

	it("deleteTrackerItem DELETEs with version in body", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 204,
		});
		const { api } = await import("./api");

		await api.deleteTrackerItem(7, "CA-1", { version: 1 });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items/CA-1",
			expect.objectContaining({ method: "DELETE" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ version: 1 });
	});

	it("getTrackerChangelog GETs /tracker/items/:key/events", async () => {
		const event = {
			id: 1,
			eventType: "tracker_item_created",
			trackerItemId: 10,
			title: "Fix realtime",
			actor: { username: "testuser", displayName: "Test User" },
			createdAt: "2026-08-03T00:00:00.000Z",
		};
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ events: [event] }),
		});
		const { api } = await import("./api");

		const result = await api.getTrackerChangelog(7, "CA-1");
		expect(result).toEqual({ events: [event] });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items/CA-1/events",
			expect.any(Object),
		);
	});
});

describe("tracker vocabulary API methods", () => {
	beforeEach(() => mockFetch.mockReset());

	it("listTrackerVocabularies GETs /tracker/vocabularies with kind", async () => {
		const vocab = { ...sampleVocab, createdAt: "2026-08-03T00:00:00.000Z" };
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve([vocab]),
		});
		const { api } = await import("./api");

		const result = await api.listTrackerVocabularies(7, "status");
		expect(result).toEqual([vocab]);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/vocabularies?kind=status",
			expect.any(Object),
		);
	});

	it("createTrackerVocabulary POSTs to /tracker/vocabularies", async () => {
		const vocab = {
			id: 5,
			kind: "label" as const,
			name: "Feature",
			position: 1024,
			colour: "oklch(0.89 0.07 280)",
			createdAt: "2026-08-03T00:00:00.000Z",
		};
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 201,
			json: () => Promise.resolve(vocab),
		});
		const { api } = await import("./api");

		const result = await api.createTrackerVocabulary(7, {
			kind: "label",
			name: "Feature",
			position: 1024,
		});
		expect(result).toEqual(vocab);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/vocabularies",
			expect.objectContaining({ method: "POST" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ kind: "label", name: "Feature", position: 1024 });
	});
});
