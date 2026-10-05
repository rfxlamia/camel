import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/kysely.js", () => ({
	db: {},
}));
vi.mock("../../middleware/workspace.js", () => ({
	requireWorkspaceMember: (
		req: express.Request,
		_res: express.Response,
		next: express.NextFunction,
	) => {
		req.workspace = { workspaceId: 7, role: "admin" };
		next();
	},
}));

import { cardsRouter } from "./cards.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1 } as never;
		next();
	});
	app.use("/workspaces/:workspaceId", cardsRouter);
	return app;
}

describe("card version validation", () => {
	it("DELETE /cards/:id returns 400 for a non-integer version", async () => {
		const res = await request(createApp())
			.delete("/workspaces/7/cards/3")
			.send({ version: "1" });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "version must be an integer" });
	});

	it("POST /cards/:id/move returns 400 for a non-integer version", async () => {
		const res = await request(createApp())
			.post("/workspaces/7/cards/3/move")
			.send({ toColumnId: 2, index: 0, version: 1.5 });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "version must be an integer" });
	});
});
