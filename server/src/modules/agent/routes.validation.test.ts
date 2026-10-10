import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth.js", () => ({
	requireAuth: (req: any, _res: any, next: () => void) => {
		req.user = { id: 1 };
		next();
	},
}));
const membership = vi.hoisted(() => vi.fn());
vi.mock("./membership.js", () => ({ assertWorkspaceMember: membership }));
vi.mock("./service.js", () => ({ createAgentBoardService: () => ({}) }));

import { createAgentRouter } from "./routes.js";

const base = "/api/workspaces";
const combinedRoutes = [
	["get", ""],
	["get", "/outputs/research"],
	["get", "/artifact"],
	["get", "/artifact/download"],
	["post", "/message"],
	["post", "/approve"],
] as const;

function app() {
	const instance = express();
	instance.use(express.json());
	instance.use("/api", createAgentRouter());
	return instance;
}

async function check(
	method: "get" | "post",
	path: string,
	error: string,
	body = {},
) {
	const res = await request(app())[method](path).send(body);
	expect(res.status).toBe(400);
	expect(res.body).toEqual({ error });
	expect(membership).not.toHaveBeenCalled();
}

describe("agent route validation preserves legacy bodies and order", () => {
	beforeEach(() => {
		membership.mockReset();
		membership.mockImplementation((_req, res) => {
			res.status(403).json({ error: "Membership reached" });
			return false;
		});
	});

	it.each([
		"abc",
		"1.5",
		"0",
		"-1",
		"1e2",
		" 1",
		"9007199254740993",
	])("rejects workspace %s before intent", async (id) => {
		for (const method of ["get", "post"] as const) {
			await check(
				method,
				`${base}/${encodeURIComponent(id)}/agent/boards`,
				"workspaceId must be an integer",
			);
		}
	});

	it.each(
		combinedRoutes,
	)("rejects non-integer workspace on %s %s", async (method, suffix) => {
		for (const ws of ["abc", "1.5", "0", "1e2"]) {
			await check(
				method,
				`${base}/${ws}/agent/boards/2${suffix}`,
				"workspaceId must be an integer",
			);
		}
	});

	it.each(
		combinedRoutes,
	)("pins invalid board id for %s %s", async (method, suffix) => {
		for (const board of ["abc", "1.5"]) {
			await check(
				method,
				`${base}/1/agent/boards/${board}${suffix}`,
				"Invalid params",
			);
		}
	});

	it.each([
		"bad%20slug",
		"a".repeat(101),
		"..%2Fetc",
	])("pins invalid slug %s", async (slug) => {
		await check(
			"get",
			`${base}/1/agent/boards/2/outputs/${slug}`,
			"Invalid params",
		);
	});

	it.each([
		{},
		{ intent: "" },
		{ intent: "   " },
		{ intent: 3 },
		{ intent: null },
	])("pins invalid intent %j", async (body) => {
		await check("post", `${base}/1/agent/boards`, "intent is required", body);
	});

	it.each([
		{},
		{ message: "" },
		{ message: "   " },
		{ message: 3 },
		{ action: "unknown" },
	])("pins invalid message/action %j", async (body) => {
		await check(
			"post",
			`${base}/1/agent/boards/2/message`,
			"message or action is required",
			body,
		);
	});

	it.each([
		"01",
		"7",
	])("accepts digit workspace %s on every route", async (id) => {
		const routes = [
			["get", "", {}],
			["post", "", { intent: "build" }],
			...combinedRoutes.map(
				([method, suffix]) =>
					[method, `/2${suffix}`, { message: "hello" }] as const,
			),
		] as const;
		for (const [method, suffix, body] of routes) {
			membership.mockClear();
			const res = await request(app())
				[method as "get" | "post"](`${base}/${id}/agent/boards${suffix}`)
				.send(body);
			expect(res.status).not.toBe(400);
			expect(membership).toHaveBeenCalledWith(
				expect.anything(),
				expect.anything(),
				Number(id),
			);
		}
	});
});
