import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

function chainable(result: unknown) {
	const builder: Record<string, ReturnType<typeof vi.fn>> = {};
	for (const method of ["where", "select", "orderBy"]) {
		builder[method] = vi.fn(() => builder);
	}
	builder.executeTakeFirst = vi.fn().mockResolvedValue(result);
	return builder;
}

const mockListMergedWorkItems = vi.fn();
const mockGetWorkItemEvents = vi.fn();
const mockFindTrackerItemByKeyNumber = vi.fn();
const mockHydrateTrackerWorkItems = vi.fn();

vi.mock("../db/kysely.js", () => ({
	db: {
		selectFrom: vi.fn(() => chainable({ name: "Camel Team" })),
	},
}));
vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: (_req: unknown, _res: unknown, next: () => void) =>
		next(),
}));
vi.mock("./work-item-response.js", () => ({
	listMergedWorkItems: (...args: unknown[]) => mockListMergedWorkItems(...args),
	findBoardCardByKeyNumber: vi.fn(),
	findTrackerItemByKeyNumber: (...args: unknown[]) =>
		mockFindTrackerItemByKeyNumber(...args),
	hydrateBoardWorkItems: vi.fn(),
	hydrateTrackerWorkItems: (...args: unknown[]) =>
		mockHydrateTrackerWorkItems(...args),
}));
vi.mock("./work-item-events.js", () => ({
	getWorkItemEvents: (...args: unknown[]) => mockGetWorkItemEvents(...args),
}));
vi.mock("../realtime.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../realtime.js")>();
	return {
		...actual,
		publishEvent: vi.fn(),
	};
});
vi.mock("./tracker-activity.js", () => ({ recordTrackerActivity: vi.fn() }));
vi.mock("./tracker-assignees.js", () => ({
	loadTrackerAssigneesForItems: vi.fn(),
	syncTrackerItemAssignees: vi.fn(),
}));
vi.mock("../events.js", () => ({ domainBus: { emit: vi.fn() }, EVENTS: {} }));

import { trackerItemsRouter } from "./tracker-items.js";
import { workItemsRouter } from "./work-items.js";

function createApp(router: express.Router) {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		(req as express.Request & { workspace?: { workspaceId: number } }).workspace =
			{ workspaceId: 7 };
		next();
	});
	app.use("/workspaces/:workspaceId", router);
	return app;
}

beforeEach(() => {
	mockListMergedWorkItems.mockReset();
	mockGetWorkItemEvents.mockReset();
	mockFindTrackerItemByKeyNumber.mockReset();
	mockHydrateTrackerWorkItems.mockReset();
	mockListMergedWorkItems.mockResolvedValue([{ key: "TE-1", source: "board" }]);
	mockGetWorkItemEvents.mockResolvedValue([
		{
			id: 1,
			eventType: "tracker_item_created",
			trackerItemId: null,
			title: "Board card",
			payload: null,
			actor: null,
			createdAt: "2026-09-01T10:00:00.000Z",
		},
	]);
	mockFindTrackerItemByKeyNumber.mockResolvedValue({
		id: 1,
		key_number: 1,
		title: "Detail item",
	});
	mockHydrateTrackerWorkItems.mockResolvedValue([
		{ key: "CT-1", source: "tracker", title: "Detail item" },
	]);
});

describe("work-items route alias", () => {
	it("GET /work-items delegates to the tracker items list handler", async () => {
		const app = createApp(workItemsRouter);
		const res = await request(app).get("/workspaces/7/work-items");

		expect(res.status).toBe(200);
		expect(res.body).toEqual([{ key: "TE-1", source: "board" }]);
		expect(mockListMergedWorkItems).toHaveBeenCalled();
	});

	it("GET /tracker/items still serves the legacy path", async () => {
		const app = createApp(trackerItemsRouter);
		const res = await request(app).get("/workspaces/7/tracker/items");

		expect(res.status).toBe(200);
		expect(res.body).toEqual([{ key: "TE-1", source: "board" }]);
	});

	it("GET /work-items/:key resolves a single item", async () => {
		const app = createApp(workItemsRouter);
		const res = await request(app).get("/workspaces/7/work-items/CT-1");

		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ key: "CT-1", title: "Detail item" });
		expect(mockFindTrackerItemByKeyNumber).toHaveBeenCalled();
	});

	it("GET /work-items/:key/events returns changelog events", async () => {
		const app = createApp(workItemsRouter);
		const res = await request(app).get("/workspaces/7/work-items/CT-1/events");

		expect(res.status).toBe(200);
		expect(res.body.events).toHaveLength(1);
		expect(mockGetWorkItemEvents).toHaveBeenCalled();
	});

	it("PATCH /work-items/:key rejects invalid tracker key", async () => {
		const app = createApp(workItemsRouter);
		const res = await request(app)
			.patch("/workspaces/7/work-items/not-a-key")
			.send({ title: "Nope" });

		expect(res.status).toBe(400);
	});

	it("preserves canonical and legacy route wiring parity", async () => {
		const canonicalApp = createApp(workItemsRouter);
		const legacyApp = createApp(trackerItemsRouter);
		const [canonical, legacy] = await Promise.all([
			request(canonicalApp)
				.post("/workspaces/7/work-items")
				.send({ title: "   " }),
			request(legacyApp)
				.post("/workspaces/7/tracker/items")
				.send({ title: "   " }),
		]);

		expect(canonical.status).toBe(legacy.status);
		expect(canonical.body).toEqual(legacy.body);
	});
});
