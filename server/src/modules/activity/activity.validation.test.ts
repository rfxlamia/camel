import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	selectFrom: vi.fn(),
}));

vi.mock("../../db/kysely.js", () => ({
	db: {
		selectFrom: (...args: unknown[]) => mocks.selectFrom(...args),
	},
}));

vi.mock("../../middleware/workspace.js", () => ({
	requireWorkspaceMember: (
		req: { workspace?: { workspaceId: number } },
		_res: unknown,
		next: () => void,
	) => {
		req.workspace = { workspaceId: 7 };
		next();
	},
}));

vi.mock("../../lib/work-item-events.js", () => ({
	getUnifiedWorkspaceActivity: vi.fn(),
}));

import { activityRouter } from "./activity.js";

function queryChain() {
	const chain = {
		select: () => chain,
		where: () => chain,
		leftJoin: () => chain,
		orderBy: () => chain,
		executeTakeFirst: () => Promise.resolve(undefined),
		execute: () => Promise.resolve([]),
	};
	return chain;
}

function createApp() {
	const app = express();
	app.use("/workspaces/:workspaceId", activityRouter);
	return app;
}

describe("GET /workspaces/:workspaceId/cards/:id/activity card id", () => {
	beforeEach(() => {
		mocks.selectFrom.mockReset();
		mocks.selectFrom.mockImplementation(() => queryChain());
	});

	it.each([
		"abc",
		"1.5",
	])("rejects card id %s before querying", async (cardId) => {
		const res = await request(createApp()).get(
			`/workspaces/7/cards/${cardId}/activity`,
		);

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "card id must be an integer" });
		expect(mocks.selectFrom).not.toHaveBeenCalled();
	});

	it("does not reject legacy integer card id 1e2", async () => {
		// Number("1e2") === 100, so this is not a validation 400.
		const res = await request(createApp()).get(
			"/workspaces/7/cards/1e2/activity",
		);

		expect(res.status).not.toBe(400);
		expect(res.body).not.toEqual({ error: "card id must be an integer" });
		expect(mocks.selectFrom).toHaveBeenCalled();
	});
});
