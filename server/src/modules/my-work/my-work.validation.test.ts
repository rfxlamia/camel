import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../db/kysely.js", () => ({ db: {} }));

import { createMyWorkRouter } from "./my-work.js";
import { parseMyWorkQuery } from "./my-work-query-parser.js";

function setup() {
	const service = {
		list: vi.fn(),
		getDetail: vi.fn(),
		markDone: vi.fn(),
	};
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.user = { id: 1, username: "alice" } as express.Request["user"];
		next();
	});
	app.use("/my-work", createMyWorkRouter({ service }));
	return { app, service };
}

describe("my-work route param validation", () => {
	it.each([
		["/my-work/abc/board/AT-1", "workspaceId must be a positive integer"],
		["/my-work/0/board/AT-1", "workspaceId must be a positive integer"],
		["/my-work/-3/board/AT-1", "workspaceId must be a positive integer"],
		["/my-work/1e2/board/AT-1", "workspaceId must be a positive integer"],
		["/my-work/7/sprint/AT-1", "source must be board or tracker"],
		["/my-work/7/board/nope", "invalid work item key"],
	])("GET %s -> 400 %s", async (path, error) => {
		const { app, service } = setup();
		const res = await request(app).get(path);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error });
		expect(service.getDetail).not.toHaveBeenCalled();
	});

	it("reports the first failing param in workspaceId, source, key order", async () => {
		const { app } = setup();
		const res = await request(app).get("/my-work/abc/sprint/nope");
		expect(res.body).toEqual({
			error: "workspaceId must be a positive integer",
		});
	});

	it("POST done validates params and version before calling the service", async () => {
		const { app, service } = setup();
		const badParam = await request(app).post("/my-work/7/sprint/AT-1/done");
		expect(badParam.status).toBe(400);
		expect(badParam.body).toEqual({ error: "source must be board or tracker" });

		for (const version of [1.5, "2", null]) {
			const res = await request(app)
				.post("/my-work/7/board/AT-1/done")
				.send({ version });
			expect(res.status).toBe(400);
			expect(res.body).toEqual({ error: "version must be an integer" });
		}
		expect(service.markDone).not.toHaveBeenCalled();
	});

	it("GET / maps query parser errors to the shared 400 body", async () => {
		const { app, service } = setup();
		const res = await request(app).get("/my-work?workspaceId=1e2");
		expect(res.status).toBe(400);
		expect(res.body).toEqual({
			error: "workspaceId must be a positive integer",
		});
		expect(service.list).not.toHaveBeenCalled();
	});
});

describe("parseMyWorkQuery workspaceId", () => {
	it.each([
		"1e2",
		"+5",
		"0x10",
		"",
		"0",
		"-1",
		"1.5",
	])("rejects %j", (value) => {
		expect(parseMyWorkQuery({ workspaceId: value })).toEqual({
			ok: false,
			error: "workspaceId must be a positive integer",
		});
	});

	it("accepts digit-only positive ids", () => {
		const parsed = parseMyWorkQuery({ workspaceId: "42" });
		expect(parsed.ok && parsed.value.workspaceId).toBe(42);
	});
});
