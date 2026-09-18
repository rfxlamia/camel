import { afterEach, describe, expect, it } from "vitest";
import {
	caretOffsetToViewportRect,
	getTextareaCaretOffset,
	getTextareaCaretRect,
} from "./caretRect";

function makeTextarea(value: string): HTMLTextAreaElement {
	const textarea = document.createElement("textarea");
	textarea.value = value;
	document.body.appendChild(textarea);
	return textarea;
}

function stubRect(element: Element, rect: Partial<DOMRect>): void {
	element.getBoundingClientRect = () =>
		({
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
			x: 0,
			y: 0,
			toJSON: () => ({}),
			...rect,
		}) as DOMRect;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("getTextareaCaretRect", () => {
	it("returns null when the textarea has no layout (jsdom default)", () => {
		const textarea = makeTextarea("buat task @");
		expect(getTextareaCaretRect(textarea, 10)).toBeNull();
	});

	it("offsets the caret rect by the textarea position", () => {
		const textarea = makeTextarea("buat task @");
		textarea.style.lineHeight = "20px";
		stubRect(textarea, {
			top: 100,
			left: 40,
			right: 340,
			bottom: 130,
			width: 300,
			height: 30,
		});

		const rect = getTextareaCaretRect(textarea, 10);
		expect(rect).not.toBeNull();
		// jsdom reports zero-width text, so the caret lands at the field origin
		// and the height falls back to the computed line-height.
		expect(rect?.left).toBe(40);
		expect(rect?.top).toBe(100);
		expect(rect?.bottom).toBe(120);
	});

	it("clamps an out-of-range index instead of throwing", () => {
		const textarea = makeTextarea("ab");
		textarea.style.lineHeight = "16px";
		stubRect(textarea, {
			top: 10,
			left: 5,
			right: 105,
			bottom: 26,
			width: 100,
			height: 16,
		});

		expect(getTextareaCaretRect(textarea, 999)?.top).toBe(10);
		expect(getTextareaCaretRect(textarea, -5)?.top).toBe(10);
	});

	it("subtracts textarea scroll offsets", () => {
		const textarea = makeTextarea("line");
		textarea.style.lineHeight = "20px";
		stubRect(textarea, {
			top: 50,
			left: 20,
			right: 220,
			bottom: 70,
			width: 200,
			height: 20,
		});
		Object.defineProperty(textarea, "scrollTop", {
			value: 12,
			configurable: true,
		});
		Object.defineProperty(textarea, "scrollLeft", {
			value: 7,
			configurable: true,
		});

		const rect = getTextareaCaretRect(textarea, 4);
		expect(rect?.top).toBe(38);
		expect(rect?.left).toBe(13);
	});
});

describe("getTextareaCaretOffset", () => {
	it("is independent of scroll and viewport position, so it can be cached", () => {
		const textarea = makeTextarea("buat task @");
		textarea.style.lineHeight = "20px";
		stubRect(textarea, {
			top: 100,
			left: 40,
			right: 340,
			bottom: 130,
			width: 300,
			height: 30,
		});

		const offset = getTextareaCaretOffset(textarea, 10);
		expect(offset).toEqual({ x: 0, y: 0, height: 20 });

		// Same cached offset, two different scroll states -> two different rects.
		expect(caretOffsetToViewportRect(textarea, offset!)).toMatchObject({
			top: 100,
			left: 40,
			bottom: 120,
		});
		Object.defineProperty(textarea, "scrollTop", {
			value: 30,
			configurable: true,
		});
		expect(caretOffsetToViewportRect(textarea, offset!)).toMatchObject({
			top: 70,
			bottom: 90,
		});
	});

	it("returns null when no height can be derived", () => {
		const textarea = makeTextarea("buat task @");
		expect(getTextareaCaretOffset(textarea, 10)).toBeNull();
	});
});
