// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteColumn = vi.fn();
vi.mock("../../api", () => ({
	api: {
		deleteColumn: (...args: unknown[]) => deleteColumn(...args),
	},
	ApiError: class ApiError extends Error {
		status: number;
		constructor(message: string, status: number) {
			super(message);
			this.status = status;
		}
	},
}));

import { useBoardPageActions } from "./useBoardPageActions";

const cancelScheduledRefresh = vi.fn();
const refresh = vi.fn().mockResolvedValue(undefined);
const showToast = vi.fn();

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	refresh.mockResolvedValue(undefined);
});

function renderActions() {
	return renderHook(() =>
		useBoardPageActions({
			activeWorkspaceId: 7,
			board: { cancelScheduledRefresh, refresh } as never,
			showToast,
		}),
	);
}

describe("useBoardPageActions onDeleteColumn contract", () => {
	it("resolves and shows the success toast when the deletion succeeds", async () => {
		deleteColumn.mockResolvedValue(undefined);
		const { result } = renderActions();

		await act(async () => {
			await result.current.onDeleteColumn(12);
		});

		expect(deleteColumn).toHaveBeenCalledWith(7, 12);
		expect(showToast).toHaveBeenCalledTimes(1);
		expect(showToast).toHaveBeenCalledWith("Column deleted", "success");
	});

	it("rejects and shows only the error toast when the deletion fails", async () => {
		const failure = new Error("409");
		deleteColumn.mockRejectedValue(failure);
		const { result } = renderActions();

		let caught: unknown;
		await act(async () => {
			caught = await result.current.onDeleteColumn(12).catch((e) => e);
		});

		// The dialog needs to observe the failure: the promise must reject.
		expect(caught).toBe(failure);
		expect(showToast).toHaveBeenCalledTimes(1);
		expect(showToast).toHaveBeenCalledWith(
			"Couldn't delete the column. Try again.",
			"error",
		);
		expect(refresh).not.toHaveBeenCalled();
	});

	it("resolves with a warning (not an error) when the deletion succeeds but the refresh fails", async () => {
		deleteColumn.mockResolvedValue(undefined);
		refresh
			.mockRejectedValueOnce(new Error("network"))
			.mockResolvedValue(undefined);
		const { result } = renderActions();

		await act(async () => {
			await result.current.onDeleteColumn(12);
		});

		// Success toast for the deletion, then a warning for the refresh —
		// and never the "Couldn't delete" error toast.
		expect(showToast).toHaveBeenCalledWith("Column deleted", "success");
		expect(showToast).toHaveBeenCalledWith(
			"Column deleted, but the board couldn't refresh — retrying in the background.",
			"warning",
		);
		expect(showToast).not.toHaveBeenCalledWith(
			"Couldn't delete the column. Try again.",
			"error",
		);
		// One background retry refresh was scheduled.
		expect(refresh).toHaveBeenCalledTimes(2);
	});
});
