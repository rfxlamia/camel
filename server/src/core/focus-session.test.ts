import { describe, expect, it } from "vitest";
import {
	type FocusAction,
	type FocusSnapshot,
	InvalidFocusTransitionError,
	applyAction,
	elapsedSeconds,
} from "./focus-session.js";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const after = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const ready: FocusSnapshot = {
	state: "ready",
	accumulatedSeconds: 0,
	runningSince: null,
};

describe("applyAction — cycle A: start from ready", () => {
	it("transitions to running with runningSince at T0 and zero accumulated time", () => {
		const result = applyAction(ready, "start", T0);
		expect(result).toEqual({
			state: "running",
			accumulatedSeconds: 0,
			runningSince: T0,
		});
	});
});

describe("applyAction — cycle B: pause from running", () => {
	it("accrues 600s when pausing after 10 minutes", () => {
		const running: FocusSnapshot = {
			state: "running",
			accumulatedSeconds: 0,
			runningSince: T0,
		};
		const result = applyAction(running, "pause", after(600));
		expect(result).toEqual({
			state: "paused",
			accumulatedSeconds: 600,
			runningSince: null,
		});
	});
});

describe("applyAction — cycle C: resume then pause", () => {
	it("adds 300s after resuming a paused session at 600s", () => {
		const paused: FocusSnapshot = {
			state: "paused",
			accumulatedSeconds: 600,
			runningSince: null,
		};
		const resumed = applyAction(paused, "resume", T0);
		const result = applyAction(resumed, "pause", after(300));
		expect(result).toEqual({
			state: "paused",
			accumulatedSeconds: 900,
			runningSince: null,
		});
	});
});

describe("elapsedSeconds — cycle D", () => {
	it("returns accumulated plus in-flight delta when running", () => {
		const snapshot: FocusSnapshot = {
			state: "running",
			accumulatedSeconds: 1200,
			runningSince: T0,
		};
		expect(elapsedSeconds(snapshot, after(90))).toBe(1290);
	});

	it("returns frozen accumulated time when paused", () => {
		const snapshot: FocusSnapshot = {
			state: "paused",
			accumulatedSeconds: 1200,
			runningSince: null,
		};
		expect(elapsedSeconds(snapshot, after(90))).toBe(1200);
	});

	it("returns zero when ready", () => {
		expect(elapsedSeconds(ready, after(90))).toBe(0);
	});
});

describe("applyAction — cycle E: finish from running", () => {
	it("accrues in-flight time and clears runningSince", () => {
		const running: FocusSnapshot = {
			state: "running",
			accumulatedSeconds: 300,
			runningSince: T0,
		};
		const result = applyAction(running, "finish", after(120));
		expect(result).toEqual({
			state: "finished",
			accumulatedSeconds: 420,
			runningSince: null,
		});
	});
});

describe("applyAction — cycle E2: finish from paused and ready", () => {
	it("does not accrue additional time when finishing from paused", () => {
		const paused: FocusSnapshot = {
			state: "paused",
			accumulatedSeconds: 600,
			runningSince: null,
		};
		const result = applyAction(paused, "finish", after(999));
		expect(result).toEqual({
			state: "finished",
			accumulatedSeconds: 600,
			runningSince: null,
		});
	});

	it("finishes at zero when finishing from ready", () => {
		const result = applyAction(ready, "finish", T0);
		expect(result).toEqual({
			state: "finished",
			accumulatedSeconds: 0,
			runningSince: null,
		});
	});
});

describe("applyAction — cycle F: illegal transitions", () => {
	const running: FocusSnapshot = {
		state: "running",
		accumulatedSeconds: 0,
		runningSince: T0,
	};
	const paused: FocusSnapshot = {
		state: "paused",
		accumulatedSeconds: 600,
		runningSince: null,
	};
	const finished: FocusSnapshot = {
		state: "finished",
		accumulatedSeconds: 600,
		runningSince: null,
	};

	const cases: Array<{
		label: string;
		snapshot: FocusSnapshot;
		action: FocusAction;
	}> = [
		{ label: "start from running", snapshot: running, action: "start" },
		{ label: "start from paused", snapshot: paused, action: "start" },
		{ label: "resume from ready", snapshot: ready, action: "resume" },
		{ label: "resume from running", snapshot: running, action: "resume" },
		{ label: "pause from ready", snapshot: ready, action: "pause" },
		{ label: "pause from paused", snapshot: paused, action: "pause" },
		{ label: "start from finished", snapshot: finished, action: "start" },
		{ label: "pause from finished", snapshot: finished, action: "pause" },
		{ label: "resume from finished", snapshot: finished, action: "resume" },
		{ label: "finish from finished", snapshot: finished, action: "finish" },
	];

	for (const { label, snapshot, action } of cases) {
		it(`throws InvalidFocusTransitionError for ${label}`, () => {
			const before = { ...snapshot, runningSince: snapshot.runningSince };
			expect(() => applyAction(snapshot, action, T0)).toThrow(
				InvalidFocusTransitionError,
			);
			expect(snapshot).toEqual(before);
		});
	}
});
