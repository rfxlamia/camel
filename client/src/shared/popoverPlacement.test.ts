import { describe, expect, it } from "vitest";
import {
	POPOVER_GAP,
	POPOVER_WIDTH,
	computePopoverPosition,
} from "./popoverPlacement";

const trigger = { top: 400, left: 100, right: 124, bottom: 424 };

describe("computePopoverPosition", () => {
	it("opens below the trigger when there is enough space", () => {
		const position = computePopoverPosition({
			trigger,
			popoverWidth: POPOVER_WIDTH,
			popoverHeight: 200,
			viewportWidth: 800,
			viewportHeight: 900,
		});

		expect(position.placement).toBe("below");
		expect(position.top).toBe(trigger.bottom + POPOVER_GAP);
		expect(position.left).toBe(trigger.left);
	});

	it("flips above when there is not enough space below", () => {
		const position = computePopoverPosition({
			trigger: { top: 700, left: 100, right: 124, bottom: 724 },
			popoverWidth: POPOVER_WIDTH,
			popoverHeight: 200,
			viewportWidth: 800,
			viewportHeight: 800,
		});

		expect(position.placement).toBe("above");
		expect(position.top).toBe(700 - 200 - POPOVER_GAP);
	});

	it("anchors to the trigger right edge when align is right", () => {
		const position = computePopoverPosition({
			trigger: { top: 400, left: 300, right: 324, bottom: 424 },
			popoverWidth: POPOVER_WIDTH,
			popoverHeight: 200,
			align: "right",
			viewportWidth: 800,
			viewportHeight: 900,
		});

		expect(position.left).toBe(324 - POPOVER_WIDTH);
	});

	it("clamps horizontally inside the viewport", () => {
		const position = computePopoverPosition({
			trigger: { top: 100, left: 760, right: 784, bottom: 124 },
			popoverWidth: POPOVER_WIDTH,
			popoverHeight: 200,
			viewportWidth: 800,
			viewportHeight: 900,
		});

		expect(position.left).toBe(800 - POPOVER_WIDTH - 8);
	});
});
