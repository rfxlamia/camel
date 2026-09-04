// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FocusSession } from "../types";
import FocusTimer from "./FocusTimer";

const T0 = new Date("2026-09-04T10:00:00.000Z");

function makeSession(overrides: Partial<FocusSession> = {}): FocusSession {
	return {
		id: 1,
		state: "ready",
		accumulatedSeconds: 0,
		runningSince: null,
		version: 1,
		source: "board",
		taskId: 481,
		taskKey: "CA-42",
		returnPath: "/board/card/481",
		finishedAt: null,
		...overrides,
	};
}

const noop = () => {};

describe("FocusTimer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("advances the Running session display with the clock", () => {
		const session = makeSession({
			state: "running",
			accumulatedSeconds: 1200,
			runningSince: T0.toISOString(),
		});

		render(
			<FocusTimer
				session={session}
				onStart={noop}
				onPause={noop}
				onResume={noop}
				onFinish={noop}
			/>,
		);

		expect(screen.getByTestId("focus-duration").textContent).toBe("20:00");

		act(() => {
			vi.advanceTimersByTime(90_000);
		});

		expect(screen.getByTestId("focus-duration").textContent).toBe("21:30");
	});

	it("keeps a Paused session display static and schedules no interval", () => {
		const session = makeSession({
			state: "paused",
			accumulatedSeconds: 900,
			runningSince: null,
		});

		render(
			<FocusTimer
				session={session}
				onStart={noop}
				onPause={noop}
				onResume={noop}
				onFinish={noop}
			/>,
		);

		expect(screen.getByTestId("focus-duration").textContent).toBe("15:00");
		expect(vi.getTimerCount()).toBe(0);

		act(() => {
			vi.advanceTimersByTime(10 * 60 * 1000);
		});

		expect(screen.getByTestId("focus-duration").textContent).toBe("15:00");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("renders Ready duration and schedules no interval", () => {
		const session = makeSession({
			state: "ready",
			accumulatedSeconds: 0,
			runningSince: null,
		});

		render(
			<FocusTimer
				session={session}
				onStart={noop}
				onPause={noop}
				onResume={noop}
				onFinish={noop}
			/>,
		);

		expect(screen.getByTestId("focus-duration").textContent).toBe("00:00");
		expect(vi.getTimerCount()).toBe(0);
	});

	it("renders Start only in Ready state and fires onStart once", () => {
		const onStart = vi.fn();
		const onPause = vi.fn();
		const onResume = vi.fn();
		const onFinish = vi.fn();
		const session = makeSession({ state: "ready" });

		render(
			<FocusTimer
				session={session}
				onStart={onStart}
				onPause={onPause}
				onResume={onResume}
				onFinish={onFinish}
			/>,
		);

		expect(
			(screen.getByRole("button", { name: "Start" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
		expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Finish focus" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Start" }));
		expect(onStart).toHaveBeenCalledTimes(1);
		expect(onPause).not.toHaveBeenCalled();
		expect(onResume).not.toHaveBeenCalled();
		expect(onFinish).not.toHaveBeenCalled();
	});

	it("renders Pause and Finish focus in Running state and fires callbacks once", () => {
		const onStart = vi.fn();
		const onPause = vi.fn();
		const onResume = vi.fn();
		const onFinish = vi.fn();
		const session = makeSession({
			state: "running",
			accumulatedSeconds: 60,
			runningSince: T0.toISOString(),
		});

		render(
			<FocusTimer
				session={session}
				onStart={onStart}
				onPause={onPause}
				onResume={onResume}
				onFinish={onFinish}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
		expect(
			(screen.getByRole("button", { name: "Pause" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Finish focus",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);

		fireEvent.click(screen.getByRole("button", { name: "Pause" }));
		fireEvent.click(screen.getByRole("button", { name: "Finish focus" }));
		expect(onPause).toHaveBeenCalledTimes(1);
		expect(onFinish).toHaveBeenCalledTimes(1);
		expect(onStart).not.toHaveBeenCalled();
		expect(onResume).not.toHaveBeenCalled();
	});

	it("renders Resume and Finish focus in Paused state and fires callbacks once", () => {
		const onStart = vi.fn();
		const onPause = vi.fn();
		const onResume = vi.fn();
		const onFinish = vi.fn();
		const session = makeSession({
			state: "paused",
			accumulatedSeconds: 300,
			runningSince: null,
		});

		render(
			<FocusTimer
				session={session}
				onStart={onStart}
				onPause={onPause}
				onResume={onResume}
				onFinish={onFinish}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
		expect(
			(screen.getByRole("button", { name: "Resume" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Finish focus",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);

		fireEvent.click(screen.getByRole("button", { name: "Resume" }));
		fireEvent.click(screen.getByRole("button", { name: "Finish focus" }));
		expect(onResume).toHaveBeenCalledTimes(1);
		expect(onFinish).toHaveBeenCalledTimes(1);
		expect(onStart).not.toHaveBeenCalled();
		expect(onPause).not.toHaveBeenCalled();
	});

	it("disables every control when pending is true", () => {
		const session = makeSession({
			state: "running",
			accumulatedSeconds: 60,
			runningSince: T0.toISOString(),
		});

		render(
			<FocusTimer
				session={session}
				onStart={noop}
				onPause={noop}
				onResume={noop}
				onFinish={noop}
				pending
			/>,
		);

		for (const button of screen.getAllByRole("button")) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
	});
});
