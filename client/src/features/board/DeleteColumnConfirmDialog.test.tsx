import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const deleteColumn = vi.fn();
const refresh = vi.fn().mockResolvedValue(undefined);
const showToast = vi.fn();
let refreshAttempts = 0;
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

import DeleteColumnConfirmDialog from "./DeleteColumnConfirmDialog";
import { useBoardPageActions } from "./useBoardPageActions";

const onClose = vi.fn();

function renderDialog(onConfirm: () => Promise<void>) {
	render(
		<DeleteColumnConfirmDialog
			columnTitle="In progress"
			onConfirm={onConfirm}
			onClose={onClose}
		/>,
	);
}

/**
 * Renders the dialog wired to the REAL useBoardPageActions.onDeleteColumn
 * callback (with the api module mocked), so the deletion success/failure
 * contract between the parent handler and the dialog is exercised end to end.
 * Mirrors ColumnSettings: the dialog unmounts when its onClose fires.
 */
function RealParentHarness({
	failDeletion,
	failRefresh,
}: {
	failDeletion: boolean;
	failRefresh: boolean;
}) {
	const [open, setOpen] = useState(true);
	const { onDeleteColumn } = useBoardPageActions({
		activeWorkspaceId: 7,
		board: {
			cancelScheduledRefresh: () => {},
			refresh: () => {
				refreshAttempts++;
				// Fail only the first refresh so the background retry resolves.
				if (failRefresh && refreshAttempts === 1) {
					return Promise.reject(new Error("refresh"));
				}
				return refresh();
			},
		} as never,
		showToast,
	});
	deleteColumn.mockImplementation(() =>
		failDeletion
			? Promise.reject(new Error("delete failed"))
			: Promise.resolve(undefined),
	);
	if (!open) return null;
	return (
		<DeleteColumnConfirmDialog
			columnTitle="In progress"
			onConfirm={() => onDeleteColumn(12)}
			onClose={() => {
				onClose();
				setOpen(false);
			}}
		/>
	);
}

function renderRealParentHarness(options: {
	failDeletion: boolean;
	failRefresh: boolean;
}) {
	render(
		<RealParentHarness
			failDeletion={options.failDeletion}
			failRefresh={options.failRefresh}
		/>,
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	refresh.mockResolvedValue(undefined);
	refreshAttempts = 0;
});

describe("DeleteColumnConfirmDialog", () => {
	it("calls onConfirm and closes after the delete button resolves", async () => {
		const onConfirm = vi.fn().mockResolvedValue(undefined);
		renderDialog(onConfirm);

		fireEvent.click(
			screen.getByRole("button", { name: "Confirm delete column" }),
		);

		await waitFor(() => {
			expect(onConfirm).toHaveBeenCalledTimes(1);
			expect(onClose).toHaveBeenCalled();
		});
	});

	it("stays open when onConfirm rejects so the user can retry", async () => {
		const onConfirm = vi.fn().mockRejectedValue(new Error("boom"));
		renderDialog(onConfirm);

		fireEvent.click(
			screen.getByRole("button", { name: "Confirm delete column" }),
		);

		await waitFor(() => {
			expect(onConfirm).toHaveBeenCalledTimes(1);
		});
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog")).toBeTruthy();
	});

	it("closes on Escape via the backdrop handler", () => {
		renderDialog(vi.fn().mockResolvedValue(undefined));

		fireEvent.keyDown(document, { key: "Escape" });

		expect(onClose).toHaveBeenCalled();
	});

	describe("wired to the real useBoardPageActions.onDeleteColumn", () => {
		it("closes only after the real callback resolves a successful deletion", async () => {
			renderRealParentHarness({ failDeletion: false, failRefresh: false });

			fireEvent.click(
				screen.getByRole("button", { name: "Confirm delete column" }),
			);

			await waitFor(() => {
				expect(deleteColumn).toHaveBeenCalledWith(7, 12);
				expect(showToast).toHaveBeenCalledWith("Column deleted", "success");
				expect(onClose).toHaveBeenCalled();
			});
			expect(screen.queryByRole("dialog")).toBeNull();
		});

		it("stays open when the real API deletion fails so the user can retry", async () => {
			renderRealParentHarness({ failDeletion: true, failRefresh: false });

			fireEvent.click(
				screen.getByRole("button", { name: "Confirm delete column" }),
			);

			await waitFor(() => {
				expect(showToast).toHaveBeenCalledWith(
					"Couldn't delete the column. Try again.",
					"error",
				);
			});
			expect(showToast).not.toHaveBeenCalledWith("Column deleted", "success");
			// The failure must not be treated as success: the dialog stays open.
			expect(onClose).not.toHaveBeenCalled();
			expect(screen.getByRole("dialog")).toBeTruthy();
		});

		it("closes when the deletion succeeds even though the refresh failed", async () => {
			renderRealParentHarness({ failDeletion: false, failRefresh: true });

			fireEvent.click(
				screen.getByRole("button", { name: "Confirm delete column" }),
			);

			await waitFor(() => {
				expect(showToast).toHaveBeenCalledWith("Column deleted", "success");
				expect(showToast).toHaveBeenCalledWith(
					"Column deleted, but the board couldn't refresh — retrying in the background.",
					"warning",
				);
			});
			expect(showToast).not.toHaveBeenCalledWith(
				"Couldn't delete the column. Try again.",
				"error",
			);
			// A refresh failure is not a deletion failure: the dialog still closes.
			expect(onClose).toHaveBeenCalled();
			expect(screen.queryByRole("dialog")).toBeNull();
		});
	});
});
