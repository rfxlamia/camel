import { afterEach, describe, expect, it, vi } from "vitest";

const snapshot = { count: 3, p50: 1, p95: 2, max: 3 };

vi.mock("../core/work-item-latency.js", () => ({
	getListLatencySnapshot: () => snapshot,
}));

import { buildHealthPayload } from "./health.js";

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
