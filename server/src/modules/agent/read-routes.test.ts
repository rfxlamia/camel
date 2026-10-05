import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../auth.js")>();
	return {
		...actual,
		requireAuth: (req: any, _res: any, next: () => void) => {
			req.user = { id: 1 };
			next();
		},
	};
});

const mockRequireWorkspaceMember = vi.fn();
vi.mock("./membership.js", () => ({
	requireWorkspaceMember: (...args: unknown[]) =>
		mockRequireWorkspaceMember(...args),
}));

import { registerReadRoutes } from "./read-routes.js";

describe("GET agent card output: columnSlug validation", () => {
	const getCardOutput = vi.fn();
	let app: express.Express;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRequireWorkspaceMember.mockResolvedValue(true);
		getCardOutput.mockResolvedValue({ output: "ok", thinking: null });
		const router = express.Router();
		registerReadRoutes(router, { getCardOutput } as never);
		app = express();
		app.use("/api", router);
	});

	it("passes a well-formed slug to the service", async () => {
		const res = await request(app).get(
			"/api/workspaces/1/agent/boards/2/outputs/research-specialist",
		);
		expect(res.status).toBe(200);
		expect(getCardOutput).toHaveBeenCalledWith({
			boardId: 2,
			columnSlug: "research-specialist",
			workspaceId: 1,
		});
	});

	it.each([
		["too long", "a".repeat(101)],
		["bad characters", "bad%20slug"],
		["dots", "..%2Fetc"],
	])("rejects a slug with %s with 400 before any lookup", async (_name, slug) => {
		const res = await request(app).get(
			`/api/workspaces/1/agent/boards/2/outputs/${slug}`,
		);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "Invalid params" });
		expect(mockRequireWorkspaceMember).not.toHaveBeenCalled();
		expect(getCardOutput).not.toHaveBeenCalled();
	});
});
