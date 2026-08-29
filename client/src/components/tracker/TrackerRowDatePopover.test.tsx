// client/src/components/tracker/TrackerRowDatePopover.test.tsx — jsdom.
import type { ComponentProps } from "react";
import {
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrackerRowDatePopover } from "./TrackerRowDatePopover";

afterEach(() => {
	cleanup();
});

const idPrefix = "tracker-row-inline-CA-1";

function renderPopover(
	props: Partial<ComponentProps<typeof TrackerRowDatePopover>> = {},
) {
	const onOpenChange = props.onOpenChange ?? vi.fn();
	const onCommit = props.onCommit ?? vi.fn();
	const view = render(
		<TrackerRowDatePopover
			startDate={props.startDate ?? null}
			endDate={props.endDate ?? null}
			triggerLabel={props.triggerLabel ?? "Set date"}
			idPrefix={props.idPrefix ?? idPrefix}
			open={props.open ?? true}
			onOpenChange={onOpenChange}
			onCommit={onCommit}
		/>,
	);
	return { onOpenChange, onCommit, ...view };
}

describe("TrackerRowDatePopover", () => {
	it("opens pre-filled with the current start and end dates", () => {
		renderPopover({
			startDate: "2026-08-06",
			endDate: "2026-08-26",
			triggerLabel: "6–26 Aug",
		});

		const startInput = screen.getByLabelText("Start date") as HTMLInputElement;
		const endInput = screen.getByLabelText("End date") as HTMLInputElement;
		expect(startInput.value).toBe("2026-08-06");
		expect(endInput.value).toBe("2026-08-26");
	});

	describe("close behavior", () => {
		it("commits draft dates when the close button is clicked", () => {
			const { onCommit, onOpenChange } = renderPopover();

			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-06" },
			});
			fireEvent.click(screen.getByLabelText("Close date picker"));

			expect(onCommit).toHaveBeenCalledTimes(1);
			expect(onCommit).toHaveBeenCalledWith({
				startDate: "2026-08-06",
				endDate: null,
			});
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});

		it("commits draft dates when the trigger is toggled closed", () => {
			const { onCommit, onOpenChange } = renderPopover();

			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-06" },
			});
			fireEvent.click(screen.getByLabelText("Date: Set date"));

			expect(onCommit).toHaveBeenCalledTimes(1);
			expect(onCommit).toHaveBeenCalledWith({
				startDate: "2026-08-06",
				endDate: null,
			});
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});

		it("commits draft dates on an outside pointer down", () => {
			const { onCommit, onOpenChange } = renderPopover();

			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-06" },
			});
			fireEvent.mouseDown(document.body);

			expect(onCommit).toHaveBeenCalledTimes(1);
			expect(onCommit).toHaveBeenCalledWith({
				startDate: "2026-08-06",
				endDate: null,
			});
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});

		it("commits draft dates on Escape", () => {
			const { onCommit, onOpenChange } = renderPopover();

			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-06" },
			});
			fireEvent.keyDown(document, { key: "Escape" });

			expect(onCommit).toHaveBeenCalledTimes(1);
			expect(onCommit).toHaveBeenCalledWith({
				startDate: "2026-08-06",
				endDate: null,
			});
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});

		it("commits draft dates when the parent closes the popover", () => {
			const onOpenChange = vi.fn();
			const onCommit = vi.fn();
			const { rerender } = render(
				<TrackerRowDatePopover
					startDate={null}
					endDate={null}
					triggerLabel="Set date"
					idPrefix={idPrefix}
					open={true}
					onOpenChange={onOpenChange}
					onCommit={onCommit}
				/>,
			);

			fireEvent.change(screen.getByLabelText("Start date"), {
				target: { value: "2026-08-06" },
			});

			rerender(
				<TrackerRowDatePopover
					startDate={null}
					endDate={null}
					triggerLabel="Set date"
					idPrefix={idPrefix}
					open={false}
					onOpenChange={onOpenChange}
					onCommit={onCommit}
				/>,
			);

			expect(onCommit).toHaveBeenCalledTimes(1);
			expect(onCommit).toHaveBeenCalledWith({
				startDate: "2026-08-06",
				endDate: null,
			});
			expect(onOpenChange).not.toHaveBeenCalled();
		});

		it("does not commit when closed without editing", () => {
			const { onCommit, onOpenChange } = renderPopover({
				startDate: "2026-08-06",
				endDate: "2026-08-26",
				triggerLabel: "6–26 Aug",
			});

			fireEvent.click(screen.getByLabelText("Close date picker"));

			expect(onCommit).not.toHaveBeenCalled();
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});

		it("keeps the popover open when the date range is invalid", () => {
			const { onCommit, onOpenChange } = renderPopover({
				startDate: "2026-08-26",
				endDate: "2026-08-06",
				triggerLabel: "26–6 Aug",
			});

			fireEvent.click(screen.getByLabelText("Close date picker"));

			expect(onCommit).not.toHaveBeenCalled();
			expect(onOpenChange).not.toHaveBeenCalled();
			expect(
				screen.getByText("End date must be on or after start date"),
			).toBeTruthy();
			expect(screen.getByLabelText("Close date picker")).toBeTruthy();
		});
	});
});
