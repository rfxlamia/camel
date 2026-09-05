import { describe, expect, it } from "vitest";
import { computeDisplaySeconds, formatDuration } from "./focusDuration";

describe("formatDuration", () => {
	it("formats under one hour as MM:SS", () => {
		expect(formatDuration(0)).toBe("00:00");
		expect(formatDuration(90)).toBe("01:30");
		expect(formatDuration(1200)).toBe("20:00");
		expect(formatDuration(3599)).toBe("59:59");
	});

	it("formats at or above one hour as H:MM:SS", () => {
		expect(formatDuration(3600)).toBe("1:00:00");
		expect(formatDuration(3661)).toBe("1:01:01");
	});
});

describe("computeDisplaySeconds", () => {
	const runningSince = "2026-09-04T10:00:00.000Z";
	const nowMs = Date.parse("2026-09-04T10:01:30.000Z");

	it("adds elapsed time while running", () => {
		expect(
			computeDisplaySeconds(1200, "running", runningSince, nowMs),
		).toBe(1290);
	});

	it("returns accumulated seconds when paused or ready", () => {
		expect(computeDisplaySeconds(900, "paused", null, nowMs)).toBe(900);
		expect(computeDisplaySeconds(0, "ready", null, nowMs)).toBe(0);
	});

	it("clamps to zero when the client clock lags behind runningSince", () => {
		const laggingNowMs = Date.parse("2026-09-04T09:59:00.000Z");
		expect(computeDisplaySeconds(0, "running", runningSince, laggingNowMs)).toBe(
			0,
		);
	});
});
