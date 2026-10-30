import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmActionDialog from "./ConfirmActionDialog";

afterEach(() => {
	cleanup();
});

describe("ConfirmActionDialog", () => {
	it("renders title, description, and a confirm button with its aria label", () => {
		render(
			<ConfirmActionDialog
				titleId="confirm-thing-title"
				title="Do the thing?"
				description="This cannot be undone."
				confirmAriaLabel="Confirm thing"
				confirmLabel="Do it"
				busyLabel="Doing..."
				busy={false}
				onConfirm={() => {}}
				onCancel={() => {}}
			/>,
		);
		expect(screen.getByRole("dialog", { name: "Do the thing?" })).toBeTruthy();
		expect(screen.getByText("This cannot be undone.")).toBeTruthy();
		const confirm = screen.getByRole("button", { name: "Confirm thing" });
		expect(confirm.textContent).toBe("Do it");
		expect((confirm as HTMLButtonElement).disabled).toBe(false);
	});

	it("cancels on Escape, backdrop click, and the Cancel button", () => {
		const onCancel = vi.fn();
		render(
			<ConfirmActionDialog
				titleId="confirm-thing-title"
				title="Do the thing?"
				description="This cannot be undone."
				confirmAriaLabel="Confirm thing"
				confirmLabel="Do it"
				busyLabel="Doing..."
				busy={false}
				onConfirm={() => {}}
				onCancel={onCancel}
			/>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.click(screen.getByRole("dialog"));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onCancel).toHaveBeenCalledTimes(3);
	});

	it("disables the confirm button and shows the busy label while busy", () => {
		const onConfirm = vi.fn();
		render(
			<ConfirmActionDialog
				titleId="confirm-thing-title"
				title="Do the thing?"
				description="This cannot be undone."
				confirmAriaLabel="Confirm thing"
				confirmLabel="Do it"
				busyLabel="Doing..."
				busy={true}
				onConfirm={onConfirm}
				onCancel={() => {}}
			/>,
		);
		const confirm = screen.getByRole("button", { name: "Confirm thing" });
		expect((confirm as HTMLButtonElement).disabled).toBe(true);
		expect(confirm.textContent).toBe("Doing...");
		fireEvent.click(confirm);
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
