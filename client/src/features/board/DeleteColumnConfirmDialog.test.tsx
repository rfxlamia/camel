import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeleteColumnConfirmDialog from "./DeleteColumnConfirmDialog";

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

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
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
});
