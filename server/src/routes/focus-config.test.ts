import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig } = vi.hoisted(() => ({
	mockConfig: { FOCUS_MODE_ENABLED: "false" as string },
}));

vi.mock("../config.js", () => ({ config: mockConfig }));

vi.mock("../auth.js", () => ({
	requireAuth: (
		req: express.Request & { user?: unknown },
		res: express.Response,
		next: () => void,
	) => {
		if (!req.user) {
			return res.status(401).json({ error: "authentication required" });
		}
		next();
	},
}));

import { focusConfigRouter } from "./focus-config.js";

function createApp(opts?: { authenticated?: boolean }) {
	const app = express();
	app.use(express.json());
	if (opts?.authenticated !== false) {
		app.use((req, _res, next) => {
			req.user = { id: 1, username: "alice", emailVerified: true };
			next();
		});
	}
	app.use(focusConfigRouter);
	return app;
}

describe("GET /focus/config", () => {
	beforeEach(() => {
		mockConfig.FOCUS_MODE_ENABLED = "false";
	});

	it("returns enabled:true when FOCUS_MODE_ENABLED=true", async () => {
		mockConfig.FOCUS_MODE_ENABLED = "true";

		const res = await request(createApp()).get("/focus/config");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ enabled: true });
	});

	it("returns enabled:false when FOCUS_MODE_ENABLED=false", async () => {
		mockConfig.FOCUS_MODE_ENABLED = "false";

		const res = await request(createApp()).get("/focus/config");

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ enabled: false });
	});

	it("returns 401 when unauthenticated", async () => {
		const res = await request(createApp({ authenticated: false })).get(
			"/focus/config",
		);

		expect(res.status).toBe(401);
	});
});
