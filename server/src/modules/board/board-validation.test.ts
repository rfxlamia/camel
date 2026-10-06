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

import { COLUMN_COLOR_VALIDATION_ERROR } from "../../validators/column.js";
import { cardsRouter } from "./cards.js";
import { columnsRouter } from "./columns.js";
import { metricsRouter } from "./metrics.js";

function createApp() {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1 } as never;
		next();
	});
	app.use("/workspaces/:workspaceId", cardsRouter);
	app.use("/workspaces/:workspaceId", columnsRouter);
	app.use("/workspaces/:workspaceId", metricsRouter);
	return app;
}

const base = "/workspaces/7";

describe("board card id validation", () => {
	it.each([
		["get", "/cards/abc"],
		["patch", "/cards/abc"],
		["delete", "/cards/abc"],
		["post", "/cards/abc/move"],
	] as const)("%s %s returns 400 invalid card id", async (method, path) => {
		const res = await request(createApp())[method](`${base}${path}`).send({});
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "invalid card id" });
	});

	it("GET /cards/:id rejects a non-integer workspaceId", async () => {
		const res = await request(createApp()).get("/workspaces/abc/cards/3");
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "workspaceId must be an integer" });
	});
});

describe("board card move validation", () => {
	it("rejects statusId before the move body check", async () => {
		const res = await request(createApp())
			.post(`${base}/cards/3/move`)
			.send({ statusId: 1 });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({
			error: "statusId is not accepted for card moves",
		});
	});

	it.each([
		[{}],
		[{ toColumnId: "2", index: 0 }],
		[{ toColumnId: 2 }],
		[{ toColumnId: 2, index: -1 }],
	])("rejects %j", async (body) => {
		const res = await request(createApp())
			.post(`${base}/cards/3/move`)
			.send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "toColumnId and index are required" });
	});
});

describe("board card update validation", () => {
	it.each([
		[{ statusId: 1 }, "statusId is not accepted for card updates"],
		[{ title: "x", version: "1" }, "version must be an integer"],
		[{ title: 5 }, "title must be a string"],
		[{ title: "  " }, "title is required"],
		[{ description: 5 }, "description must be a string"],
		[{ dueDate: 5 }, "due date must be a string"],
		[{ dueDate: "tomorrow" }, "due date must be in YYYY-MM-DD format"],
		[{ assigneeIds: "1" }, "assigneeIds must be an array of integers"],
		[{}, "no updatable fields provided"],
	])("PATCH /cards/:id with %j returns the legacy message", async (body, error) => {
		const res = await request(createApp()).patch(`${base}/cards/3`).send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error });
	});
});

describe("board column validation", () => {
	it.each([
		["patch", "/columns/abc"],
		["delete", "/columns/abc"],
	] as const)("%s %s returns 400 invalid column id", async (method, path) => {
		const res = await request(createApp())[method](`${base}${path}`).send({});
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "invalid column id" });
	});

	it.each([
		[{}, "Column name is required"],
		[{ title: 5 }, "name must be a string"],
		[{ title: "   " }, "Column name is required"],
	])("POST /columns with %j", async (body, error) => {
		const res = await request(createApp()).post(`${base}/columns`).send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error });
	});

	it.each([
		[{ title: "" }, "Column name is required"],
		[{ wipLimit: 0 }, "wipLimit must be a positive integer or null"],
		[{ wipLimit: 1.5 }, "wipLimit must be a positive integer or null"],
		[{ isDone: "yes" }, "isDone must be a boolean"],
		[{ isSignable: 1 }, "isSignable must be a boolean"],
		[
			{ signableAssigneeId: "1" },
			"signableAssigneeId must be an integer or null",
		],
		[{ color: "not-a-color" }, COLUMN_COLOR_VALIDATION_ERROR],
		[{}, "no updatable fields provided"],
	])("PATCH /columns/:id with %j", async (body, error) => {
		const res = await request(createApp())
			.patch(`${base}/columns/4`)
			.send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error });
	});

	it("POST /columns/batch rejects a non-array body", async () => {
		const res = await request(createApp())
			.post(`${base}/columns/batch`)
			.send({ columns: "nope" });
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "columns must be a non-empty array" });
	});
});

describe("board metrics validation", () => {
	it.each(["abc", "0", "27", "1.5"])("weeks=%s", async (weeks) => {
		const res = await request(createApp()).get(
			`${base}/metrics/history?weeks=${weeks}`,
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({
			error: "weeks must be an integer between 1 and 26",
		});
	});
});
