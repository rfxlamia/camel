// Requires the production router stack. Gated: RUN_INTEGRATION=1
// Run: RUN_INTEGRATION=1 npm run test --workspace=server -- src/modules/my-work.observability.integration.test.ts
import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
	getMyWorkObservabilityEvents,
	resetMyWorkObservabilityForTests,
} from "../../core/my-work-observability.js";
import { createErrorHandler } from "../../middleware/error-handler.js";
import { api } from "../../routes.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", api);
app.use(createErrorHandler());

const integration = describe.skipIf(!process.env.RUN_INTEGRATION);

integration("My Work unauthorized observability boundary", () => {
	beforeEach(() => {
		resetMyWorkObservabilityForTests();
	});

	it("records one sanitized unauthorized rollup event before the real auth rejection", async () => {
		const response = await request(app).get(
			"/api/my-work?scope=active&limit=50",
		);

		expect(response.status).toBe(401);
		expect(response.body).toEqual({ error: "authentication required" });

		const events = getMyWorkObservabilityEvents();
		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			event: "my_work_rollup",
			latencyMs: 0,
			count: 0,
			errorClass: "unauthorized",
		});

		const serializedTelemetry = JSON.stringify(events);
		expect(serializedTelemetry).not.toContain("task");
		expect(serializedTelemetry).not.toContain("workspace");
		expect(serializedTelemetry).not.toContain("user");
		expect(serializedTelemetry).not.toContain("credential");
		expect(serializedTelemetry).not.toContain("DATABASE_URL");
	});
});
