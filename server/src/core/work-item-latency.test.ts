import { describe, expect, it, beforeEach } from "vitest";
import {
	getListLatencySnapshot,
	isOverThreshold,
	recordListDuration,
	resetListLatencySamplesForTests,
	WORK_ITEMS_LIST_THRESHOLD_MS,
} from "./work-item-latency.js";

describe("work-item-latency", () => {
	beforeEach(() => {
		resetListLatencySamplesForTests();
	});

	it("computes p50 and p95 from recorded samples", () => {
		for (let i = 0; i < 100; i++) {
			recordListDuration(10);
		}
		for (let i = 0; i < 5; i++) {
			recordListDuration(200);
		}

		const snapshot = getListLatencySnapshot();
		expect(snapshot.count).toBe(105);
		expect(snapshot.thresholdMs).toBe(WORK_ITEMS_LIST_THRESHOLD_MS);
		expect(snapshot.p50).toBe(10);
		expect(snapshot.p95).toBeGreaterThanOrEqual(10);
		expect(snapshot.max).toBe(200);
	});

	it("reports over threshold when p95 exceeds 100ms", () => {
		for (let i = 0; i < 150; i++) {
			recordListDuration(10);
		}
		for (let i = 0; i < 50; i++) {
			recordListDuration(200);
		}

		expect(isOverThreshold()).toBe(true);
	});

	it("reports within threshold when all samples are fast", () => {
		for (let i = 0; i < 50; i++) {
			recordListDuration(20);
		}

		expect(isOverThreshold()).toBe(false);
	});
});
