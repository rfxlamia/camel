import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	cleanupExpiredSessions: vi.fn(async () => undefined),
	initNotificationService: vi.fn(),
	startDueDateScheduler: vi.fn(),
	startWorkItemLatencyReporter: vi.fn(),
	pSubscribe: vi.fn(async () => undefined),
	duplicate: vi.fn(),
	order: [] as string[],
}));

vi.mock("./auth.js", () => ({
	cleanupExpiredSessions: mocks.cleanupExpiredSessions,
}));
vi.mock("./modules/notifications/index.js", () => ({
	initNotificationService: mocks.initNotificationService,
	startDueDateScheduler: mocks.startDueDateScheduler,
}));
vi.mock("./core/work-item-latency.js", () => ({
	startWorkItemLatencyReporter: mocks.startWorkItemLatencyReporter,
}));
vi.mock("./db/redis.js", () => ({
	connectRedis: vi.fn(),
	getRedisClient: () => ({
		duplicate: mocks.duplicate,
		on: vi.fn(),
	}),
}));

import { startBackgroundJobs, stopBackgroundJobs } from "./background-jobs.js";

describe("BACKGROUND_JOBS switch", () => {
	const original = process.env["BACKGROUND_JOBS"];

	beforeEach(() => {
		vi.useFakeTimers();
		mocks.order.length = 0;
		mocks.cleanupExpiredSessions.mockClear();
		mocks.initNotificationService.mockReset();
		mocks.startDueDateScheduler.mockReset();
		mocks.startWorkItemLatencyReporter.mockReset();
		mocks.pSubscribe.mockClear();
		mocks.duplicate.mockReset();
		mocks.duplicate.mockImplementation(() => ({
			on: vi.fn(),
			connect: vi.fn(async () => undefined),
			quit: vi.fn(async () => undefined),
			pSubscribe: mocks.pSubscribe,
		}));
		mocks.initNotificationService.mockImplementation(() =>
			mocks.order.push("notifications"),
		);
		mocks.startDueDateScheduler.mockImplementation(() => {
			mocks.order.push("scheduler");
			return setInterval(() => undefined, 60_000);
		});
		mocks.startWorkItemLatencyReporter.mockImplementation(() => {
			mocks.order.push("latency");
			return setInterval(() => undefined, 60_000);
		});
		mocks.cleanupExpiredSessions.mockImplementation(async () => {
			mocks.order.push("cleanup");
		});
	});

	afterEach(() => {
		stopBackgroundJobs();
		vi.useRealTimers();
		if (original === undefined) delete process.env["BACKGROUND_JOBS"];
		else process.env["BACKGROUND_JOBS"] = original;
	});

	it("BACKGROUND_JOBS=off starts no timers or subscribers", async () => {
		process.env["BACKGROUND_JOBS"] = "off";

		await startBackgroundJobs();

		expect(vi.getTimerCount()).toBe(0);
		expect(mocks.startDueDateScheduler).not.toHaveBeenCalled();
		expect(mocks.startWorkItemLatencyReporter).not.toHaveBeenCalled();
		expect(mocks.initNotificationService).not.toHaveBeenCalled();
		expect(mocks.cleanupExpiredSessions).not.toHaveBeenCalled();
		expect(mocks.duplicate).not.toHaveBeenCalled();
		expect(mocks.pSubscribe).not.toHaveBeenCalled();
	});

	it.each([
		["unset", undefined],
		["on", "on"],
	])("starts every job in the original order when %s", async (_label, value) => {
		if (value === undefined) delete process.env["BACKGROUND_JOBS"];
		else process.env["BACKGROUND_JOBS"] = value;

		await startBackgroundJobs();

		expect(mocks.pSubscribe).toHaveBeenCalledTimes(1);
		expect(mocks.order).toEqual([
			"notifications",
			"scheduler",
			"latency",
			"cleanup",
		]);
		// scheduler + latency reporter + 24h session cleanup
		expect(vi.getTimerCount()).toBe(3);
	});
});
