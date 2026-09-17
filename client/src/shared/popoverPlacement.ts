export const POPOVER_WIDTH = 240;
export const POPOVER_GAP = 6;
const VIEWPORT_PADDING = 8;

export interface ViewportRect {
	top: number;
	left: number;
	right: number;
	bottom: number;
}

export interface PopoverPosition {
	top: number;
	left: number;
	placement: "below" | "above";
}

export function computePopoverPosition({
	trigger,
	popoverWidth,
	popoverHeight,
	align = "left",
	viewportWidth,
	viewportHeight,
	gap = POPOVER_GAP,
	padding = VIEWPORT_PADDING,
}: {
	trigger: ViewportRect;
	popoverWidth: number;
	popoverHeight: number;
	align?: "left" | "right";
	viewportWidth: number;
	viewportHeight: number;
	gap?: number;
	padding?: number;
}): PopoverPosition {
	const spaceBelow = viewportHeight - trigger.bottom - padding;
	const spaceAbove = trigger.top - padding;
	const fitsBelow = spaceBelow >= popoverHeight + gap;
	const fitsAbove = spaceAbove >= popoverHeight + gap;

	let placement: PopoverPosition["placement"] = "below";
	if (!fitsBelow && (fitsAbove || spaceAbove > spaceBelow)) {
		placement = "above";
	}

	const top =
		placement === "below"
			? trigger.bottom + gap
			: trigger.top - popoverHeight - gap;

	let left =
		align === "right" ? trigger.right - popoverWidth : trigger.left;
	left = Math.max(
		padding,
		Math.min(left, viewportWidth - popoverWidth - padding),
	);

	return { top, left, placement };
}
