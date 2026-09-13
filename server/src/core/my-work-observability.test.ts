import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createMyWorkObservability,
	resetMyWorkObservabilityForTests,
} from "./my-work-observability.js";

describe("my-work-observability", () => {
	beforeEach(() => {
		resetMyWorkObservabilityForTests();
	});

	it("records only sanitized latency, count, and error-class fields", () => {
		const logger = vi.fn();
		const now = vi
			.fn<() => number>()
			.mockReturnValueOnce(100)
			.mockReturnValueOnce(147);
		const observability = createMyWorkObservability({ logger, now });

		const measurement = observability.start();
		const event = measurement.finish({
			count: 4,
			error: {
				status: 401,
				message: "private task title and unauthorized user 47099",
			},
		});

		expect(event).toEqual({
			event: "my_work_rollup",
			latencyMs: 47,
			count: 4,
			errorClass: "unauthorized",
		});
		expect(logger).toHaveBeenCalledWith(event);
		expect(Object.keys(event)).toEqual([
			"event",
			"latencyMs",
			"count",
			"errorClass",
		]);
		const serialized = JSON.stringify(event);
		expect(serialized).not.toContain("private task title");
		expect(serialized).not.toContain("47099");
		expect(serialized).not.toContain("message");
	});

	it("classifies successful, client, and server outcomes without retaining errors", () => {
		const logger = vi.fn();
		const observability = createMyWorkObservability({ logger });

		const successful = observability.record({
			latencyMs: 12,
			count: 7,
			statusCode: 200,
		});
		const clientFailure = observability.record({
			latencyMs: 18,
			count: 0,
			statusCode: 400,
			error: { message: "private query text" },
		});
		const serverFailure = observability.record({
			latencyMs: 24,
			count: 0,
			statusCode: 503,
			error: new Error("database credentials and task body"),
		});

		expect(
			[successful.errorClass, clientFailure.errorClass, serverFailure.errorClass],
		).toEqual(["none", "client", "server"]);
		expect(observability.getLatencySnapshot()).toMatchObject({
			count: 3,
			p95: 24,
		});
		expect(JSON.stringify(logger.mock.calls)).not.toContain(
			"private query text",
		);
		expect(JSON.stringify(logger.mock.calls)).not.toContain("database credentials");
		expect(JSON.stringify(logger.mock.calls)).not.toContain("task body");
	});
});
