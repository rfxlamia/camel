// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviewScreen } from "./PreviewScreen";

describe("PreviewScreen — edit, confirm-blocked, read-only type badge", () => {
	afterEach(cleanup);

	it("disables the confirm button when the title is cleared", () => {
		const onConfirm = vi.fn();
		render(
			<PreviewScreen
				draft={{ title: "Drag-drop breaks", description: "desc", type: "Bug" }}
				onConfirm={onConfirm}
				submitState={{ status: "idle" }}
			/>,
		);
		fireEvent.change(screen.getByLabelText(/title/i), {
			target: { value: "" },
		});
		expect(
			(screen.getByRole("button", { name: /confirm/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("submits the edited description text, not the original AI draft", () => {
		const onConfirm = vi.fn();
		render(
			<PreviewScreen
				draft={{ title: "Drag-drop breaks", description: "original", type: "Bug" }}
				onConfirm={onConfirm}
				submitState={{ status: "idle" }}
			/>,
		);
		fireEvent.change(screen.getByLabelText(/description/i), {
			target: { value: "edited description" },
		});
		fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
		expect(onConfirm).toHaveBeenCalledWith(
			expect.objectContaining({ description: "edited description" }),
		);
	});

	it("renders the type badge as read-only text with no override control", () => {
		render(
			<PreviewScreen
				draft={{ title: "t", description: "d", type: "Bug" }}
				onConfirm={vi.fn()}
				submitState={{ status: "idle" }}
			/>,
		);
		expect(screen.getByText("Bug")).toBeTruthy();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByRole("button", { name: /bug/i })).toBeNull();
	});
});

const baseDraft = { title: "t", description: "d", type: "Bug" as const };

describe("PreviewScreen — submit lifecycle rendering", () => {
	afterEach(cleanup);

	it("disables confirm and shows a submitting indicator while status is submitting", () => {
		render(
			<PreviewScreen
				draft={baseDraft}
				onConfirm={vi.fn()}
				submitState={{ status: "submitting" }}
			/>,
		);
		expect(
			(screen.getByRole("button", { name: /confirm/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(screen.getByText(/submitting/i)).toBeTruthy();
	});

	it("shows a success message with the issue identifier when status is success", () => {
		render(
			<PreviewScreen
				draft={baseDraft}
				onConfirm={vi.fn()}
				submitState={{
					status: "success",
					issueUrl: "https://linear.app/cam/issue/CAM-1",
					issueIdentifier: "CAM-1",
				}}
			/>,
		);
		expect(screen.getByText(/CAM-1/)).toBeTruthy();
	});

	it("shows a graceful error and a working Resubmit button when status is graceful_failure", () => {
		const onResubmit = vi.fn();
		render(
			<PreviewScreen
				draft={baseDraft}
				onConfirm={vi.fn()}
				onResubmit={onResubmit}
				submitState={{ status: "graceful_failure" }}
			/>,
		);
		expect(screen.queryByText(/^success$/i)).toBeNull();
		const resubmitButton = screen.getByRole("button", { name: /resubmit/i });
		resubmitButton.click();
		expect(onResubmit).toHaveBeenCalled();
	});

	it("disables confirm and shows a wait message when status is rate_limited", () => {
		render(
			<PreviewScreen
				draft={baseDraft}
				onConfirm={vi.fn()}
				submitState={{ status: "rate_limited" }}
			/>,
		);
		expect(
			(screen.getByRole("button", { name: /confirm/i }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(screen.getByText(/again/i)).toBeTruthy();
	});
});
