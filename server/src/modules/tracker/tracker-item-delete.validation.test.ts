import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/kysely.js", () => ({
	db: {},
}));

import { deleteTrackerItemHandler } from "./tracker-item-delete.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.delete("/workspaces/:workspaceId/tracker/items/:key", (req, res) => {
		req.user = { id: 1 } as never;
		req.workspace = { workspaceId: 7, role: "admin" };
		return deleteTrackerItemHandler(req, res);
	});
	return app;
}

describe("deleteTrackerItemHandler version validation", () => {
	it("returns 400 with the standard body for a non-integer version", async () => {
		const res = await request(createApp())
			.delete("/workspaces/7/tracker/items/CT-42")
			.send({ version: "1" });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "version must be an integer" });
	});
});
