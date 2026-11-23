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

	it("cancels on Escape fired from a dialog button", () => {
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

		const confirm = screen.getByRole("button", { name: "Confirm thing" });
		confirm.focus();
		fireEvent.keyDown(confirm, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("moves focus into the dialog and keeps Tab inside it", () => {
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

		const cancel = screen.getByRole("button", { name: "Cancel" });
		const confirm = screen.getByRole("button", { name: "Confirm thing" });
		expect(document.activeElement).toBe(cancel);

		confirm.focus();
		fireEvent.keyDown(confirm, { key: "Tab" });
		expect(document.activeElement).toBe(cancel);

		fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(confirm);
	});

	it("restores focus to the trigger, or another control if the trigger is gone", () => {
		const trigger = document.createElement("button");
		trigger.textContent = "Make owner";
		const remaining = document.createElement("button");
		remaining.textContent = "Stay";
		document.body.append(trigger, remaining);
		trigger.focus();

		const { unmount } = render(
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
		expect(document.activeElement).not.toBe(trigger);

		unmount();
		expect(document.activeElement).toBe(trigger);

		trigger.focus();
		const again = render(
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
		trigger.remove();
		again.unmount();
		expect(document.activeElement).toBe(remaining);
		remaining.remove();
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

	it("ignores Escape, backdrop, and Cancel while busy", () => {
		const onCancel = vi.fn();
		render(
			<ConfirmActionDialog
				titleId="confirm-thing-title"
				title="Do the thing?"
				description="This cannot be undone."
				confirmAriaLabel="Confirm thing"
				confirmLabel="Do it"
				busyLabel="Doing..."
				busy={true}
				onConfirm={() => {}}
				onCancel={onCancel}
			/>,
		);

		// An in-flight action is not cancellable; dismissing the dialog while
		// it runs would imply the operation was aborted when it was not.
		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.keyDown(screen.getByRole("button", { name: "Confirm thing" }), {
			key: "Escape",
		});
		fireEvent.click(screen.getByRole("dialog"));

		const cancel = screen.getByRole("button", { name: "Cancel" });
		expect((cancel as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(cancel);

		expect(onCancel).not.toHaveBeenCalled();
		// The dialog stays open so the user can see the operation settle.
		expect(screen.getByRole("dialog")).toBeTruthy();
	});
});
