// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	SKELETON_MIN_VISIBLE_MS,
	SKELETON_SHOW_DELAY_MS,
	useDelayedLoading,
} from "./useDelayedLoading";

describe("useDelayedLoading", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stays hidden when loading ends before the show delay", () => {
		const { result, rerender } = renderHook(
			({ loading }) => useDelayedLoading(loading),
			{ initialProps: { loading: true } },
		);

		expect(result.current).toBe(false);
		act(() => vi.advanceTimersByTime(SKELETON_SHOW_DELAY_MS - 1));
		expect(result.current).toBe(false);

		rerender({ loading: false });
		act(() =>
			vi.advanceTimersByTime(SKELETON_SHOW_DELAY_MS + SKELETON_MIN_VISIBLE_MS),
		);
		expect(result.current).toBe(false);
	});

	it("becomes visible after the show delay while still loading", () => {
		const { result } = renderHook(() => useDelayedLoading(true));

		act(() => vi.advanceTimersByTime(SKELETON_SHOW_DELAY_MS - 1));
		expect(result.current).toBe(false);

		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toBe(true);
	});

	it("keeps the indicator visible for the minimum time after a short reveal", () => {
		const { result, rerender } = renderHook(
			({ loading }) => useDelayedLoading(loading),
			{ initialProps: { loading: true } },
		);

		act(() => vi.advanceTimersByTime(SKELETON_SHOW_DELAY_MS));
		expect(result.current).toBe(true);

		act(() => vi.advanceTimersByTime(50));
		rerender({ loading: false });
		expect(result.current).toBe(true);

		act(() => vi.advanceTimersByTime(SKELETON_MIN_VISIBLE_MS - 50 - 1));
		expect(result.current).toBe(true);

		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toBe(false);
	});

	it("hides immediately when loading ends after the minimum visible time", () => {
		const { result, rerender } = renderHook(
			({ loading }) => useDelayedLoading(loading),
			{ initialProps: { loading: true } },
		);

		act(() =>
			vi.advanceTimersByTime(
				SKELETON_SHOW_DELAY_MS + SKELETON_MIN_VISIBLE_MS + 100,
			),
		);
		expect(result.current).toBe(true);

		rerender({ loading: false });
		expect(result.current).toBe(false);
	});

	it("keeps the original shown-at when loading resumes during the hide hold", () => {
		const { result, rerender } = renderHook(
			({ loading }) => useDelayedLoading(loading),
			{ initialProps: { loading: true } },
		);

		act(() => vi.advanceTimersByTime(SKELETON_SHOW_DELAY_MS));
		expect(result.current).toBe(true);

		rerender({ loading: false });
		act(() => vi.advanceTimersByTime(50));
		expect(result.current).toBe(true);

		rerender({ loading: true });
		expect(result.current).toBe(true);

		act(() => vi.advanceTimersByTime(10));
		rerender({ loading: false });
		expect(result.current).toBe(true);

		act(() => vi.advanceTimersByTime(SKELETON_MIN_VISIBLE_MS - 60 - 1));
		expect(result.current).toBe(true);

		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toBe(false);
	});

	it("clears pending timers on unmount", () => {
		const { unmount } = renderHook(() => useDelayedLoading(true));
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
