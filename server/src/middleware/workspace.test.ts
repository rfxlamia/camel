import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLookupMembership = vi.fn();

vi.mock("../lib/helpers.js", () => ({
	lookupMembership: (...args: unknown[]) => mockLookupMembership(...args),
}));

import { requireWorkspaceMember } from "./workspace.js";

function createApp() {
	const app = express();
	app.use((req, _res, next) => {
		req.user = { id: 1 } as never;
		next();
	});
	app.get(
		"/workspaces/:workspaceId/ping",
		requireWorkspaceMember,
		(req, res) => {
			res.json({ workspace: req.workspace });
		},
	);
	return app;
}

describe("requireWorkspaceMember", () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		"abc",
		"1.5",
		"0",
		"-1",
		"9007199254740993",
	])("returns 400 with the standard body for workspaceId %j", async (id) => {
		const res = await request(createApp()).get(`/workspaces/${id}/ping`);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "workspaceId must be an integer" });
		expect(mockLookupMembership).not.toHaveBeenCalled();
	});

	it("returns 404 when the user is not a member", async () => {
		mockLookupMembership.mockResolvedValue(null);
		const res = await request(createApp()).get("/workspaces/7/ping");
		expect(res.status).toBe(404);
	});

	it("attaches the workspace for a member", async () => {
		mockLookupMembership.mockResolvedValue("admin");
		const res = await request(createApp()).get("/workspaces/7/ping");
		expect(res.status).toBe(200);
		expect(res.body.workspace).toEqual({ workspaceId: 7, role: "admin" });
	});
});
