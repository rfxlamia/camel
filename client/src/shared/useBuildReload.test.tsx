import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuildReload } from "./useBuildReload";

function Probe() {
	useBuildReload();
	return null;
}

const okBody = (buildId: unknown) => ({
	ok: true,
	status: 200,
	json: async () => ({ ok: true, buildId }),
});
const failed = {
	ok: false,
	status: 503,
	json: async () => ({ error: "maintenance" }),
};

const fetchMock = vi.fn();
const reload = vi.fn();
const originalLocation = window.location;

async function flush() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(0);
	});
}

async function becomeVisible() {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => "visible",
	});
	await act(async () => {
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(0);
	});
}

describe("useBuildReload", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		fetchMock.mockReset();
		reload.mockReset();
		vi.stubGlobal("fetch", fetchMock);
		Object.defineProperty(window, "location", {
			configurable: true,
			value: { ...originalLocation, reload },
		});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		Object.defineProperty(window, "location", {
			configurable: true,
			value: originalLocation,
		});
	});

	it("reloads once when the build id changes on visibility", async () => {
		fetchMock.mockResolvedValueOnce(okBody("a")).mockResolvedValue(okBody("b"));
		render(<Probe />);
		await flush();
		await becomeVisible();
		await becomeVisible();
		expect(fetchMock).toHaveBeenCalledWith("/api/health", {
			cache: "no-store",
		});
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("does not reload when the build id is unchanged", async () => {
		fetchMock.mockResolvedValue(okBody("a"));
		render(<Probe />);
		await flush();
		await becomeVisible();
		expect(reload).not.toHaveBeenCalled();
	});

	it("does not reload on 503 or network failure", async () => {
		fetchMock.mockResolvedValueOnce(okBody("a"));
		render(<Probe />);
		await flush();
		fetchMock.mockResolvedValueOnce(failed);
		await becomeVisible();
		fetchMock.mockRejectedValueOnce(new Error("offline"));
		await becomeVisible();
		expect(reload).not.toHaveBeenCalled();
	});

	it("does not reload on a non-2xx body that carries a different id", async () => {
		fetchMock.mockResolvedValueOnce(okBody("a"));
		render(<Probe />);
		await flush();
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 503,
			json: async () => ({ buildId: "b" }),
		});
		await becomeVisible();
		expect(reload).not.toHaveBeenCalled();
	});

	it("captures the id after a failed first fetch without reloading", async () => {
		fetchMock.mockRejectedValueOnce(new Error("offline"));
		render(<Probe />);
		await flush();
		fetchMock.mockResolvedValueOnce(okBody("b"));
		await becomeVisible();
		expect(reload).not.toHaveBeenCalled();
		fetchMock.mockResolvedValueOnce(okBody("c"));
		await becomeVisible();
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("ignores empty or non-string build ids", async () => {
		fetchMock.mockResolvedValueOnce(okBody("a"));
		render(<Probe />);
		await flush();
		fetchMock.mockResolvedValueOnce(okBody(""));
		await becomeVisible();
		fetchMock.mockResolvedValueOnce(okBody(42));
		await becomeVisible();
		expect(reload).not.toHaveBeenCalled();
	});

	it("checks at most once per 5 minutes on the interval", async () => {
		fetchMock.mockResolvedValue(okBody("a"));
		render(<Probe />);
		await flush();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(60 * 1000);
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("cleans up listeners and the interval on unmount", async () => {
		fetchMock.mockResolvedValue(okBody("a"));
		const { unmount } = render(<Probe />);
		await flush();
		unmount();
		await becomeVisible();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
