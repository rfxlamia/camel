import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUnifiedWorkspaceActivity = vi.fn();

vi.mock("../middleware/workspace.js", () => ({
	requireWorkspaceMember: (_req: unknown, _res: unknown, next: () => void) =>
		next(),
}));
vi.mock("./work-item-events.js", () => ({
	getUnifiedWorkspaceActivity: (...args: unknown[]) =>
		mockGetUnifiedWorkspaceActivity(...args),
}));

import { activityRouter } from "./activity.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		(req as express.Request & { workspace?: { workspaceId: number } }).workspace =
			{ workspaceId: 7 };
		next();
	});
	app.use("/workspaces/:workspaceId", activityRouter);
	return app;
}

beforeEach(() => {
	mockGetUnifiedWorkspaceActivity.mockReset();
});

describe("GET /activity/unified", () => {
	it("returns merged events with default limit 50", async () => {
		mockGetUnifiedWorkspaceActivity.mockResolvedValue([
			{
				eventKey: "board:1",
				id: 1,
				source: "board",
				eventType: "tracker_item_updated",
				title: "Card",
				payload: null,
				actor: null,
				createdAt: "2026-09-01T10:00:00.000Z",
			},
		]);

		const res = await request(createApp()).get(
			"/workspaces/7/activity/unified",
		);

		expect(res.status).toBe(200);
		expect(res.body.events).toHaveLength(1);
		expect(res.body.events[0].eventKey).toBe("board:1");
		expect(mockGetUnifiedWorkspaceActivity).toHaveBeenCalledWith(7, 50);
	});

	it("caps limit query param at 200", async () => {
		mockGetUnifiedWorkspaceActivity.mockResolvedValue([]);

		await request(createApp()).get(
			"/workspaces/7/activity/unified?limit=500",
		);

		expect(mockGetUnifiedWorkspaceActivity).toHaveBeenCalledWith(7, 200);
	});

	it("returns empty list for workspaces with no events", async () => {
		mockGetUnifiedWorkspaceActivity.mockResolvedValue([]);

		const res = await request(createApp()).get(
			"/workspaces/7/activity/unified",
		);

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ events: [] });
	});
});
