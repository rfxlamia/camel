import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignOutPopover } from "./SignOutPopover";

describe("SignOutPopover placement", () => {
	afterEach(cleanup);

	it("aligns a right-side popover to the trigger bottom", () => {
		const { getByRole } = render(
			<SignOutPopover open onConfirm={vi.fn()} onCancel={vi.fn()} />,
		);
		const dialog = getByRole("dialog", { name: "Confirm sign out" });
		const arrow = dialog.querySelector(".absolute.left-0");

		expect(dialog.className).toContain("bottom-0");
		expect(dialog.className).not.toContain("top-1/2");
		expect(dialog.className).not.toContain("-translate-y-1/2");
		expect(arrow?.className).toContain("bottom-4");
	});

	it("preserves top placement for mobile menus", () => {
		render(
			<SignOutPopover
				open
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
				placement="top"
			/>,
		);
		const dialog = screen.getByRole("dialog", { name: "Confirm sign out" });

		expect(dialog.className).toContain("bottom-full");
		expect(dialog.className).toContain("mb-4");
	});
});
