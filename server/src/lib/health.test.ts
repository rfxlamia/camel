import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const snapshot = { count: 3, p50: 1, p95: 2, max: 3 };

vi.mock("../core/work-item-latency.js", () => ({
	getListLatencySnapshot: () => snapshot,
}));

import {
	buildHealthPayload,
	HEALTH_PATH,
	registerHealthRoutes,
} from "./health.js";

describe("buildHealthPayload", () => {
	const original = process.env.BUILD_ID;
	afterEach(() => {
		if (original === undefined) delete process.env.BUILD_ID;
		else process.env.BUILD_ID = original;
	});

	it("reports BUILD_ID from the environment", () => {
		process.env.BUILD_ID = "abc123";
		expect(buildHealthPayload()).toEqual({
			ok: true,
			buildId: "abc123",
			workItemsListLatency: snapshot,
		});
	});

	it("falls back to a non-empty id that is stable within a process", () => {
		delete process.env.BUILD_ID;
		const first = buildHealthPayload().buildId;
		expect(first.length).toBeGreaterThan(0);
		expect(buildHealthPayload().buildId).toBe(first);
	});
});

describe.skipIf(!process.env.RUN_INTEGRATION)("health routes", () => {
	const appWith = (shuttingDown: boolean) => {
		const app = express();
		registerHealthRoutes(app, { isShuttingDown: () => shuttingDown });
		return app;
	};

	it("serves HEALTH_PATH unauthenticated with a build id and no cookies", async () => {
		const res = await request(appWith(false)).get(HEALTH_PATH);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({ ok: true });
		expect(typeof res.body.buildId).toBe("string");
		expect(res.body.buildId.length).toBeGreaterThan(0);
		expect(res.body).not.toHaveProperty("workItemsListLatency");
		expect(Object.keys(res.body).sort()).toEqual(["buildId", "ok"]);
		expect(res.headers["set-cookie"]).toBeUndefined();
	});

	it("keeps the full payload on the internal /health route", async () => {
		const res = await request(appWith(false)).get("/health");
		expect(res.status).toBe(200);
		expect(res.body.buildId).toBeTruthy();
		expect(res.body.workItemsListLatency).toEqual(snapshot);
	});

	it("returns 503 on both routes while shutting down", async () => {
		const app = appWith(true);
		for (const path of [HEALTH_PATH, "/health"]) {
			const res = await request(app).get(path);
			expect(res.status).toBe(503);
			expect(res.body).toEqual({ status: "shutting_down" });
		}
	});
});

describe("health contract with the reload hook", () => {
	const hook = readFileSync(
		new URL("../../../client/src/shared/useBuildReload.ts", import.meta.url),
		"utf8",
	);

	it("exports the path the hook fetches", () => {
		expect(HEALTH_PATH).toBe("/api/health");
		expect(hook).toContain(`"${HEALTH_PATH}"`);
	});

	it("reads the buildId field", () => {
		expect(hook).toContain("buildId");
	});
});

describe("Dockerfile build id", () => {
	const dockerfile = readFileSync(
		new URL("../../../Dockerfile", import.meta.url),
		"utf8",
	);
	const runner = dockerfile.slice(dockerfile.lastIndexOf("FROM "));

	it("declares ARG BUILD_ID and exports it as ENV in the runtime stage", () => {
		expect(runner).toContain("ARG BUILD_ID");
		expect(runner).toContain("ENV BUILD_ID=$BUILD_ID");
	});
});
