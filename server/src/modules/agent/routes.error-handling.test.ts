import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../../lib/logger.js";
import { createErrorHandler } from "../../middleware/error-handler.js";

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

vi.mock("../../db/kysely.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../db/kysely.js")>();
	return {
		...actual,
		db: {
			selectFrom: () => {
				throw new Error('relation "workspace_members" does not exist');
			},
		},
	};
});

import { createAgentRouter } from "./routes.js";

describe("agent routes error handling", () => {
	it("lets handler failures reach the global error handler", async () => {
		const logSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		const app = express();
		app.use(express.json());
		app.use("/api", createAgentRouter());
		app.use(createErrorHandler());

		const res = await request(app).get("/api/workspaces/1/agent/boards");

		expect(res.status).toBe(500);
		expect(res.body).toEqual({ error: "internal server error" });
		expect(logSpy).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			"request failed",
		);
		logSpy.mockRestore();
	});
});
