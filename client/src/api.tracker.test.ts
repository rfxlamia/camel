import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TaskCreateFieldErrors } from "./lib/taskCreateContracts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const sampleVocab = {
	id: 1,
	kind: "status" as const,
	name: "Backlog",
	position: 1024,
	colour: "oklch(0.89 0.07 250)",
	category: "backlog" as const,
};

const sampleItem = {
	id: 10,
	key: "CA-1",
	title: "Fix realtime",
	description: "",
	projectId: null,
	phaseId: null,
	startDate: null,
	endDate: null,
	completedAt: null,
	position: 1024,
	status: sampleVocab,
	priority: null,
	labels: [],
	assignees: [],
	version: 1,
	createdAt: "2026-08-03T00:00:00.000Z",
	updatedAt: "2026-08-03T00:00:00.000Z",
};

const samplePhase = {
	id: 20,
	projectId: 3,
	name: "Phase 1",
	subtitle: "",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	createdAt: "2026-08-03T00:00:00.000Z",
	updatedAt: "2026-08-03T00:00:00.000Z",
};

const sampleProject = {
	id: 3,
	name: "Realtime",
	startDate: null,
	endDate: null,
	position: 1024,
	version: 1,
	phases: [samplePhase],
	createdAt: "2026-08-03T00:00:00.000Z",
	updatedAt: "2026-08-03T00:00:00.000Z",
};

describe("tracker item API methods", () => {
	beforeEach(() => mockFetch.mockReset());

	it("accepts additive Tracker dates in the public create contract", async () => {
		const { api } = await import("./api");
		const payload: Parameters<typeof api.createWorkItem>[1] = {
			title: "Plan release",
			description: "Release details",
			statusId: 1,
			priorityId: 2,
			labelIds: [3],
			assigneeIds: [4],
			projectId: 5,
			phaseId: 6,
			startDate: "2026-09-01",
			endDate: "2026-09-30",
		};
		void payload;
	});

	it("preserves Tracker structured field errors", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 400,
			json: () =>
				Promise.resolve({
					error: "Some task fields are invalid",
					fieldErrors: {
						assigneeIds: "Assignee is no longer available",
						phaseId: "Phase is no longer available",
						statusId: "Status is no longer available",
					},
				}),
		});
		const { api } = await import("./api");
		const expectedFieldErrors: TaskCreateFieldErrors = {
			assigneeIds: "Assignee is no longer available",
			phaseId: "Phase is no longer available",
			statusId: "Status is no longer available",
		};

		await expect(
			api.createWorkItem(7, { title: "Plan release" }),
		).rejects.toMatchObject({
			message: "Some task fields are invalid",
			status: 400,
			fieldErrors: expectedFieldErrors,
		});
	});

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

	it("listWorkItems GETs /work-items", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve([sampleItem]),
		});
		const { api } = await import("./api");

		const result = await api.listWorkItems(7);
		expect(result).toEqual([sampleItem]);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/work-items",
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

	it("updateTrackerItem PATCHes project, phase, and date fields", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					...sampleItem,
					projectId: 3,
					phaseId: 20,
					startDate: "2026-08-01",
					endDate: "2026-08-31",
					version: 2,
				}),
		});
		const { api } = await import("./api");

		await api.updateTrackerItem(7, "CA-1", {
			projectId: 3,
			phaseId: 20,
			startDate: "2026-08-01",
			endDate: "2026-08-31",
			version: 1,
		});
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items/CA-1",
			expect.objectContaining({ method: "PATCH" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({
			projectId: 3,
			phaseId: 20,
			startDate: "2026-08-01",
			endDate: "2026-08-31",
			version: 1,
		});
	});

	it("reorderTrackerItem PATCHes /tracker/items/:key/position", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ ...sampleItem, position: 1536 }),
		});
		const { api } = await import("./api");

		const result = await api.reorderTrackerItem(7, "CA-1", { afterKey: "CA-9" });
		expect(result.position).toBe(1536);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/items/CA-1/position",
			expect.objectContaining({ method: "PATCH" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ afterKey: "CA-9" });
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

	it("getWorkItemChangelog GETs /work-items/:key/events", async () => {
		const event = {
			id: 2,
			eventType: "tracker_item_updated",
			trackerItemId: 10,
			title: "Board card",
			actor: null,
			createdAt: "2026-08-03T00:00:00.000Z",
		};
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ events: [event] }),
		});
		const { api } = await import("./api");

		const result = await api.getWorkItemChangelog(7, "TE-9");
		expect(result).toEqual({ events: [event] });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/work-items/TE-9/events",
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

describe("tracker project API methods", () => {
	beforeEach(() => mockFetch.mockReset());

	it("listTrackerProjects GETs /tracker/projects", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () => Promise.resolve([sampleProject]),
		});
		const { api } = await import("./api");

		const result = await api.listTrackerProjects(7);
		expect(result).toEqual([sampleProject]);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/projects",
			expect.any(Object),
		);
	});

	it("createTrackerProject POSTs to /tracker/projects", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 201,
			json: () => Promise.resolve(sampleProject),
		});
		const { api } = await import("./api");

		const result = await api.createTrackerProject(7, { name: "Realtime" });
		expect(result).toEqual(sampleProject);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/projects",
			expect.objectContaining({ method: "POST" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ name: "Realtime" });
	});

	it("updateTrackerProject PATCHes with version", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ ...sampleProject, name: "Renamed", version: 2 }),
		});
		const { api } = await import("./api");

		await api.updateTrackerProject(7, 3, { name: "Renamed", version: 1 });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/projects/3",
			expect.objectContaining({ method: "PATCH" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ name: "Renamed", version: 1 });
	});

	it("deleteTrackerProject DELETEs /tracker/projects/:id", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 204,
		});
		const { api } = await import("./api");

		await api.deleteTrackerProject(7, 3);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/projects/3",
			expect.objectContaining({ method: "DELETE" }),
		);
	});
});

describe("tracker phase API methods", () => {
	beforeEach(() => mockFetch.mockReset());

	it("createTrackerPhase POSTs to /tracker/projects/:projectId/phases", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 201,
			json: () => Promise.resolve(samplePhase),
		});
		const { api } = await import("./api");

		const result = await api.createTrackerPhase(7, 3, { name: "Phase 1" });
		expect(result).toEqual(samplePhase);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/projects/3/phases",
			expect.objectContaining({ method: "POST" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ name: "Phase 1" });
	});

	it("updateTrackerPhase PATCHes with version", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ ...samplePhase, name: "Renamed", version: 2 }),
		});
		const { api } = await import("./api");

		await api.updateTrackerPhase(7, 20, { name: "Renamed", version: 1 });
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/phases/20",
			expect.objectContaining({ method: "PATCH" }),
		);
		const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
		expect(body).toEqual({ name: "Renamed", version: 1 });
	});

	it("deleteTrackerPhase DELETEs /tracker/phases/:id", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 204,
		});
		const { api } = await import("./api");

		await api.deleteTrackerPhase(7, 20);
		expect(mockFetch).toHaveBeenCalledWith(
			"/api/workspaces/7/tracker/phases/20",
			expect.objectContaining({ method: "DELETE" }),
		);
	});
});
